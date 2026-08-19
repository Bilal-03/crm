import { getDb } from '../../server/db.js';
import { HttpError, json, withApiRoute } from '../../server/http.js';
import { validateBulkLeadOperation } from '../../server/validation.js';
import { getActiveWorkspace } from '../../server/workspaces.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId }) {
    const operation = validateBulkLeadOperation(req.body);
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (operation.action === 'update') {
      const rows = await sql`
        UPDATE leads
        SET
          stage = ${operation.stage},
          won_at = CASE
            WHEN ${operation.stage === 'closed-won'} THEN COALESCE(won_at, NOW())
            ELSE NULL
          END,
          lost_at = CASE
            WHEN ${operation.stage === 'closed-lost'} THEN COALESCE(lost_at, NOW())
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE workspace_id = ${workspace.id}
          AND id = ANY(${operation.ids}::uuid[])
          AND (
            SELECT COUNT(*)
            FROM leads
            WHERE workspace_id = ${workspace.id}
              AND id = ANY(${operation.ids}::uuid[])
          ) = ${operation.ids.length}
        RETURNING id, stage, updated_at, won_at, lost_at
      `;
      assertAllRowsMatched(rows, operation.ids.length);
      return json(res, 200, { data: { action: operation.action, leads: rows } });
    }

    const rows = await sql`
      DELETE FROM leads
      WHERE workspace_id = ${workspace.id}
        AND id = ANY(${operation.ids}::uuid[])
        AND (
          SELECT COUNT(*)
          FROM leads
          WHERE workspace_id = ${workspace.id}
            AND id = ANY(${operation.ids}::uuid[])
        ) = ${operation.ids.length}
      RETURNING id
    `;
    assertAllRowsMatched(rows, operation.ids.length);
    return json(res, 200, { data: { action: operation.action, deletedIds: rows.map(row => row.id) } });
  },
});

function assertAllRowsMatched(rows, expectedCount) {
  if (rows.length !== expectedCount) {
    throw new HttpError(409, 'bulk_conflict', 'The bulk operation was not applied because one or more leads no longer exist in this workspace.');
  }
}
