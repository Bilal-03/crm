import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryDate,
  getQueryString,
  getSort,
  HttpError,
  json,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { validateActivity } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const type = getQueryString(req.query, 'type', 80);
      const from = getQueryDate(req.query, 'from');
      const to = getQueryDate(req.query, 'to');
      const orderBy = getSort(req.query, {
        timestamp: 'timestamp',
        type: 'type',
      }, 'timestamp');
      const rows = await sql`
        SELECT id, lead_id, type, message, timestamp, COUNT(*) OVER() AS __total_count
        FROM activities
        WHERE workspace_id = ${workspace.id}
          AND (${search}::text IS NULL OR type ILIKE ${search ? `%${search}%` : null} OR message ILIKE ${search ? `%${search}%` : null})
          AND (${type}::text IS NULL OR type = ${type})
          AND (${from}::date IS NULL OR timestamp >= ${from}::date)
          AND (${to}::date IS NULL OR timestamp < (${to}::date + INTERVAL '1 day'))
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
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
