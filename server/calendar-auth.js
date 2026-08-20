import { createGoogleCalendarProvider } from './calendar-providers/google.js';
import { decryptSecret, encryptSecret } from './integration-secrets.js';
import { HttpError } from './http.js';

export async function getCalendarConnection(sql, workspaceId, userId) {
  const rows = await sql`
    SELECT i.*, c.id AS credential_id, c.access_token_encrypted,
           c.refresh_token_encrypted, c.expires_at AS credential_expires_at
    FROM communication_integrations i
    JOIN integration_credentials c ON c.integration_id = i.id AND c.workspace_id = i.workspace_id
    WHERE i.workspace_id = ${workspaceId} AND i.owner_user_id = ${userId}
      AND i.kind = 'calendar' AND i.provider = 'google' AND i.status = 'connected'
  `;
  if (!rows[0]) throw new HttpError(409, 'calendar_not_connected', 'Connect Google Calendar before syncing meetings.');
  return rows[0];
}

export async function getValidCalendarAccess(sql, connection, env = process.env) {
  const provider = createGoogleCalendarProvider({ env });
  const expiresAt = connection.credential_expires_at ? new Date(connection.credential_expires_at).getTime() : 0;
  if (!expiresAt || expiresAt > Date.now() + 60_000) {
    return { provider, accessToken: decryptSecret(connection.access_token_encrypted, env) };
  }
  if (!connection.refresh_token_encrypted) {
    throw new HttpError(401, 'calendar_reconnect_required', 'Google Calendar authorization expired. Reconnect the account.');
  }
  const refreshed = await provider.refreshAccessToken(decryptSecret(connection.refresh_token_encrypted, env));
  const expires = new Date(Date.now() + Number(refreshed.expires_in || 3_600) * 1_000).toISOString();
  await sql`
    UPDATE integration_credentials SET access_token_encrypted = ${encryptSecret(refreshed.access_token, env)},
      expires_at = ${expires}, token_type = ${refreshed.token_type || 'Bearer'}, updated_at = NOW()
    WHERE id = ${connection.credential_id} AND workspace_id = ${connection.workspace_id}
  `;
  await sql`
    UPDATE communication_integrations SET token_expires_at = ${expires}, last_error = NULL, updated_at = NOW()
    WHERE id = ${connection.id} AND workspace_id = ${connection.workspace_id}
  `;
  return { provider, accessToken: refreshed.access_token };
}
