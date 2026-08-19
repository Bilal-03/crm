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
import { getAccountInWorkspace, resolveOwnerUser } from '../server/core-model.js';
import { normalizeDomain, normalizeName, normalizePhone } from '../server/normalization.js';
import { validateAccount } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search', 160);
      const owner = getQueryString(req.query, 'owner', 256);
      const orderBy = getSort(req.query, {
        created: 'a.created_at',
        updated: 'a.updated_at',
        name: 'a.name',
      }, 'created', 'desc', 'a.id');
      const rows = await sql`
        SELECT a.id, a.workspace_id, a.owner_user_id, a.created_by, a.updated_by,
               a.name, a.normalized_name, a.domain, a.normalized_domain, a.phone,
               a.normalized_phone, a.website, a.industry, a.created_at, a.updated_at,
               COUNT(DISTINCT c.id)::int AS contact_count,
               COUNT(DISTINCT d.id)::int AS deal_count,
               COALESCE((
                 SELECT SUM(d2.amount)
                 FROM deals d2
                 WHERE d2.account_id = a.id AND d2.workspace_id = a.workspace_id AND d2.status = 'open'
               ), 0) AS open_pipeline_amount,
               COUNT(*) OVER() AS __total_count
        FROM accounts a
        LEFT JOIN contacts c ON c.account_id = a.id AND c.workspace_id = a.workspace_id
        LEFT JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
        WHERE a.workspace_id = ${workspace.id}
          AND (${search}::text IS NULL OR a.name ILIKE ${search ? `%${search}%` : null}
            OR a.domain ILIKE ${search ? `%${search}%` : null}
            OR a.phone ILIKE ${search ? `%${search}%` : null}
            OR a.website ILIKE ${search ? `%${search}%` : null})
          AND (${owner}::text IS NULL OR a.owner_user_id = ${owner})
        GROUP BY a.id
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateAccount(req.body);
      const ownerUserId = await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id);
      const rows = await sql`
        INSERT INTO accounts (
          workspace_id, owner_user_id, created_by, updated_by, name, normalized_name,
          domain, normalized_domain, phone, normalized_phone, website, industry
        )
        VALUES (
          ${workspace.id}, ${ownerUserId}, ${userId}, ${userId}, ${input.name}, ${normalizeName(input.name)},
          ${input.domain ?? null}, ${normalizeDomain(input.domain)}, ${input.phone ?? null}, ${normalizePhone(input.phone)},
          ${input.website ?? null}, ${input.industry ?? null}
        )
        RETURNING id, workspace_id, owner_user_id, created_by, updated_by, name, normalized_name,
                  domain, normalized_domain, phone, normalized_phone, website, industry, created_at, updated_at
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);
    const existing = await getAccountInWorkspace(sql, workspace.id, id);
    if (!existing) throw new HttpError(404, 'not_found', 'Account not found.');

    if (req.method === 'PUT') {
      const input = validateAccount(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      const ownerUserId = has('owner_user_id')
        ? await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id)
        : existing.owner_user_id;
      const rows = await sql`
        UPDATE accounts
        SET
          owner_user_id = ${has('owner_user_id') ? ownerUserId : existing.owner_user_id},
          updated_by = ${userId},
          name = ${has('name') ? input.name : existing.name},
          normalized_name = ${has('name') ? normalizeName(input.name) : existing.normalized_name},
          domain = ${has('domain') ? input.domain : existing.domain},
          normalized_domain = ${has('domain') ? normalizeDomain(input.domain) : existing.normalized_domain},
          phone = ${has('phone') ? input.phone : existing.phone},
          normalized_phone = ${has('phone') ? normalizePhone(input.phone) : existing.normalized_phone},
          website = ${has('website') ? input.website : existing.website},
          industry = ${has('industry') ? input.industry : existing.industry},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, workspace_id, owner_user_id, created_by, updated_by, name, normalized_name,
                  domain, normalized_domain, phone, normalized_phone, website, industry, created_at, updated_at
      `;
      return json(res, 200, { data: rows[0] });
    }

    const deleted = await sql`
      DELETE FROM accounts
      WHERE id = ${id} AND workspace_id = ${workspace.id}
      RETURNING id
    `;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Account not found.');
    return noContent(res);
  },
});
