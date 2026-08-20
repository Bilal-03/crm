import { createEmailProvider } from '../server/communications.js';
import { getGoogleCalendarConfig } from '../server/calendar-providers/google.js';
import { getDb } from '../server/db.js';
import { json, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const provider = createEmailProvider();
    const calendarProvider = getGoogleCalendarConfig();
    const integrations = await sql`
      SELECT id, kind, provider, status, external_account_id, display_name,
             scopes, token_expires_at, last_synced_at, last_error, created_at, updated_at
      FROM communication_integrations
      WHERE workspace_id = ${workspace.id} AND owner_user_id = ${userId}
      ORDER BY kind, provider, created_at
    `;
    return json(res, 200, { data: {
      email: {
        provider: provider.name,
        configured: provider.configured,
        fromAddress: provider.fromAddress || null,
        configurationError: provider.configured ? null : provider.configurationError,
      },
      integrations,
      calendar: {
        providerConfigured: calendarProvider.configured,
        connected: integrations.some(item => item.kind === 'calendar' && item.provider === 'google' && item.status === 'connected'),
        configured: integrations.some(item => item.kind === 'calendar' && item.provider === 'google' && item.status === 'connected'),
        connection: integrations.find(item => item.kind === 'calendar' && item.provider === 'google') || null,
        message: calendarProvider.configured
          ? 'Connect your Google account to sync CRM meetings and Google Meet links.'
          : `Google Calendar server configuration is incomplete: ${calendarProvider.missing.join(', ')}.`,
      },
    } });
  },
});
