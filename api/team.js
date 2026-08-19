import { createClerkClient } from '@clerk/backend';

import { getDb } from '../server/db.js';
import { HttpError, json, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';

const ROLES = ['admin', 'member'];

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      if (req.query?.view === 'invitations') {
        const currentEmail = await getUserEmail(userId);
        const invitations = await sql`SELECT i.id, i.role, i.expires_at, w.name AS workspace_name FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id WHERE lower(i.email) = ${currentEmail} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW() ORDER BY i.created_at DESC`;
        return json(res, 200, { data: { invitations } });
      }
      const [members, invitations, workspaces] = await Promise.all([
        sql`SELECT user_id, email, role, created_at FROM workspace_members WHERE workspace_id = ${workspace.id} ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at`,
        sql`SELECT id, email, role, created_at, expires_at FROM workspace_invitations WHERE workspace_id = ${workspace.id} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`,
        sql`SELECT w.id, w.name, w.base_currency, w.timezone, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ${userId} ORDER BY w.created_at`,
      ]);
      return json(res, 200, { data: { workspace, members, invitations, workspaces } });
    }

    const body = req.body || {};
    if (body.action === 'accept') return json(res, 200, { data: await acceptInvitation(sql, userId, body.invitationId) });
    requireManager(workspace.role);

    if (body.action === 'invite') return json(res, 201, { data: await createInvitation(sql, workspace.id, userId, body) });
    if (body.action === 'rename') return json(res, 200, { data: await renameWorkspace(sql, workspace, body.name) });
    if (body.action === 'settings') return json(res, 200, { data: await updateWorkspaceSettings(sql, workspace, body) });
    if (body.action === 'role') return json(res, 200, { data: await updateRole(sql, workspace, body) });
    if (body.action === 'remove') return json(res, 200, { data: await removeMember(sql, workspace, body) });
    if (body.action === 'revoke') return json(res, 200, { data: await revokeInvitation(sql, workspace.id, body.invitationId) });
    throw new HttpError(400, 'invalid_action', 'Unsupported team action.');
  },
});

function requireManager(role) {
  if (!['owner', 'admin'].includes(role)) throw new HttpError(403, 'team_permission_denied', 'Only workspace owners and admins can manage the team.');
}

async function renameWorkspace(sql, workspace, value) {
  if (workspace.role !== 'owner') throw new HttpError(403, 'team_permission_denied', 'Only the workspace owner can rename the workspace.');
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 160) throw new HttpError(400, 'validation_error', 'Workspace name must be between 2 and 160 characters.');
  const rows = await sql`UPDATE workspaces SET name = ${name}, updated_at = NOW() WHERE id = ${workspace.id} RETURNING id, name`;
  return rows[0];
}

async function updateWorkspaceSettings(sql, workspace, body) {
  const currency = typeof body.baseCurrency === 'string' ? body.baseCurrency.trim().toUpperCase() : workspace.base_currency;
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : workspace.timezone;
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'validation_error', 'baseCurrency must be a three-letter currency code.');
  if (!timezone || timezone.length > 64) throw new HttpError(400, 'validation_error', 'timezone must be between 1 and 64 characters.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new HttpError(400, 'validation_error', 'timezone must be a valid IANA timezone.');
  }
  const rows = await sql`
    UPDATE workspaces
    SET base_currency = ${currency}, timezone = ${timezone}, updated_at = NOW()
    WHERE id = ${workspace.id}
    RETURNING id, name, base_currency, timezone, updated_at
  `;
  return rows[0];
}

function email(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'validation_error', 'A valid email address is required.');
  return normalized;
}

function role(value) {
  if (!ROLES.includes(value)) throw new HttpError(400, 'validation_error', 'Role must be admin or member.');
  return value;
}

async function createInvitation(sql, workspaceId, userId, body) {
  const inviteEmail = email(body.email);
  const inviteRole = role(body.role);
  const existing = await sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND lower(email) = ${inviteEmail}`;
  if (existing[0]) throw new HttpError(409, 'already_member', 'This email already belongs to a workspace member.');
  const rows = await sql`
    INSERT INTO workspace_invitations (workspace_id, email, role, invited_by_user_id)
    VALUES (${workspaceId}, ${inviteEmail}, ${inviteRole}, ${userId})
    ON CONFLICT (workspace_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL
    DO UPDATE SET role = EXCLUDED.role, invited_by_user_id = EXCLUDED.invited_by_user_id, created_at = NOW(), expires_at = NOW() + INTERVAL '14 days'
    RETURNING id, email, role, created_at, expires_at
  `;
  return rows[0];
}

async function updateRole(sql, workspace, body) {
  if (workspace.role !== 'owner') throw new HttpError(403, 'team_permission_denied', 'Only the workspace owner can change roles.');
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const rows = await sql`UPDATE workspace_members SET role = ${role(body.role)} WHERE workspace_id = ${workspace.id} AND user_id = ${userId} AND role <> 'owner' RETURNING user_id, email, role`;
  if (!rows[0]) throw new HttpError(404, 'member_not_found', 'Member not found.');
  return rows[0];
}

async function removeMember(sql, workspace, body) {
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const rows = await sql`DELETE FROM workspace_members WHERE workspace_id = ${workspace.id} AND user_id = ${userId} AND role <> 'owner' RETURNING user_id`;
  if (!rows[0]) throw new HttpError(404, 'member_not_found', 'Member not found.');
  return rows[0];
}

async function revokeInvitation(sql, workspaceId, invitationId) {
  const rows = await sql`UPDATE workspace_invitations SET revoked_at = NOW() WHERE id = ${invitationId} AND workspace_id = ${workspaceId} AND accepted_at IS NULL RETURNING id`;
  if (!rows[0]) throw new HttpError(404, 'invitation_not_found', 'Invitation not found.');
  return rows[0];
}

async function acceptInvitation(sql, userId, invitationId) {
  if (typeof invitationId !== 'string') throw new HttpError(400, 'validation_error', 'Invitation ID is required.');
  const primaryEmail = await getUserEmail(userId);
  if (!primaryEmail) throw new HttpError(400, 'missing_email', 'Your account needs a primary email address to accept an invitation.');
  const invitations = await sql`SELECT id, workspace_id, role, email FROM workspace_invitations WHERE id = ${invitationId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`;
  const invitation = invitations[0];
  if (!invitation || invitation.email.toLowerCase() !== primaryEmail) throw new HttpError(404, 'invitation_not_found', 'Invitation not found.');
  await sql`INSERT INTO workspace_members (workspace_id, user_id, email, role) VALUES (${invitation.workspace_id}, ${userId}, ${primaryEmail}, ${invitation.role}) ON CONFLICT (workspace_id, user_id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`;
  await sql`UPDATE workspace_invitations SET accepted_at = NOW() WHERE id = ${invitation.id}`;
  return { workspaceId: invitation.workspace_id, role: invitation.role };
}

async function getUserEmail(userId) {
  if (!process.env.CLERK_SECRET_KEY) throw new HttpError(503, 'team_identity_unavailable', 'Team invitations require CLERK_SECRET_KEY.');
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(userId);
  const primaryEmail = user.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!primaryEmail) throw new HttpError(400, 'missing_email', 'Your account needs a primary email address to use team invitations.');
  return primaryEmail;
}
