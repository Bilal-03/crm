import { HttpError } from './http.js';
import { ensureDefaultPipeline } from './pipelines.js';

/**
 * Resolves the caller's personal workspace. Every existing account receives one
 * during migration; this upsert also makes first sign-in provisioning safe.
 */
export async function getPersonalWorkspace(sql, userId) {
  const rows = await sql`
    INSERT INTO workspaces (owner_user_id, name)
    VALUES (${userId}, 'Personal CRM')
    ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
    RETURNING id, owner_user_id, name, base_currency, timezone, legal_name,
              billing_email, billing_phone, billing_address, tax_registration_id,
              quote_prefix, invoice_prefix, credit_note_prefix,
              default_quote_terms, default_invoice_terms
  `;
  const workspace = rows[0];

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspace.id}, ${userId}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;

  const result = { ...workspace, role: 'owner' };
  await ensureDefaultPipeline(sql, result, userId);
  return result;
}

export async function getActiveWorkspace(sql, userId, requestedWorkspaceId) {
  const personalWorkspace = await getPersonalWorkspace(sql, userId);
  const requestedId = Array.isArray(requestedWorkspaceId) ? requestedWorkspaceId[0] : requestedWorkspaceId;

  if (!requestedId || requestedId === personalWorkspace.id) return personalWorkspace;
  if (typeof requestedId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) {
    throw new HttpError(400, 'invalid_workspace', 'Invalid workspace selection.');
  }

  const rows = await sql`
    SELECT w.id, w.owner_user_id, w.name, w.base_currency, w.timezone,
           w.legal_name, w.billing_email, w.billing_phone, w.billing_address,
           w.tax_registration_id, w.quote_prefix, w.invoice_prefix,
           w.credit_note_prefix, w.default_quote_terms, w.default_invoice_terms,
           m.role
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = ${requestedId} AND m.user_id = ${userId}
  `;
  if (!rows[0]) throw new HttpError(403, 'workspace_access_denied', 'You do not have access to this workspace.');
  await ensureDefaultPipeline(sql, rows[0], userId);
  return rows[0];
}

export async function assertWorkspaceMember(sql, workspaceId, userId) {
  const rows = await sql`
    SELECT workspace_id, user_id, role
    FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
  `;
  if (!rows[0]) throw new HttpError(403, 'workspace_access_denied', 'You do not have access to this workspace.');
  return rows[0];
}
