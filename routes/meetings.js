import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryDate,
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
import { validateMeeting } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { canAccessAllRecords } from '../server/authorization.js';
import { assertCrmTargetAccess } from '../server/authorization.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const accessAll = canAccessAllRecords(workspace);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const from = getQueryDate(req.query, 'from');
      const to = getQueryDate(req.query, 'to');
      const orderBy = getSort(req.query, {
        date: 'date_time',
        created: 'created_at',
        title: 'title',
      }, 'date', 'asc');
      const rows = await sql`
        SELECT id, lead_id, title, date_time, end_time, notes, integration_id, provider,
               external_event_id, meeting_url, sync_status, sync_error, last_synced_at,
               created_at, updated_at, COUNT(*) OVER() AS __total_count
        FROM meetings
        WHERE workspace_id = ${workspace.id}
          AND (${accessAll} OR user_id = ${userId})
          AND (${search}::text IS NULL OR title ILIKE ${search ? `%${search}%` : null} OR notes ILIKE ${search ? `%${search}%` : null})
          AND (${from}::date IS NULL OR date_time >= ${from}::date)
          AND (${to}::date IS NULL OR date_time < (${to}::date + INTERVAL '1 day'))
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const meeting = validateMeeting(req.body);
      await assertCrmTargetAccess(sql, workspace, userId, meeting);
      await assertOwnedLead(sql, meeting.lead_id, workspace.id);
      const rows = await sql`
        INSERT INTO meetings (workspace_id, user_id, lead_id, title, date_time, end_time, notes)
        VALUES (${workspace.id}, ${userId}, ${meeting.lead_id}, ${meeting.title}, ${meeting.date_time}, ${meeting.end_time ?? null}, ${meeting.notes ?? null})
        RETURNING id, lead_id, title, date_time, end_time, notes, integration_id, provider,
                  external_event_id, meeting_url, sync_status, sync_error, last_synced_at,
                  created_at, updated_at
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);

    if (req.method === 'PUT') {
      const currentRows = await sql`
        SELECT id, date_time, end_time, external_event_id, sync_status
        FROM meetings WHERE id = ${id} AND workspace_id = ${workspace.id} AND (${accessAll} OR user_id = ${userId})
      `;
      if (!currentRows[0]) throw new HttpError(404, 'not_found', 'Meeting not found.');
      const meeting = validateMeeting(req.body, { partial: true, current: currentRows[0] });
      await assertCrmTargetAccess(sql, workspace, userId, meeting);
      if (Object.prototype.hasOwnProperty.call(meeting, 'lead_id')) {
        await assertOwnedLead(sql, meeting.lead_id, workspace.id);
      }
      const has = key => Object.prototype.hasOwnProperty.call(meeting, key);
      const rows = await sql`
        UPDATE meetings
        SET
          lead_id = CASE WHEN ${has('lead_id')} THEN ${meeting.lead_id ?? null} ELSE lead_id END,
          title = CASE WHEN ${has('title')} THEN ${meeting.title ?? null} ELSE title END,
          date_time = CASE WHEN ${has('date_time')} THEN ${meeting.date_time ?? null} ELSE date_time END,
          end_time = CASE WHEN ${has('end_time')} THEN ${meeting.end_time ?? null} ELSE end_time END,
          notes = CASE WHEN ${has('notes')} THEN ${meeting.notes ?? null} ELSE notes END,
          sync_status = CASE WHEN external_event_id IS NOT NULL THEN 'pending' ELSE sync_status END,
          sync_error = CASE WHEN external_event_id IS NOT NULL THEN NULL ELSE sync_error END,
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id} AND (${accessAll} OR user_id = ${userId})
        RETURNING id, lead_id, title, date_time, end_time, notes, integration_id, provider,
                  external_event_id, meeting_url, sync_status, sync_error, last_synced_at,
                  created_at, updated_at
      `;
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Meeting not found.');
      return json(res, 200, { data: rows[0] });
    }

    const syncedRows = await sql`
      SELECT external_event_id, sync_status FROM meetings WHERE id = ${id} AND workspace_id = ${workspace.id} AND (${accessAll} OR user_id = ${userId})
    `;
    if (syncedRows[0]?.external_event_id && syncedRows[0].sync_status !== 'deleted') {
      throw new HttpError(409, 'calendar_delete_required', 'Delete the linked Google Calendar event before deleting this meeting.');
    }
    const deleted = await sql`DELETE FROM meetings WHERE id = ${id} AND workspace_id = ${workspace.id} AND (${accessAll} OR user_id = ${userId}) RETURNING id`;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Meeting not found.');
    return noContent(res);
  },
});

async function assertOwnedLead(sql, leadId, workspaceId) {
  if (leadId === null) return;
  const rows = await sql`SELECT id FROM leads WHERE id = ${leadId} AND workspace_id = ${workspaceId}`;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Lead does not exist.');
}
