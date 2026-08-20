import { getDb } from '../server/db.js';
import { getQueryInteger, getQueryString, json, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { canAccessAllRecords } from '../server/authorization.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const accessAll = canAccessAllRecords(workspace);
    const query = getQueryString(req.query, 'q', 160);
    const limit = getQueryInteger(req.query, 'limit', 12, 1, 50);
    if (!query || query.length < 2) return json(res, 200, { data: [] });
    const pattern = `%${query}%`;

    const [leads, contacts, accounts, deals, invoices, activities, quotes] = await Promise.all([
      sql`
        SELECT id, name AS title, COALESCE(company, email, phone) AS subtitle, updated_at
        FROM leads
        WHERE workspace_id = ${workspace.id}
          AND (${accessAll} OR user_id = ${userId})
          AND (name ILIKE ${pattern} OR company ILIKE ${pattern} OR email ILIKE ${pattern} OR phone ILIKE ${pattern})
        ORDER BY updated_at DESC, id DESC LIMIT ${limit}
      `,
      sql`
        SELECT id, name AS title, COALESCE(title, email, phone) AS subtitle, updated_at
        FROM contacts
        WHERE workspace_id = ${workspace.id}
          AND (${accessAll} OR owner_user_id = ${userId})
          AND (name ILIKE ${pattern} OR title ILIKE ${pattern} OR email ILIKE ${pattern} OR phone ILIKE ${pattern})
        ORDER BY updated_at DESC, id DESC LIMIT ${limit}
      `,
      sql`
        SELECT id, name AS title, COALESCE(domain, industry, phone) AS subtitle, updated_at
        FROM accounts
        WHERE workspace_id = ${workspace.id}
          AND (${accessAll} OR owner_user_id = ${userId})
          AND (name ILIKE ${pattern} OR domain ILIKE ${pattern} OR industry ILIKE ${pattern} OR phone ILIKE ${pattern})
        ORDER BY updated_at DESC, id DESC LIMIT ${limit}
      `,
      sql`
        SELECT id, name AS title, COALESCE(account_name, stage_name, status) AS subtitle, updated_at
        FROM (
          SELECT d.id, d.name, d.status, a.name AS account_name, s.name AS stage_name, d.updated_at
          FROM deals d
          LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
          LEFT JOIN pipeline_stages s ON s.id = d.stage_id AND s.workspace_id = d.workspace_id
          WHERE d.workspace_id = ${workspace.id}
            AND (${accessAll} OR d.owner_user_id = ${userId})
        ) matches
        WHERE name ILIKE ${pattern} OR account_name ILIKE ${pattern} OR stage_name ILIKE ${pattern} OR status ILIKE ${pattern}
        ORDER BY updated_at DESC, id DESC LIMIT ${limit}
      `,
      sql`
        SELECT i.id, i.invoice_number AS title, COALESCE(c.name, c.company) AS subtitle, i.updated_at
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
        WHERE i.workspace_id = ${workspace.id}
          AND (${accessAll} OR i.user_id = ${userId})
          AND (i.invoice_number ILIKE ${pattern} OR c.name ILIKE ${pattern} OR c.company ILIKE ${pattern} OR i.status ILIKE ${pattern})
        ORDER BY i.updated_at DESC, i.id DESC LIMIT ${limit}
      `,
      sql`
        SELECT a.id, a.subject AS title,
               COALESCE(l.name, ac.name, c.name, d.name, a.type) AS subtitle, a.updated_at
        FROM activities a
        LEFT JOIN leads l ON l.id = a.lead_id AND l.workspace_id = a.workspace_id
        LEFT JOIN accounts ac ON ac.id = a.account_id AND ac.workspace_id = a.workspace_id
        LEFT JOIN contacts c ON c.id = a.contact_id AND c.workspace_id = a.workspace_id
        LEFT JOIN deals d ON d.id = a.deal_id AND d.workspace_id = a.workspace_id
        WHERE a.workspace_id = ${workspace.id}
          AND (${accessAll} OR a.owner_user_id = ${userId})
          AND (a.subject ILIKE ${pattern} OR a.description ILIKE ${pattern} OR a.message ILIKE ${pattern})
        ORDER BY a.updated_at DESC, a.id DESC LIMIT ${limit}
      `,
      sql`
        SELECT q.id, q.quote_number AS title,
               COALESCE(d.name, a.name, c.name, q.status) AS subtitle, q.updated_at
        FROM quotes q
        LEFT JOIN deals d ON d.id = q.deal_id AND d.workspace_id = q.workspace_id
        LEFT JOIN accounts a ON a.id = q.account_id AND a.workspace_id = q.workspace_id
        LEFT JOIN contacts c ON c.id = q.contact_id AND c.workspace_id = q.workspace_id
        WHERE q.workspace_id = ${workspace.id}
          AND (${accessAll} OR q.created_by = ${userId} OR d.owner_user_id = ${userId})
          AND (q.quote_number ILIKE ${pattern} OR d.name ILIKE ${pattern} OR a.name ILIKE ${pattern} OR c.name ILIKE ${pattern} OR q.status ILIKE ${pattern})
        ORDER BY q.updated_at DESC, q.id DESC LIMIT ${limit}
      `,
    ]);

    const result = [
      ...leads.map(row => searchRow(row, 'lead', 'leads', '/sales/leads')),
      ...contacts.map(row => searchRow(row, 'contact', 'contacts', '/sales/contacts')),
      ...accounts.map(row => searchRow(row, 'account', 'accounts', '/sales/accounts')),
      ...deals.map(row => searchRow(row, 'deal', 'deals', '/sales/deals')),
      ...invoices.map(row => searchRow(row, 'invoice', 'invoices', '/invoices')),
      ...activities.map(row => searchRow(row, 'activity', 'activities', '/activities')),
      ...quotes.map(row => searchRow(row, 'quote', 'quotes', '/quotes')),
    ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, limit);

    return json(res, 200, { data: result.map(({ updated_at: _updatedAt, ...row }) => row) });
  },
});

function searchRow(row, type, resource, route) {
  return {
    id: row.id,
    type,
    resource,
    title: row.title,
    subtitle: row.subtitle,
    route,
    updated_at: row.updated_at,
  };
}
