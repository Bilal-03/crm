import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = read('../../migrations/011_phase7_google_calendar.sql');
const connect = read('../../routes/integrations/google-calendar/connect.js');
const callback = read('../../routes/integrations/google-calendar/callback.js');
const disconnect = read('../../routes/integrations/google-calendar/disconnect.js');
const calendarEvents = read('../../routes/calendar-events.js');
const meetings = read('../../routes/meetings.js');
const routes = read('../../api/[...route].js');
const connectEntry = read('../../api/integrations/google-calendar/connect.js');
const callbackEntry = read('../../api/integrations/google-calendar/callback.js');
const disconnectEntry = read('../../api/integrations/google-calendar/disconnect.js');

test('Google Calendar migration stores encrypted credentials and one-time OAuth state', () => {
  for (const table of ['integration_credentials', 'integration_oauth_states']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /access_token_encrypted/);
  assert.match(migration, /refresh_token_encrypted/);
  assert.match(migration, /state_hash CHAR\(64\).*UNIQUE/);
  assert.match(migration, /consumed_at/);
  assert.match(migration, /011_phase7_google_calendar/);
});

test('OAuth flow hashes and atomically consumes state without persisting raw tokens', () => {
  assert.match(connect, /hashOAuthState\(state\)/);
  assert.match(connect, /INTERVAL '10 minutes'/);
  assert.match(callback, /UPDATE integration_oauth_states SET consumed_at = NOW\(\)/);
  assert.match(callback, /consumed_at IS NULL AND expires_at > NOW\(\)/);
  assert.match(callback, /encryptSecret\(tokens\.access_token\)/);
  assert.match(callback, /COALESCE\(EXCLUDED\.refresh_token_encrypted/);
  assert.match(disconnect, /DELETE FROM integration_credentials/);
});

test('meeting sync is tenant scoped, retryable and prevents orphaned external events', () => {
  assert.match(calendarEvents, /getActiveWorkspace/);
  assert.match(calendarEvents, /workspace_id = \$\{workspace\.id\}/);
  assert.match(calendarEvents, /getValidCalendarAccess/);
  assert.match(calendarEvents, /sync_status = 'failed'/);
  assert.match(calendarEvents, /INSERT INTO notifications/);
  assert.match(calendarEvents, /deleteEvent/);
  assert.match(meetings, /calendar_delete_required/);
  assert.match(meetings, /sync_status = CASE WHEN external_event_id IS NOT NULL THEN 'pending'/);
});

test('single Vercel handler exposes calendar OAuth and event sync routes', () => {
  for (const route of ['calendar-events', 'integrations/google-calendar/connect', 'integrations/google-calendar/callback', 'integrations/google-calendar/disconnect']) {
    assert.match(routes, new RegExp(route.replaceAll('/', '\\/')));
  }
});

test('nested Google OAuth URLs have explicit Vercel function entry points', () => {
  assert.match(connectEntry, /routes\/integrations\/google-calendar\/connect\.js/);
  assert.match(callbackEntry, /routes\/integrations\/google-calendar\/callback\.js/);
  assert.match(disconnectEntry, /routes\/integrations\/google-calendar\/disconnect\.js/);
});

function read(path) { return fs.readFileSync(new URL(path, import.meta.url), 'utf8'); }
