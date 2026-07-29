import { getDb } from '../server/db.js';
import { getPagination, getRequiredId, HttpError, json, noContent, paginated, withApiRoute } from '../server/http.js';
import { validateLead } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const { limit, offset } = getPagination(req.query);
      const rows = await sql`
        SELECT id, name, company, email, phone, source, stage, notes, reminders, quote_items, created_at, updated_at
        FROM leads
        WHERE workspace_id = ${workspace.id}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      return json(res, 200, paginated(rows, limit, offset));
    }

    if (req.method === 'POST') {
      const lead = validateLead(req.body);
      const rows = await sql`
        INSERT INTO leads (workspace_id, user_id, name, company, email, phone, source, stage, notes, reminders, quote_items)
        VALUES (
          ${workspace.id}, ${userId}, ${lead.name}, ${lead.company ?? null}, ${lead.email}, ${lead.phone ?? null},
          ${lead.source ?? null}, ${lead.stage}, ${JSON.stringify(lead.notes ?? [])},
          ${JSON.stringify(lead.reminders ?? [])}, ${JSON.stringify(lead.quote_items ?? [])}
        )
        RETURNING id, name, company, email, phone, source, stage, notes, reminders, quote_items, created_at, updated_at
      `;
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
          phone = CASE WHEN ${has('phone')} THEN ${lead.phone ?? null} ELSE phone END,
          source = CASE WHEN ${has('source')} THEN ${lead.source ?? null} ELSE source END,
          stage = CASE WHEN ${has('stage')} THEN ${lead.stage ?? null} ELSE stage END,
          notes = CASE WHEN ${has('notes')} THEN ${has('notes') ? JSON.stringify(lead.notes) : null}::jsonb ELSE notes END,
          reminders = CASE WHEN ${has('reminders')} THEN ${has('reminders') ? JSON.stringify(lead.reminders) : null}::jsonb ELSE reminders END,
          quote_items = CASE WHEN ${has('quote_items')} THEN ${has('quote_items') ? JSON.stringify(lead.quote_items) : null}::jsonb ELSE quote_items END,
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, name, company, email, phone, source, stage, notes, reminders, quote_items, created_at, updated_at
      `;
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Lead not found.');
      return json(res, 200, { data: rows[0] });
    }

    const deleted = await sql`DELETE FROM leads WHERE id = ${id} AND workspace_id = ${workspace.id} RETURNING id`;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Lead not found.');
    return noContent(res);
  },
});
