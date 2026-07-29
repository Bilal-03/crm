import { getDb } from '../server/db.js';
import { getPagination, getRequiredId, HttpError, json, noContent, paginated, withApiRoute } from '../server/http.js';
import { validateMeeting } from '../server/validation.js';
import { getPersonalWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getPersonalWorkspace(sql, userId);

    if (req.method === 'GET') {
      const { limit, offset } = getPagination(req.query);
      const rows = await sql`
        SELECT id, lead_id, title, date_time, notes, created_at, updated_at
        FROM meetings
        WHERE workspace_id = ${workspace.id}
        ORDER BY date_time ASC, id ASC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      return json(res, 200, paginated(rows, limit, offset));
    }

    if (req.method === 'POST') {
      const meeting = validateMeeting(req.body);
      await assertOwnedLead(sql, meeting.lead_id, workspace.id);
      const rows = await sql`
        INSERT INTO meetings (workspace_id, user_id, lead_id, title, date_time, notes)
        VALUES (${workspace.id}, ${userId}, ${meeting.lead_id}, ${meeting.title}, ${meeting.date_time}, ${meeting.notes ?? null})
        RETURNING id, lead_id, title, date_time, notes, created_at, updated_at
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);

    if (req.method === 'PUT') {
      const meeting = validateMeeting(req.body, { partial: true });
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
          notes = CASE WHEN ${has('notes')} THEN ${meeting.notes ?? null} ELSE notes END,
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, lead_id, title, date_time, notes, created_at, updated_at
      `;
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Meeting not found.');
      return json(res, 200, { data: rows[0] });
    }

    const deleted = await sql`DELETE FROM meetings WHERE id = ${id} AND workspace_id = ${workspace.id} RETURNING id`;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Meeting not found.');
    return noContent(res);
  },
});

async function assertOwnedLead(sql, leadId, workspaceId) {
  if (leadId === null) return;
  const rows = await sql`SELECT id FROM leads WHERE id = ${leadId} AND workspace_id = ${workspaceId}`;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Lead does not exist.');
}
