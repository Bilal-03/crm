import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryString,
  getSort,
  json,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { validateCustomer } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const orderBy = getSort(req.query, {
        created: 'created_at',
        updated: 'updated_at',
        name: 'name',
        company: 'company',
      }, 'created');
      const rows = await sql`
        SELECT id, name, company, email, phone, created_at, updated_at, COUNT(*) OVER() AS __total_count
        FROM customers
        WHERE workspace_id = ${workspace.id}
          AND (${search}::text IS NULL OR name ILIKE ${search ? `%${search}%` : null} OR company ILIKE ${search ? `%${search}%` : null} OR email ILIKE ${search ? `%${search}%` : null} OR phone ILIKE ${search ? `%${search}%` : null})
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    const customer = validateCustomer(req.body);
    const rows = await sql`
      INSERT INTO customers (workspace_id, user_id, name, company, email, phone)
      VALUES (${workspace.id}, ${userId}, ${customer.name}, ${customer.company}, ${customer.email}, ${customer.phone})
      ON CONFLICT (workspace_id, lower(email)) DO UPDATE SET
        name = EXCLUDED.name,
        company = EXCLUDED.company,
        phone = EXCLUDED.phone,
        updated_at = NOW()
      RETURNING id, name, company, email, phone, created_at, updated_at
    `;
    return json(res, 201, { data: rows[0] });
  },
});
