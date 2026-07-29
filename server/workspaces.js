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

  return workspace;
}
