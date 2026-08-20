import { createEmailProvider, providerMessage } from './communications.js';
import { createNotification } from './notifications.js';

export const AUTOMATION_TRIGGERS = Object.freeze([
  'lead_created', 'deal_stage_changed', 'activity_overdue', 'invoice_overdue', 'deal_won',
]);
export const AUTOMATION_ACTIONS = Object.freeze([
  'assign_owner', 'create_activity', 'create_notification', 'send_template_email', 'update_stage',
]);

export async function enqueueAutomationEvent(sql, {
  workspaceId,
  eventKey,
  triggerType,
  entityType,
  entityId,
  payload = {},
  occurredAt = new Date().toISOString(),
}) {
  const rows = await sql`
    WITH event AS (
      INSERT INTO automation_events (
        workspace_id, event_key, trigger_type, entity_type, entity_id, payload, occurred_at
      ) VALUES (
        ${workspaceId}, ${eventKey}, ${triggerType}, ${entityType}, ${entityId},
        ${JSON.stringify(payload)}::jsonb, ${occurredAt}
      )
      ON CONFLICT (workspace_id, event_key) DO UPDATE
        SET payload = EXCLUDED.payload
      RETURNING id, workspace_id, trigger_type
    ), queued AS (
      INSERT INTO automation_jobs (workspace_id, rule_id, event_id)
      SELECT event.workspace_id, rule.id, event.id
      FROM event
      JOIN automation_rules rule
        ON rule.workspace_id = event.workspace_id
       AND rule.trigger_type = event.trigger_type
       AND rule.status = 'active'
      ON CONFLICT (rule_id, event_id) DO NOTHING
      RETURNING id
    )
    SELECT event.id, (SELECT COUNT(*)::int FROM queued) AS jobs_queued FROM event
  `;
  return rows[0];
}

export async function materializeScheduledAutomationEvents(sql, { workspaceId = null } = {}) {
  await sql`
    INSERT INTO automation_events (
      workspace_id, event_key, trigger_type, entity_type, entity_id, payload, occurred_at
    )
    SELECT a.workspace_id,
      concat('activity_overdue:', a.id::text, ':', extract(epoch FROM a.due_at)::bigint),
      'activity_overdue', 'activity', a.id,
      jsonb_build_object(
        'id', a.id, 'subject', a.subject, 'due_at', a.due_at,
        'owner_user_id', a.owner_user_id, 'lead_id', a.lead_id,
        'account_id', a.account_id, 'contact_id', a.contact_id, 'deal_id', a.deal_id
      ), a.due_at
    FROM activities a
    WHERE a.completed_at IS NULL AND a.due_at < NOW()
      AND (${workspaceId}::uuid IS NULL OR a.workspace_id = ${workspaceId})
    ON CONFLICT (workspace_id, event_key) DO NOTHING
  `;
  await sql`
    INSERT INTO automation_events (
      workspace_id, event_key, trigger_type, entity_type, entity_id, payload, occurred_at
    )
    SELECT i.workspace_id,
      concat('invoice_overdue:', i.id::text, ':', i.due_date::text),
      'invoice_overdue', 'invoice', i.id,
      jsonb_build_object(
        'id', i.id, 'invoice_number', i.invoice_number, 'due_date', i.due_date,
        'owner_user_id', i.user_id, 'deal_id', i.deal_id, 'balance_due', i.balance_due,
        'currency', i.currency
      ), i.due_date::timestamptz
    FROM invoices i
    WHERE i.sent_at IS NOT NULL AND i.due_date < CURRENT_DATE
      AND i.status NOT IN ('paid', 'cancelled', 'void') AND i.balance_due > 0
      AND (${workspaceId}::uuid IS NULL OR i.workspace_id = ${workspaceId})
    ON CONFLICT (workspace_id, event_key) DO NOTHING
  `;
  await sql`
    INSERT INTO automation_jobs (workspace_id, rule_id, event_id)
    SELECT event.workspace_id, rule.id, event.id
    FROM automation_events event
    JOIN automation_rules rule
      ON rule.workspace_id = event.workspace_id
     AND rule.trigger_type = event.trigger_type
     AND rule.status = 'active'
    LEFT JOIN automation_jobs job ON job.rule_id = rule.id AND job.event_id = event.id
    WHERE job.id IS NULL AND (${workspaceId}::uuid IS NULL OR event.workspace_id = ${workspaceId})
    ON CONFLICT (rule_id, event_id) DO NOTHING
  `;
}

export async function processAutomationJobs(sql, { limit = 20, workspaceId = null } = {}) {
  const claimed = await sql`
    WITH candidates AS (
      SELECT id FROM automation_jobs
      WHERE status IN ('pending', 'retry') AND available_at <= NOW()
        AND (${workspaceId}::uuid IS NULL OR workspace_id = ${workspaceId})
        AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes')
      ORDER BY available_at, created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE automation_jobs job
    SET status = 'running', locked_at = NOW(), started_at = COALESCE(started_at, NOW()),
        attempts = attempts + 1, updated_at = NOW()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.id
  `;
  const results = [];
  for (const item of claimed) results.push(await processJob(sql, item.id));
  return results;
}

async function processJob(sql, jobId) {
  const rows = await sql`
    SELECT job.*, rule.name AS rule_name, rule.conditions, rule.actions, rule.updated_by,
           event.trigger_type, event.entity_type, event.entity_id, event.payload
    FROM automation_jobs job
    JOIN automation_rules rule ON rule.id = job.rule_id AND rule.workspace_id = job.workspace_id
    JOIN automation_events event ON event.id = job.event_id AND event.workspace_id = job.workspace_id
    WHERE job.id = ${jobId}
  `;
  const job = rows[0];
  if (!job) return { id: jobId, status: 'missing' };
  try {
    if (!conditionsMatch(job.conditions, job.payload)) {
      await succeedJob(sql, job, { skipped: true, reason: 'conditions_not_met' });
      return { id: job.id, status: 'succeeded', skipped: true };
    }
    const actions = Array.isArray(job.actions) ? job.actions : [];
    for (let index = 0; index < actions.length; index += 1) {
      await runAction(sql, job, actions[index], index);
    }
    await succeedJob(sql, job, { actions_completed: actions.length });
    return { id: job.id, status: 'succeeded' };
  } catch (error) {
    const reason = safeError(error);
    const deadLetter = Number(job.attempts) >= Number(job.max_attempts);
    const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, Number(job.attempts) - 1)));
    await sql`
      UPDATE automation_jobs
      SET status = ${deadLetter ? 'dead_letter' : 'retry'}, last_error = ${reason},
          available_at = CASE WHEN ${deadLetter} THEN available_at ELSE NOW() + (${delaySeconds} * INTERVAL '1 second') END,
          locked_at = NULL, completed_at = CASE WHEN ${deadLetter} THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE id = ${job.id}
    `;
    if (deadLetter) await notifyDeadLetter(sql, job, reason);
    return { id: job.id, status: deadLetter ? 'dead_letter' : 'retry', error: reason };
  }
}

async function runAction(sql, job, action, index) {
  if (!action || !AUTOMATION_ACTIONS.includes(action.type)) throw new Error(`Unsupported automation action at position ${index + 1}.`);
  const existing = await sql`
    SELECT status FROM automation_action_runs WHERE job_id = ${job.id} AND action_index = ${index}
  `;
  if (existing[0]?.status === 'succeeded') return;
  await sql`
    INSERT INTO automation_action_runs (workspace_id, job_id, action_index, action_type, status)
    VALUES (${job.workspace_id}, ${job.id}, ${index}, ${action.type}, 'running')
    ON CONFLICT (job_id, action_index) DO UPDATE
      SET status = 'running', attempts = automation_action_runs.attempts + 1,
          last_error = NULL, updated_at = NOW()
  `;
  try {
    await executeAction(sql, job, action, index);
    await sql`
      UPDATE automation_action_runs SET status = 'succeeded', completed_at = NOW(), updated_at = NOW()
      WHERE job_id = ${job.id} AND action_index = ${index}
    `;
  } catch (error) {
    await sql`
      UPDATE automation_action_runs SET status = 'failed', last_error = ${safeError(error)}, updated_at = NOW()
      WHERE job_id = ${job.id} AND action_index = ${index}
    `;
    throw error;
  }
}

async function executeAction(sql, job, action, index) {
  if (action.type === 'assign_owner') return assignOwner(sql, job, action);
  if (action.type === 'create_activity') return createActivity(sql, job, action, index);
  if (action.type === 'create_notification') return createActionNotification(sql, job, action, index);
  if (action.type === 'send_template_email') return sendTemplateEmail(sql, job, action, index);
  if (action.type === 'update_stage') return updateDealStage(sql, job, action);
}

async function assignOwner(sql, job, action) {
  const owner = await assertMember(sql, job.workspace_id, action.owner_user_id);
  const config = {
    lead: ['leads', 'user_id'], deal: ['deals', 'owner_user_id'],
    activity: ['activities', 'owner_user_id'], invoice: ['invoices', 'user_id'],
    contact: ['contacts', 'owner_user_id'], account: ['accounts', 'owner_user_id'],
  }[job.entity_type];
  if (!config) throw new Error(`Cannot assign automation entity ${job.entity_type}.`);
  const rows = await sql`
    UPDATE ${sql.unsafe(config[0])} SET ${sql.unsafe(config[1])} = ${owner.user_id}, updated_at = NOW()
    WHERE id = ${job.entity_id} AND workspace_id = ${job.workspace_id} RETURNING id
  `;
  if (!rows[0]) throw new Error('Automation assignment target no longer exists.');
}

async function createActivity(sql, job, action, index) {
  const ownerId = action.owner_user_id || job.payload?.owner_user_id || job.updated_by;
  await assertMember(sql, job.workspace_id, ownerId);
  const target = await activityTarget(sql, job);
  const subject = String(action.subject || `Follow up: ${job.rule_name}`).slice(0, 200);
  const description = String(action.description || `Created by automation “${job.rule_name}”.`).slice(0, 20_000);
  const dueAt = action.due_in_hours
    ? new Date(Date.now() + Math.min(8760, Math.max(0, Number(action.due_in_hours))) * 3_600_000).toISOString()
    : null;
  await sql`
    INSERT INTO activities (
      workspace_id, user_id, lead_id, account_id, contact_id, deal_id, type,
      subject, description, message, due_at, priority, owner_user_id, created_by,
      timestamp, created_at, updated_at, source_type, source_id
    ) VALUES (
      ${job.workspace_id}, ${job.updated_by}, ${target.lead_id}, ${target.account_id},
      ${target.contact_id}, ${target.deal_id}, ${action.activity_type || 'task'},
      ${subject}, ${description}, ${description.slice(0, 2_000)}, ${dueAt},
      ${action.priority || 'normal'}, ${ownerId}, ${job.updated_by}, NOW(), NOW(), NOW(),
      'automation_action', md5(${`${job.id}:${index}`})::uuid
    )
    ON CONFLICT (workspace_id, source_type, source_id)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    DO NOTHING
  `;
}

async function createActionNotification(sql, job, action, index) {
  const recipient = action.recipient_user_id || job.payload?.owner_user_id || job.updated_by;
  await assertMember(sql, job.workspace_id, recipient);
  return createNotification(sql, {
    workspaceId: job.workspace_id,
    recipientUserId: recipient,
    type: 'automation',
    title: String(action.title || `Automation: ${job.rule_name}`).slice(0, 200),
    body: String(action.body || `Triggered by ${job.trigger_type}.`).slice(0, 1_000),
    entityType: job.entity_type,
    entityId: job.entity_id,
    dedupeKey: `automation:${job.id}:${index}`,
    actionUrl: action.action_url || defaultEntityUrl(job.entity_type),
  });
}

async function sendTemplateEmail(sql, job, action, index) {
  const templates = await sql`
    SELECT id, subject, body_text, body_html FROM email_templates
    WHERE id = ${action.template_id} AND workspace_id = ${job.workspace_id} AND is_active = true
  `;
  if (!templates[0]) throw new Error('Automation email template does not exist or is inactive.');
  const recipient = await emailTarget(sql, job);
  if (!recipient?.email || !recipient.target_field) throw new Error('Automation email target has no supported email address.');
  const idempotencyKey = `automation-${job.id}-${index}`;
  const existing = await sql`
    SELECT id, status FROM outbound_messages
    WHERE workspace_id = ${job.workspace_id} AND idempotency_key = ${idempotencyKey}
  `;
  if (existing[0]?.status && existing[0].status !== 'failed') return;
  const provider = createEmailProvider();
  const messageRows = existing[0] ? existing : await sql`
    INSERT INTO outbound_messages (
      workspace_id, provider, idempotency_key, provider_idempotency_key, template_id,
      lead_id, account_id, contact_id, deal_id, from_address, recipient, subject,
      body_text, body_html, status, attempted_by
    ) VALUES (
      ${job.workspace_id}, ${provider.name}, ${idempotencyKey}, ${idempotencyKey}, ${templates[0].id},
      ${recipient.target_field === 'lead_id' ? recipient.target_id : null},
      ${recipient.target_field === 'account_id' ? recipient.target_id : null},
      ${recipient.target_field === 'contact_id' ? recipient.target_id : null},
      ${recipient.target_field === 'deal_id' ? recipient.target_id : null},
      ${provider.fromAddress || 'not-configured'}, ${recipient.email}, ${templates[0].subject},
      ${templates[0].body_text}, ${templates[0].body_html}, 'queued', ${job.updated_by}
    ) RETURNING id, status
  `;
  try {
    const delivery = await provider.send({
      recipient: recipient.email, subject: templates[0].subject,
      bodyText: templates[0].body_text, bodyHtml: templates[0].body_html,
      idempotencyKey,
    });
    await sql`
      UPDATE outbound_messages SET status = ${delivery.status}, provider_message_id = ${delivery.providerMessageId},
        sent_at = NOW(), failure_reason = NULL, updated_at = NOW()
      WHERE id = ${messageRows[0].id} AND workspace_id = ${job.workspace_id}
    `;
  } catch (error) {
    await sql`
      UPDATE outbound_messages SET status = 'failed', failure_reason = ${providerMessage(error)},
        failed_at = NOW(), updated_at = NOW()
      WHERE id = ${messageRows[0].id} AND workspace_id = ${job.workspace_id}
    `;
    throw error;
  }
}

async function updateDealStage(sql, job, action) {
  if (job.entity_type !== 'deal') throw new Error('The update_stage action requires a deal event.');
  const rows = await sql`
    SELECT d.stage_id AS from_stage_id, d.pipeline_id, s.id AS to_stage_id,
           s.probability, s.is_closed_won, s.is_closed_lost
    FROM deals d
    JOIN pipeline_stages s ON s.id = ${action.stage_id} AND s.workspace_id = d.workspace_id AND s.pipeline_id = d.pipeline_id
    WHERE d.id = ${job.entity_id} AND d.workspace_id = ${job.workspace_id}
  `;
  const move = rows[0];
  if (!move) throw new Error('Automation deal stage is invalid for this pipeline.');
  if (move.from_stage_id === move.to_stage_id) return;
  const status = move.is_closed_won ? 'won' : move.is_closed_lost ? 'lost' : 'open';
  await sql.transaction([
    sql`
      UPDATE deals SET stage_id = ${move.to_stage_id}, probability = ${move.probability}, status = ${status},
        actual_close_date = CASE WHEN ${status} = 'open' THEN NULL ELSE COALESCE(actual_close_date, CURRENT_DATE) END,
        forecast_category = CASE WHEN ${status} = 'won' THEN 'closed' WHEN ${status} = 'lost' THEN 'omitted' ELSE 'pipeline' END,
        updated_by = ${job.updated_by}, updated_at = NOW()
      WHERE id = ${job.entity_id} AND workspace_id = ${job.workspace_id}
    `,
    sql`
      INSERT INTO deal_stage_history (workspace_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by)
      VALUES (${job.workspace_id}, ${job.entity_id}, ${move.pipeline_id}, ${move.from_stage_id}, ${move.to_stage_id}, ${job.updated_by})
    `,
  ]);
}

async function activityTarget(sql, job) {
  if (job.entity_type === 'lead') return { lead_id: job.entity_id, account_id: null, contact_id: null, deal_id: null };
  if (job.entity_type === 'deal') return { lead_id: null, account_id: null, contact_id: null, deal_id: job.entity_id };
  if (job.entity_type === 'activity') {
    const rows = await sql`SELECT lead_id, account_id, contact_id, deal_id FROM activities WHERE id = ${job.entity_id} AND workspace_id = ${job.workspace_id}`;
    if (rows[0]) return rows[0];
  }
  if (job.entity_type === 'invoice') {
    const rows = await sql`SELECT deal_id FROM invoices WHERE id = ${job.entity_id} AND workspace_id = ${job.workspace_id}`;
    if (rows[0]?.deal_id) return { lead_id: null, account_id: null, contact_id: null, deal_id: rows[0].deal_id };
  }
  throw new Error('Automation activity requires a related lead, account, contact or deal.');
}

async function emailTarget(sql, job) {
  if (job.entity_type === 'lead') {
    const rows = await sql`SELECT id, email FROM leads WHERE id = ${job.entity_id} AND workspace_id = ${job.workspace_id}`;
    return rows[0] ? { email: rows[0].email, target_field: 'lead_id', target_id: rows[0].id } : null;
  }
  if (job.entity_type === 'deal') {
    const rows = await sql`
      SELECT d.id, c.email FROM deals d JOIN contacts c ON c.id = d.primary_contact_id AND c.workspace_id = d.workspace_id
      WHERE d.id = ${job.entity_id} AND d.workspace_id = ${job.workspace_id}
    `;
    return rows[0] ? { email: rows[0].email, target_field: 'deal_id', target_id: rows[0].id } : null;
  }
  return null;
}

export function conditionsMatch(conditions, payload) {
  const all = Array.isArray(conditions?.all) ? conditions.all : [];
  return all.every(condition => compare(pathValue(payload, condition.field), condition.operator || 'eq', condition.value));
}

function compare(actual, operator, expected) {
  if (operator === 'eq') return actual === expected;
  if (operator === 'neq') return actual !== expected;
  if (operator === 'in') return Array.isArray(expected) && expected.includes(actual);
  if (operator === 'exists') return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
  if (operator === 'gt') return Number(actual) > Number(expected);
  if (operator === 'gte') return Number(actual) >= Number(expected);
  if (operator === 'lt') return Number(actual) < Number(expected);
  if (operator === 'lte') return Number(actual) <= Number(expected);
  return false;
}

function pathValue(object, path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(path)) return undefined;
  const keys = path.split('.');
  if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) return undefined;
  return keys.reduce((value, key) => value?.[key], object);
}

async function assertMember(sql, workspaceId, userId) {
  if (!userId) throw new Error('Automation action requires a workspace member.');
  const rows = await sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${userId}`;
  if (!rows[0]) throw new Error('Automation action owner is not an active workspace member.');
  return rows[0];
}

async function succeedJob(sql, job, result) {
  await sql`
    UPDATE automation_jobs SET status = 'succeeded', result = ${JSON.stringify(result)}::jsonb, last_error = NULL,
      locked_at = NULL, completed_at = NOW(), updated_at = NOW()
    WHERE id = ${job.id}
  `;
}

async function notifyDeadLetter(sql, job, reason) {
  const managers = await sql`
    SELECT user_id FROM workspace_members WHERE workspace_id = ${job.workspace_id} AND role IN ('owner', 'admin')
  `;
  await Promise.all(managers.map(manager => createNotification(sql, {
    workspaceId: job.workspace_id,
    recipientUserId: manager.user_id,
    type: 'automation_failure',
    title: `Automation failed: ${job.rule_name}`,
    body: reason,
    entityType: 'automation_job',
    entityId: job.id,
    dedupeKey: `automation-dead-letter:${job.id}:${manager.user_id}`,
    actionUrl: '/automations',
  })));
}

function defaultEntityUrl(entityType) {
  return ({ lead: '/sales/leads', deal: '/sales/deals', activity: '/activities', invoice: '/invoices' })[entityType] || '/dashboard';
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1_000);
}
