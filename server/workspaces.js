/**
 * Resolves the caller's personal workspace. Every existing account receives one
 * during migration; this upsert also makes first sign-in provisioning safe.
 */
export async function getPersonalWorkspace(sql, userId) {
  const rows = await sql`
    INSERT INTO workspaces (owner_user_id, name)
    VALUES (${userId}, 'Personal CRM')
    ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
    RETURNING id, owner_user_id, name
  `;
  const workspace = rows[0];

  await sql`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    VALUES (${workspace.id}, ${userId}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;

  return { ...workspace, role: 'owner' };
}

export async function getActiveWorkspace(sql, userId, requestedWorkspaceId) {
  const personalWorkspace = await getPersonalWorkspace(sql, userId);
  const requestedId = Array.isArray(requestedWorkspaceId) ? requestedWorkspaceId[0] : requestedWorkspaceId;

  if (!requestedId || requestedId === personalWorkspace.id) return personalWorkspace;
  if (typeof requestedId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) {
    throw new HttpError(400, 'invalid_workspace', 'Invalid workspace selection.');
  }

  const rows = await sql`
    SELECT w.id, w.owner_user_id, w.name, m.role
    FROM workspace_members m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = ${requestedId} AND m.user_id = ${userId}
  `;
  if (!rows[0]) throw new HttpError(403, 'workspace_access_denied', 'You do not have access to this workspace.');
  return rows[0];
}
import { HttpError } from './http.js';
