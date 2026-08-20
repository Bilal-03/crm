import { createGoogleCalendarProvider, GOOGLE_CALENDAR_SCOPES } from '../../../server/calendar-providers/google.js';
import { getDb } from '../../../server/db.js';
import { encryptSecret, hashOAuthState } from '../../../server/integration-secrets.js';

export default async function callback(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (!appBaseUrl) return sendError(res, null, 'app_not_configured');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method not allowed');
  }

  const state = scalar(req.query?.state);
  const code = scalar(req.query?.code);
  const oauthError = scalar(req.query?.error);
  if (!state || oauthError || !code) return sendError(res, appBaseUrl, oauthError || 'invalid_callback');

  try {
    const sql = getDb();
    const states = await sql`
      UPDATE integration_oauth_states SET consumed_at = NOW()
      WHERE state_hash = ${hashOAuthState(state)} AND provider = 'google'
        AND consumed_at IS NULL AND expires_at > NOW()
      RETURNING id, workspace_id, user_id, return_path
    `;
    const oauthState = states[0];
    if (!oauthState) return sendError(res, appBaseUrl, 'invalid_or_expired_state');

    const provider = createGoogleCalendarProvider();
    const tokens = await provider.exchangeCode(code);
    const profile = await provider.getProfile(tokens.access_token);
    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3_600) * 1_000).toISOString();
    const integrations = await sql`
      INSERT INTO communication_integrations (
        workspace_id, kind, owner_user_id, provider, status, external_account_id,
        calendar_id, display_name, scopes, token_expires_at, created_by, updated_by
      ) VALUES (
        ${oauthState.workspace_id}, 'calendar', ${oauthState.user_id}, 'google', 'connected',
        ${profile.email || profile.sub}, 'primary', ${profile.email || 'Google Calendar'},
        ${JSON.stringify(GOOGLE_CALENDAR_SCOPES)}, ${expiresAt}, ${oauthState.user_id}, ${oauthState.user_id}
      )
      ON CONFLICT (workspace_id, owner_user_id, kind, provider) DO UPDATE SET
        status = 'connected', external_account_id = EXCLUDED.external_account_id,
        display_name = EXCLUDED.display_name, scopes = EXCLUDED.scopes,
        token_expires_at = EXCLUDED.token_expires_at, last_error = NULL,
        revoked_at = NULL, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING id, workspace_id
    `;
    const integration = integrations[0];
    const credentials = await sql`
      INSERT INTO integration_credentials (
        workspace_id, integration_id, access_token_encrypted, refresh_token_encrypted,
        token_type, expires_at, scopes
      ) VALUES (
        ${integration.workspace_id}, ${integration.id}, ${encryptSecret(tokens.access_token)},
        ${tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null},
        ${tokens.token_type || 'Bearer'}, ${expiresAt},
        ${JSON.stringify(String(tokens.scope || GOOGLE_CALENDAR_SCOPES.join(' ')).split(' '))}
      )
      ON CONFLICT (integration_id, workspace_id) DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, integration_credentials.refresh_token_encrypted),
        token_type = EXCLUDED.token_type, expires_at = EXCLUDED.expires_at,
        scopes = EXCLUDED.scopes, updated_at = NOW()
      RETURNING id
    `;
    await sql`
      UPDATE communication_integrations SET token_reference = ${credentials[0].id}, updated_at = NOW()
      WHERE id = ${integration.id} AND workspace_id = ${integration.workspace_id}
    `;
    return redirect(res, `${appBaseUrl}${safeReturnPath(oauthState.return_path)}?integration=google-calendar-connected`);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'google_calendar_oauth_failed', error: error instanceof Error ? error.message : String(error) }));
    return sendError(res, appBaseUrl, 'google_calendar_connection_failed');
  }
}

function scalar(value) { return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : null; }
function safeReturnPath(value) { return typeof value === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(value) ? value : '/communications'; }
function redirect(res, location) { res.statusCode = 302; res.setHeader('Location', location); return res.end(); }
function sendError(res, base, code) {
  if (base) return redirect(res, `${base}/communications?integration_error=${encodeURIComponent(code)}`);
  res.statusCode = 503;
  return res.end('Calendar integration is not configured.');
}
