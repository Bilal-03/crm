import { getDb } from '../server/db.js';
import { getPagination, HttpError, json, paginated, withApiRoute } from '../server/http.js';
import { validateActivity } from '../server/validation.js';
import { getPersonalWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getPersonalWorkspace(sql, userId);

    if (req.method === 'GET') {
      const { limit, offset } = getPagination(req.query);
      const rows = await sql`
        SELECT id, lead_id, type, message, timestamp
        FROM activities
        WHERE workspace_id = ${workspace.id}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      return json(res, 200, paginated(rows, limit, offset));
    }

    const activity = validateActivity(req.body);
    if (activity.lead_id) {
      const lead = await sql`SELECT id FROM leads WHERE id = ${activity.lead_id} AND workspace_id = ${workspace.id}`;
      if (!lead[0]) throw new HttpError(400, 'invalid_reference', 'Lead does not exist.');
    }
    const rows = await sql`
      INSERT INTO activities (workspace_id, user_id, lead_id, type, message)
      VALUES (${workspace.id}, ${userId}, ${activity.lead_id}, ${activity.type}, ${activity.message})
      RETURNING id, lead_id, type, message, timestamp
    `;
    return json(res, 201, { data: rows[0] });
  },
});
