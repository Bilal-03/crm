import { HttpError } from './http.js';
import { ensureDefaultPipeline } from './pipelines.js';

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves the caller's personal workspace. The common path is read-only;
 * provisioning writes and default-pipeline creation run only on first sign-in.
 */
export async function getPersonalWorkspace(sql, userId) {
  const existing = await sql`
    SELECT w.id, w.owner_user_id, w.name, w.base_currency, w.timezone, w.legal_name,
           w.billing_email, w.billing_phone, w.billing_address, w.tax_registration_id,
           w.quote_prefix, w.invoice_prefix, w.credit_note_prefix,
           w.default_quote_terms, w.default_invoice_terms,
           m.role
    FROM workspaces w
    LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ${userId}
    WHERE w.owner_user_id = ${userId}
    ORDER BY w.created_at ASC
    LIMIT 1
  `;
  if (existing[0]?.role) return existing[0];

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
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'
  `;

  const result = { ...workspace, role: 'owner' };
  const pipeline = await sql`
    SELECT id FROM pipelines WHERE workspace_id = ${workspace.id} LIMIT 1
  `;
  if (!pipeline[0]) await ensureDefaultPipeline(sql, result, userId);
  return result;
}

export async function getActiveWorkspace(sql, userId, requestedWorkspaceId) {
  const requestedId = Array.isArray(requestedWorkspaceId) ? requestedWorkspaceId[0] : requestedWorkspaceId;

  if (!requestedId) return getPersonalWorkspace(sql, userId);
  if (typeof requestedId !== 'string' || !WORKSPACE_ID_PATTERN.test(requestedId)) {
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
