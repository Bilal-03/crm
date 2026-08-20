import { getDb } from '../server/db.js';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, materializeScheduledAutomationEvents, processAutomationJobs } from '../server/automations.js';
import { getPagination, getQueryEnum, getRequiredId, HttpError, json, noContent, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { consumeRateLimit } from '../server/rate-limit.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const canManage = ['owner', 'admin'].includes(workspace.role);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const status = getQueryEnum(req.query, 'status', ['active', 'paused', 'archived']);
      const jobsQuery = canManage ? sql`
        SELECT job.id, job.rule_id, rule.name AS rule_name, job.status, job.attempts,
               job.max_attempts, job.last_error, job.available_at, job.completed_at,
               job.created_at, event.trigger_type, event.entity_type, event.entity_id
        FROM automation_jobs job
        JOIN automation_rules rule ON rule.id = job.rule_id AND rule.workspace_id = job.workspace_id
        JOIN automation_events event ON event.id = job.event_id AND event.workspace_id = job.workspace_id
        WHERE job.workspace_id = ${workspace.id}
        ORDER BY job.created_at DESC, job.id DESC LIMIT 50
      ` : Promise.resolve([]);
      const auditQuery = canManage ? sql`
        SELECT id, actor_user_id, action, entity_type, entity_id, request_id, created_at
        FROM audit_events WHERE workspace_id = ${workspace.id}
        ORDER BY created_at DESC, id DESC LIMIT 50
      ` : Promise.resolve([]);
      const [rules, jobs, audit] = await Promise.all([
        sql`
          SELECT rule.*,
            COUNT(job.id)::int AS run_count,
            COUNT(job.id) FILTER (WHERE job.status = 'succeeded')::int AS succeeded_count,
            COUNT(job.id) FILTER (WHERE job.status = 'dead_letter')::int AS failed_count,
            MAX(job.completed_at) AS last_run_at
          FROM automation_rules rule
          LEFT JOIN automation_jobs job ON job.rule_id = rule.id AND job.workspace_id = rule.workspace_id
          WHERE rule.workspace_id = ${workspace.id} AND (${status}::text IS NULL OR rule.status = ${status})
          GROUP BY rule.id
          ORDER BY rule.updated_at DESC, rule.id DESC
          LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
        `,
        jobsQuery,
        auditQuery,
      ]);
      return json(res, 200, { data: {
        rules,
        jobs,
        audit,
        capabilities: { triggers: AUTOMATION_TRIGGERS, actions: AUTOMATION_ACTIONS },
        canManage,
      } });
    }

    assertManager(workspace);
    await consumeRateLimit(sql, {
      workspaceId: workspace.id, subject: userId, scope: 'automation_mutation', limit: 60, windowSeconds: 60,
    });
    if (req.body?.action === 'run_now') {
      await materializeScheduledAutomationEvents(sql, { workspaceId: workspace.id });
      const results = await processAutomationJobs(sql, { limit: 25, workspaceId: workspace.id });
      return json(res, 200, { data: { processed: results.length, results } });
    }
    if (req.method === 'POST') {
      const input = validateRule(req.body);
      const rows = await sql`
        INSERT INTO automation_rules (
          workspace_id, name, trigger_type, conditions, actions, status, created_by, updated_by
        ) VALUES (
          ${workspace.id}, ${input.name}, ${input.trigger_type}, ${JSON.stringify(input.conditions)}::jsonb,
          ${JSON.stringify(input.actions)}::jsonb, ${input.status}, ${userId}, ${userId}
        ) RETURNING *
      `;
      await audit(sql, workspace.id, userId, requestId, 'automation.created', rows[0].id, null, rows[0]);
      return json(res, 201, { data: rows[0] });
    }

    if (req.body?.action === 'retry_job') {
      const jobId = getRequiredId({ id: req.body?.job_id });
      const rows = await sql`
        UPDATE automation_jobs SET status = 'retry', attempts = 0, available_at = NOW(),
          locked_at = NULL, last_error = NULL, completed_at = NULL, updated_at = NOW()
        WHERE id = ${jobId} AND workspace_id = ${workspace.id} AND status = 'dead_letter'
        RETURNING id, status
      `;
      if (!rows[0]) throw new HttpError(409, 'job_not_retryable', 'Only a dead-letter job can be retried.');
      await sql`UPDATE automation_action_runs SET status = 'failed', updated_at = NOW() WHERE job_id = ${jobId} AND status <> 'succeeded'`;
      await audit(sql, workspace.id, userId, requestId, 'automation_job.retried', jobId, null, rows[0]);
      return json(res, 200, { data: rows[0] });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`SELECT * FROM automation_rules WHERE id = ${id} AND workspace_id = ${workspace.id}`;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Automation rule not found.');

    if (req.method === 'PUT') {
      const input = validateRule(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      const rows = await sql`
        UPDATE automation_rules SET
          name = ${has('name') ? input.name : existing.name},
          trigger_type = ${has('trigger_type') ? input.trigger_type : existing.trigger_type},
          conditions = ${has('conditions') ? JSON.stringify(input.conditions) : JSON.stringify(existing.conditions)}::jsonb,
          actions = ${has('actions') ? JSON.stringify(input.actions) : JSON.stringify(existing.actions)}::jsonb,
          status = ${has('status') ? input.status : existing.status},
          updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id} RETURNING *
      `;
      await audit(sql, workspace.id, userId, requestId, 'automation.updated', id, existing, rows[0]);
      return json(res, 200, { data: rows[0] });
    }

    await sql`UPDATE automation_rules SET status = 'archived', updated_by = ${userId}, updated_at = NOW() WHERE id = ${id} AND workspace_id = ${workspace.id}`;
    await audit(sql, workspace.id, userId, requestId, 'automation.archived', id, existing, { ...existing, status: 'archived' });
    return noContent(res);
  },
});

function validateRule(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validation('A JSON object is required.');
  const result = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 160) throw validation('Name must contain 1 to 160 characters.');
    result.name = body.name.trim();
  }
  if (!partial || body.trigger_type !== undefined) {
    if (!AUTOMATION_TRIGGERS.includes(body.trigger_type)) throw validation('Unsupported automation trigger.');
    result.trigger_type = body.trigger_type;
  }
  if (!partial || body.conditions !== undefined) result.conditions = validateConditions(body.conditions ?? { all: [] });
  if (!partial || body.actions !== undefined) result.actions = validateActions(body.actions);
  if (!partial || body.status !== undefined) {
    const value = body.status || 'active';
    if (!['active', 'paused', 'archived'].includes(value)) throw validation('Status must be active, paused or archived.');
    result.status = value;
  }
  return result;
}

function validateConditions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.all) || value.all.length > 10) {
    throw validation('Conditions must use an all array with at most 10 entries.');
  }
  for (const condition of value.all) {
    if (!condition || typeof condition.field !== 'string' || !/^[a-zA-Z0-9_.]{1,100}$/.test(condition.field)
      || condition.field.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) {
      throw validation('Every condition requires a safe field path.');
    }
    if (!['eq', 'neq', 'in', 'exists', 'gt', 'gte', 'lt', 'lte'].includes(condition.operator || 'eq')) throw validation('Unsupported condition operator.');
  }
  return { all: value.all };
}

function validateActions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw validation('One to 10 actions are required.');
  for (const action of value) {
    if (!action || typeof action !== 'object' || !AUTOMATION_ACTIONS.includes(action.type)) throw validation('Every action requires a supported type.');
    if (action.type === 'assign_owner' && !isId(action.owner_user_id)) throw validation('Assign owner requires a workspace user ID.');
    if (action.type === 'send_template_email' && !isUuid(action.template_id)) throw validation('Send template email requires a template ID.');
    if (action.type === 'update_stage' && !isUuid(action.stage_id)) throw validation('Update stage requires a stage ID.');
  }
  return value;
}

function assertManager(workspace) {
  if (!['owner', 'admin'].includes(workspace.role)) throw new HttpError(403, 'manager_required', 'Only workspace managers can change automations.');
}

async function audit(sql, workspaceId, userId, requestId, action, entityId, beforeState, afterState) {
  await sql`
    INSERT INTO audit_events (workspace_id, actor_user_id, action, entity_type, entity_id, request_id, before_state, after_state)
    VALUES (${workspaceId}, ${userId}, ${action}, 'automation_rule', ${entityId}, ${requestId},
      ${beforeState ? JSON.stringify(beforeState) : null}::jsonb, ${afterState ? JSON.stringify(afterState) : null}::jsonb)
  `;
}

function validation(message) { return new HttpError(400, 'validation_error', message); }
function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isId(value) { return typeof value === 'string' && value.length >= 2 && value.length <= 256; }
