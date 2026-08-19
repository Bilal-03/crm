import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryString,
  getQueryUuid,
  getRequiredId,
  getSort,
  HttpError,
  json,
  noContent,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { getAccountInWorkspace, getContactInWorkspace, resolveOwnerUser } from '../server/core-model.js';
import { normalizeEmail, normalizePhone } from '../server/normalization.js';
import { validateContact } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search', 160);
      const accountId = getQueryUuid(req.query, 'account_id');
      const owner = getQueryString(req.query, 'owner', 256);
      const orderBy = getSort(req.query, {
        created: 'c.created_at',
        updated: 'c.updated_at',
        name: 'c.name',
      }, 'created', 'desc', 'c.id');
      const rows = await sql`
        SELECT c.id, c.workspace_id, c.account_id, c.owner_user_id, c.created_by, c.updated_by,
               c.name, c.title, c.email, c.normalized_email, c.phone, c.normalized_phone,
               c.source_lead_id, c.source_customer_id, c.created_at, c.updated_at,
               a.name AS account_name, COUNT(*) OVER() AS __total_count
        FROM contacts c
        LEFT JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id
        WHERE c.workspace_id = ${workspace.id}
          AND (${search}::text IS NULL OR c.name ILIKE ${search ? `%${search}%` : null}
            OR c.title ILIKE ${search ? `%${search}%` : null}
            OR c.email ILIKE ${search ? `%${search}%` : null}
            OR c.phone ILIKE ${search ? `%${search}%` : null})
          AND (${accountId}::uuid IS NULL OR c.account_id = ${accountId})
          AND (${owner}::text IS NULL OR c.owner_user_id = ${owner})
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows).data.map(({ account_name: accountName, ...contact }) => ({
        ...contact,
        account: contact.account_id ? { id: contact.account_id, name: accountName } : null,
      }));
      const total = Number(rows[0]?.__total_count ?? 0);
      return json(res, 200, paginated(result, pagination, total));
    }

    if (req.method === 'POST') {
      const input = validateContact(req.body);
      const account = await getAccountInWorkspace(sql, workspace.id, input.account_id);
      const ownerUserId = await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id);
      const rows = await sql`
        INSERT INTO contacts (
          workspace_id, account_id, owner_user_id, created_by, updated_by,
          name, title, email, normalized_email, phone, normalized_phone
        )
        VALUES (
          ${workspace.id}, ${account?.id ?? null}, ${ownerUserId}, ${userId}, ${userId},
          ${input.name}, ${input.title ?? null}, ${input.email ?? null}, ${normalizeEmail(input.email)},
          ${input.phone ?? null}, ${normalizePhone(input.phone)}
        )
        RETURNING id, workspace_id, account_id, owner_user_id, created_by, updated_by,
                  name, title, email, normalized_email, phone, normalized_phone,
                  source_lead_id, source_customer_id, created_at, updated_at
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);
    const existing = await getContactInWorkspace(sql, workspace.id, id);
    if (!existing) throw new HttpError(404, 'not_found', 'Contact not found.');

    if (req.method === 'PUT') {
      const input = validateContact(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      const account = has('account_id')
        ? await getAccountInWorkspace(sql, workspace.id, input.account_id)
        : null;
      const ownerUserId = has('owner_user_id')
        ? await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id)
        : existing.owner_user_id;
      const rows = await sql`
        UPDATE contacts
        SET
          account_id = ${has('account_id') ? account?.id ?? null : existing.account_id},
          owner_user_id = ${has('owner_user_id') ? ownerUserId : existing.owner_user_id},
          updated_by = ${userId},
          name = ${has('name') ? input.name : existing.name},
          title = ${has('title') ? input.title : existing.title},
          email = ${has('email') ? input.email : existing.email},
          normalized_email = ${has('email') ? normalizeEmail(input.email) : existing.normalized_email},
          phone = ${has('phone') ? input.phone : existing.phone},
          normalized_phone = ${has('phone') ? normalizePhone(input.phone) : existing.normalized_phone},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, workspace_id, account_id, owner_user_id, created_by, updated_by,
                  name, title, email, normalized_email, phone, normalized_phone,
                  source_lead_id, source_customer_id, created_at, updated_at
      `;
      return json(res, 200, { data: rows[0] });
    }

    const deleted = await sql`
      DELETE FROM contacts
      WHERE id = ${id} AND workspace_id = ${workspace.id}
      RETURNING id
    `;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Contact not found.');
    return noContent(res);
  },
});
