import { getCalendarConnection } from '../../../server/calendar-auth.js';
import { createGoogleCalendarProvider } from '../../../server/calendar-providers/google.js';
import { getDb } from '../../../server/db.js';
import { decryptSecret } from '../../../server/integration-secrets.js';
import { json, withApiRoute } from '../../../server/http.js';
import { getActiveWorkspace } from '../../../server/workspaces.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const connection = await getCalendarConnection(sql, workspace.id, userId);
    try {
      const token = connection.refresh_token_encrypted || connection.access_token_encrypted;
      await createGoogleCalendarProvider().revoke(decryptSecret(token));
    } catch (error) {
      console.warn(JSON.stringify({ level: 'warn', event: 'google_calendar_revoke_failed', integrationId: connection.id, error: error instanceof Error ? error.message : String(error) }));
    }
    await sql.transaction([
      sql`DELETE FROM integration_credentials WHERE integration_id = ${connection.id} AND workspace_id = ${workspace.id}`,
      sql`
        UPDATE communication_integrations SET status = 'revoked', revoked_at = NOW(),
          token_reference = NULL, token_expires_at = NULL, sync_cursor = NULL, updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${connection.id} AND workspace_id = ${workspace.id}
      `,
    ]);
    return json(res, 200, { data: { status: 'revoked' } });
  },
});
