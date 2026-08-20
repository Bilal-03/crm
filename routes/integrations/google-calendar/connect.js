import { randomBytes } from 'node:crypto';

import { createGoogleAuthorizationUrl } from '../../../server/calendar-providers/google.js';
import { getDb } from '../../../server/db.js';
import { hashOAuthState } from '../../../server/integration-secrets.js';
import { json, withApiRoute } from '../../../server/http.js';
import { getActiveWorkspace } from '../../../server/workspaces.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const state = randomBytes(32).toString('base64url');
    await sql`
      INSERT INTO integration_oauth_states (workspace_id, user_id, provider, state_hash, expires_at)
      VALUES (${workspace.id}, ${userId}, 'google', ${hashOAuthState(state)}, NOW() + INTERVAL '10 minutes')
    `;
    await sql`
      DELETE FROM integration_oauth_states
      WHERE expires_at < NOW() - INTERVAL '1 day' OR consumed_at < NOW() - INTERVAL '1 day'
    `;
    return json(res, 200, { data: { authorizationUrl: createGoogleAuthorizationUrl({ state }) } });
  },
});
