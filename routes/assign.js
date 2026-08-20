import { getDb } from '../server/db.js';
import { HttpError, json, withApiRoute } from '../server/http.js';
import { resolveOwnerUser } from '../server/core-model.js';
import { validateBulkAssignment } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { notifyAssignment } from '../server/notifications.js';
import { assertAssignableOwner, canAccessAllRecords } from '../server/authorization.js';

const ASSIGNABLE = Object.freeze({
  leads: { table: 'leads', column: 'user_id' },
  contacts: { table: 'contacts', column: 'owner_user_id' },
  accounts: { table: 'accounts', column: 'owner_user_id' },
  deals: { table: 'deals', column: 'owner_user_id' },
  activities: { table: 'activities', column: 'owner_user_id' },
  invoices: { table: 'invoices', column: 'user_id' },
});

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId }) {
    const input = validateBulkAssignment(req.body);
    const config = ASSIGNABLE[input.resource];
    if (!config) throw new HttpError(400, 'invalid_resource', 'This resource does not support assignment.');
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    assertAssignableOwner(workspace, userId, input.owner_user_id);
    const accessAll = canAccessAllRecords(workspace);
    const ownerUserId = await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id);
    const rows = await sql`
      UPDATE ${sql.unsafe(config.table)}
      SET ${sql.unsafe(config.column)} = ${ownerUserId}, updated_at = NOW()
      WHERE workspace_id = ${workspace.id}
        AND id = ANY(${input.ids}::uuid[])
        AND (${accessAll} OR ${sql.unsafe(config.column)} = ${userId})
        AND (
          SELECT COUNT(*) FROM ${sql.unsafe(config.table)}
          WHERE workspace_id = ${workspace.id} AND id = ANY(${input.ids}::uuid[])
        ) = ${input.ids.length}
      RETURNING id, ${sql.unsafe(config.column)} AS owner_user_id
    `;
    if (rows.length !== input.ids.length) {
      throw new HttpError(409, 'bulk_conflict', 'The assignment was not applied because one or more records no longer exist in this workspace.');
    }
    await Promise.all(rows.map(row => notifyAssignment(sql, {
      workspaceId: workspace.id,
      actorUserId: userId,
      recipientUserId: ownerUserId,
      resource: input.resource,
      entityId: row.id,
    })));
    return json(res, 200, { data: { resource: input.resource, owner_user_id: ownerUserId, records: rows } });
  },
});
