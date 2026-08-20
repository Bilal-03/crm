import { HttpError } from './http.js';

export function canAccessAllRecords(workspace) {
  return ['owner', 'admin'].includes(workspace?.role);
}

export function assertOwnerAccess(workspace, userId, recordOwnerUserId) {
  if (!canAccessAllRecords(workspace) && recordOwnerUserId !== userId) {
    throw new HttpError(403, 'record_access_denied', 'Your role can access only records assigned to you.');
  }
}

export function assertAssignableOwner(workspace, userId, requestedOwnerUserId) {
  if (!canAccessAllRecords(workspace) && requestedOwnerUserId && requestedOwnerUserId !== userId) {
    throw new HttpError(403, 'assignment_denied', 'Your role cannot assign records to another team member.');
  }
}

export async function assertRecordAccess(sql, workspace, userId, table, ownerColumn, recordId) {
  if (canAccessAllRecords(workspace)) return;
  const rows = await sql`
    SELECT id FROM ${sql.unsafe(table)}
    WHERE id = ${recordId} AND workspace_id = ${workspace.id}
      AND ${sql.unsafe(ownerColumn)} = ${userId}
  `;
  if (!rows[0]) throw new HttpError(403, 'record_access_denied', 'Your role can access only records assigned to you.');
}

export async function assertCrmTargetAccess(sql, workspace, userId, input = {}) {
  const targets = [
    ['lead_id', 'leads', 'user_id'],
    ['account_id', 'accounts', 'owner_user_id'],
    ['contact_id', 'contacts', 'owner_user_id'],
    ['primary_contact_id', 'contacts', 'owner_user_id'],
    ['deal_id', 'deals', 'owner_user_id'],
    ['customer_id', 'customers', 'user_id'],
  ];
  for (const [field, table, ownerColumn] of targets) {
    if (input[field]) await assertRecordAccess(sql, workspace, userId, table, ownerColumn, input[field]);
  }
}
