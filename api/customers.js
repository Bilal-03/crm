import { getDb } from '../server/db.js';
import { getPagination, json, paginated, withApiRoute } from '../server/http.js';
import { validateCustomer } from '../server/validation.js';
import { getPersonalWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getPersonalWorkspace(sql, userId);

    if (req.method === 'GET') {
      const { limit, offset } = getPagination(req.query);
      const rows = await sql`
        SELECT id, name, company, email, phone, created_at, updated_at
        FROM customers
        WHERE workspace_id = ${workspace.id}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      return json(res, 200, paginated(rows, limit, offset));
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
