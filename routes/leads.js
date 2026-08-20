import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryEnum,
  getQueryString,
  getRequiredId,
  getSort,
  HttpError,
  json,
  noContent,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { validateLead } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { normalizeEmail, normalizePhone } from '../server/normalization.js';
import { enqueueAutomationEvent, processAutomationJobs } from '../server/automations.js';
import { canAccessAllRecords } from '../server/authorization.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const accessAll = canAccessAllRecords(workspace);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const stage = getQueryEnum(req.query, 'stage', ['new', 'qualified', 'follow-up', 'proposal', 'closed-won', 'closed-lost']);
      const source = getQueryString(req.query, 'source', 80);
      const owner = getQueryString(req.query, 'owner', 256);
      const ownerUserId = owner === 'me' ? userId : owner;
      const orderBy = getSort(req.query, {
        created: 'created_at',
        updated: 'updated_at',
        name: 'name',
        stage: 'stage',
      }, 'created');
      const rows = await sql`
        SELECT id, name, company, email, phone, normalized_email, normalized_phone, source, stage,
               COALESCE(
                 (
                   SELECT jsonb_agg(
                     jsonb_build_object('id', n.id, 'text', n.body, 'timestamp', n.created_at)
                     ORDER BY n.created_at DESC, n.id DESC
                   )
                   FROM record_notes n
                   WHERE n.workspace_id = leads.workspace_id AND n.lead_id = leads.id
                 ),
                 notes
               ) AS notes,
               COALESCE(
                 (
                   SELECT jsonb_agg(
                     jsonb_build_object(
                       'id', COALESCE(a.legacy_source_id, a.id),
                       'date', (timezone(${workspace.timezone}, a.due_at))::date,
                       'note', a.subject,
                       'createdAt', a.created_at,
                       'completed', a.completed_at IS NOT NULL,
                       'completedAt', a.completed_at
                     )
                     ORDER BY a.due_at ASC, a.id ASC
                   )
                   FROM activities a
                   WHERE a.workspace_id = leads.workspace_id
                     AND a.lead_id = leads.id
                     AND a.type = 'task'
                     AND a.due_at IS NOT NULL
                 ),
                 reminders
               ) AS reminders,
               quote_items,
               created_at, updated_at, won_at, lost_at, COUNT(*) OVER() AS __total_count
        FROM leads
        WHERE workspace_id = ${workspace.id}
          AND (${accessAll} OR user_id = ${userId})
          AND (${search}::text IS NULL OR name ILIKE ${search ? `%${search}%` : null} OR company ILIKE ${search ? `%${search}%` : null} OR email ILIKE ${search ? `%${search}%` : null} OR source ILIKE ${search ? `%${search}%` : null})
          AND (${stage}::text IS NULL OR stage = ${stage})
          AND (${source}::text IS NULL OR source = ${source})
          AND (${ownerUserId}::text IS NULL OR user_id = ${ownerUserId})
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const lead = validateLead(req.body);
      const rows = await sql`
        INSERT INTO leads (workspace_id, user_id, name, company, email, phone, normalized_email, normalized_phone, source, stage, notes, reminders, quote_items, won_at, lost_at)
        VALUES (
          ${workspace.id}, ${userId}, ${lead.name}, ${lead.company ?? null}, ${lead.email}, ${lead.phone ?? null},
          ${normalizeEmail(lead.email)}, ${normalizePhone(lead.phone)},
          ${lead.source ?? null}, ${lead.stage}, ${JSON.stringify(lead.notes ?? [])},
          ${JSON.stringify(lead.reminders ?? [])}, ${JSON.stringify(lead.quote_items ?? [])},
          ${lead.stage === 'closed-won' ? new Date().toISOString() : null},
          ${lead.stage === 'closed-lost' ? new Date().toISOString() : null}
        )
        RETURNING id, name, company, email, phone, normalized_email, normalized_phone, source, stage, notes, reminders, quote_items,
                  created_at, updated_at, won_at, lost_at
      `;
      await enqueueAutomationEvent(sql, {
        workspaceId: workspace.id,
        eventKey: `lead_created:${rows[0].id}`,
        triggerType: 'lead_created',
        entityType: 'lead',
        entityId: rows[0].id,
        payload: { ...rows[0], owner_user_id: userId, actor_user_id: userId },
        occurredAt: rows[0].created_at,
      });
      await processAutomationJobs(sql, { limit: 10, workspaceId: workspace.id });
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);

    if (req.method === 'PUT') {
      const lead = validateLead(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(lead, key);
      const rows = await sql`
        UPDATE leads
        SET
          name = CASE WHEN ${has('name')} THEN ${lead.name ?? null} ELSE name END,
          company = CASE WHEN ${has('company')} THEN ${lead.company ?? null} ELSE company END,
          email = CASE WHEN ${has('email')} THEN ${lead.email ?? null} ELSE email END,
          normalized_email = CASE WHEN ${has('email')} THEN ${normalizeEmail(lead.email)} ELSE normalized_email END,
          phone = CASE WHEN ${has('phone')} THEN ${lead.phone ?? null} ELSE phone END,
          normalized_phone = CASE WHEN ${has('phone')} THEN ${normalizePhone(lead.phone)} ELSE normalized_phone END,
          source = CASE WHEN ${has('source')} THEN ${lead.source ?? null} ELSE source END,
          stage = CASE WHEN ${has('stage')} THEN ${lead.stage ?? null} ELSE stage END,
          notes = CASE WHEN ${has('notes')} THEN ${has('notes') ? JSON.stringify(lead.notes) : null}::jsonb ELSE notes END,
          reminders = CASE WHEN ${has('reminders')} THEN ${has('reminders') ? JSON.stringify(lead.reminders) : null}::jsonb ELSE reminders END,
          quote_items = CASE WHEN ${has('quote_items')} THEN ${has('quote_items') ? JSON.stringify(lead.quote_items) : null}::jsonb ELSE quote_items END,
          won_at = CASE
            WHEN ${has('stage') && lead.stage === 'closed-won'} THEN COALESCE(won_at, NOW())
            WHEN ${has('stage')} THEN NULL
            ELSE won_at
          END,
          lost_at = CASE
            WHEN ${has('stage') && lead.stage === 'closed-lost'} THEN COALESCE(lost_at, NOW())
            WHEN ${has('stage')} THEN NULL
            ELSE lost_at
          END,
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id} AND (${accessAll} OR user_id = ${userId})
        RETURNING id, name, company, email, phone, normalized_email, normalized_phone, source, stage, notes, reminders, quote_items,
                  created_at, updated_at, won_at, lost_at
      `;
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Lead not found.');
      if (has('stage')) await syncConvertedDealStage(sql, workspace.id, id, lead.stage, userId);
      return json(res, 200, { data: rows[0] });
    }

    const deleted = await sql`DELETE FROM leads WHERE id = ${id} AND workspace_id = ${workspace.id} AND (${accessAll} OR user_id = ${userId}) RETURNING id`;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Lead not found.');
    return noContent(res);
  },
});

async function syncConvertedDealStage(sql, workspaceId, leadId, stageKey, userId) {
  const rows = await sql`
    SELECT d.id, d.pipeline_id, d.stage_id AS old_stage_id, s.id AS new_stage_id,
           s.probability, s.is_closed_won, s.is_closed_lost
    FROM deals d
    JOIN pipeline_stages s
      ON s.pipeline_id = d.pipeline_id AND s.workspace_id = d.workspace_id AND s.key = ${stageKey}
    WHERE d.workspace_id = ${workspaceId} AND d.source_lead_id = ${leadId} AND d.stage_id <> s.id
  `;
  for (const move of rows) {
    const status = move.is_closed_won ? 'won' : move.is_closed_lost ? 'lost' : 'open';
    await sql`
      UPDATE deals
      SET stage_id = ${move.new_stage_id}, probability = ${move.probability}, status = ${status},
          actual_close_date = CASE WHEN ${status} = 'open' THEN NULL ELSE COALESCE(actual_close_date, CURRENT_DATE) END,
          forecast_category = CASE WHEN ${status} = 'won' THEN 'closed' WHEN ${status} = 'lost' THEN 'omitted' ELSE 'pipeline' END,
          updated_by = ${userId}, updated_at = NOW()
      WHERE id = ${move.id} AND workspace_id = ${workspaceId}
    `;
    await sql`
      INSERT INTO deal_stage_history (
        workspace_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by, changed_at
      )
      VALUES (${workspaceId}, ${move.id}, ${move.pipeline_id}, ${move.old_stage_id}, ${move.new_stage_id}, ${userId}, NOW())
    `;
  }
}
