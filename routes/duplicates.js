import { getDb } from '../server/db.js';
import { getQueryEnum, getQueryInteger, HttpError, json, withApiRoute } from '../server/http.js';
import { validateMergeRequest } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

const RESOURCES = ['leads', 'contacts', 'accounts', 'customers'];

const CONFIG = Object.freeze({
  leads: { table: 'leads', fields: ['name', 'company', 'email', 'phone', 'source', 'stage', 'normalized_email', 'normalized_phone'] },
  contacts: { table: 'contacts', fields: ['name', 'title', 'email', 'phone', 'normalized_email', 'normalized_phone'] },
  accounts: { table: 'accounts', fields: ['name', 'domain', 'phone', 'website', 'industry', 'normalized_name', 'normalized_domain'] },
  customers: { table: 'customers', fields: ['name', 'company', 'email', 'phone', 'normalized_email', 'normalized_phone'] },
});

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId }) {
    const resource = req.method === 'GET'
      ? getQueryEnum(req.query, 'resource', RESOURCES) || 'leads'
      : validateMergeRequest(req.body).resource;
    const config = CONFIG[resource];
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const limit = getQueryInteger(req.query, 'limit', 50, 1, 200);
      const rows = await sql`
        SELECT id, ${sql.unsafe(config.fields.join(', '))}
        FROM ${sql.unsafe(config.table)}
        WHERE workspace_id = ${workspace.id}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${limit * 10}
      `;
      return json(res, 200, { data: findDuplicateGroups(rows, resource, limit) });
    }

    const input = validateMergeRequest(req.body);
    const ids = [input.survivor_id, ...input.duplicate_ids];
    const rows = await sql`
      SELECT id FROM ${sql.unsafe(config.table)}
      WHERE workspace_id = ${workspace.id} AND id = ANY(${ids}::uuid[])
    `;
    if (rows.length !== ids.length) throw new HttpError(409, 'merge_conflict', 'One or more records no longer exist in this workspace.');
    const queries = mergeQueries(sql, resource, workspace.id, input.survivor_id, input.duplicate_ids);
    await sql.transaction(queries);
    return json(res, 200, {
      data: {
        resource,
        survivor_id: input.survivor_id,
        merged_ids: input.duplicate_ids,
        preserved_links: preservedLinks(resource),
      },
    });
  },
});

function findDuplicateGroups(rows, resource, limit) {
  const parent = new Map(rows.map(row => [row.id, row.id]));
  const groups = new Map();
  const keysFor = row => {
    if (resource === 'accounts') return [row.normalized_name && `name:${row.normalized_name}`, row.normalized_domain && `domain:${row.normalized_domain}`].filter(Boolean);
    return [row.normalized_email && `email:${row.normalized_email}`, row.normalized_phone && `phone:${row.normalized_phone}`].filter(Boolean);
  };
  const find = id => {
    let current = id;
    while (parent.get(current) !== current) {
      parent.set(current, parent.get(parent.get(current)));
      current = parent.get(current);
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  const keyOwner = new Map();
  rows.forEach(row => keysFor(row).forEach(key => {
    if (keyOwner.has(key)) union(row.id, keyOwner.get(key));
    else keyOwner.set(key, row.id);
  }));
  rows.forEach(row => {
    const root = find(row.id);
    const group = groups.get(root) || { records: [], reasons: new Set() };
    group.records.push(row);
    keysFor(row).forEach(key => group.reasons.add(key.split(':', 1)[0]));
    groups.set(root, group);
  });
  return [...groups.values()]
    .filter(group => group.records.length > 1)
    .slice(0, limit)
    .map((group, index) => ({
      id: `duplicate-${index + 1}`,
      reasons: [...group.reasons],
      fields: CONFIG[resource].fields,
      records: group.records,
    }));
}

function mergeQueries(sql, resource, workspaceId, survivorId, duplicateIds) {
  const ids = duplicateIds;
  const queries = [];
  if (resource === 'leads') {
    queries.push(
      sql`UPDATE activities SET lead_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND lead_id = ANY(${ids}::uuid[])`,
      sql`UPDATE record_notes SET lead_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND lead_id = ANY(${ids}::uuid[])`,
      sql`UPDATE meetings SET lead_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND lead_id = ANY(${ids}::uuid[])`,
      sql`UPDATE contacts SET source_lead_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND source_lead_id = ANY(${ids}::uuid[])`,
      sql`
        UPDATE deals d
        SET source_lead_id = CASE
          WHEN d.id = (
            SELECT MIN(candidate.id) FROM deals candidate
            WHERE candidate.workspace_id = ${workspaceId} AND candidate.source_lead_id = ANY(${ids}::uuid[])
          ) AND NOT EXISTS (
            SELECT 1 FROM deals kept WHERE kept.workspace_id = ${workspaceId} AND kept.source_lead_id = ${survivorId}
          ) THEN ${survivorId}
          ELSE NULL
        END,
        updated_at = NOW()
        WHERE d.workspace_id = ${workspaceId} AND d.source_lead_id = ANY(${ids}::uuid[])
      `,
    );
  } else if (resource === 'contacts') {
    queries.push(
      sql`UPDATE activities SET contact_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND contact_id = ANY(${ids}::uuid[])`,
      sql`UPDATE record_notes SET contact_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND contact_id = ANY(${ids}::uuid[])`,
      sql`UPDATE deals SET primary_contact_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND primary_contact_id = ANY(${ids}::uuid[])`,
    );
  } else if (resource === 'accounts') {
    queries.push(
      sql`UPDATE activities SET account_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND account_id = ANY(${ids}::uuid[])`,
      sql`UPDATE record_notes SET account_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND account_id = ANY(${ids}::uuid[])`,
      sql`UPDATE contacts SET account_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND account_id = ANY(${ids}::uuid[])`,
      sql`UPDATE deals SET account_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND account_id = ANY(${ids}::uuid[])`,
    );
  } else {
    queries.push(
      sql`UPDATE invoices SET customer_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND customer_id = ANY(${ids}::uuid[])`,
      sql`UPDATE contacts SET source_customer_id = ${survivorId}, updated_at = NOW() WHERE workspace_id = ${workspaceId} AND source_customer_id = ANY(${ids}::uuid[])`,
    );
  }
  queries.push(sql`DELETE FROM ${sql.unsafe(CONFIG[resource].table)} WHERE workspace_id = ${workspaceId} AND id = ANY(${ids}::uuid[])`);
  return queries;
}

function preservedLinks(resource) {
  return resource === 'leads'
    ? ['activities', 'notes', 'meetings', 'contacts', 'deals']
    : resource === 'contacts'
      ? ['activities', 'notes', 'deals']
      : resource === 'accounts'
        ? ['activities', 'notes', 'contacts', 'deals']
        : ['invoices', 'contacts'];
}
