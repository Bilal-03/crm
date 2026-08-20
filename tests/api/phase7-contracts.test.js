import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../migrations/009_phase7_communications.sql', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../../routes/messages.js', import.meta.url), 'utf8');
const templates = fs.readFileSync(new URL('../../routes/email-templates.js', import.meta.url), 'utf8');
const notifications = fs.readFileSync(new URL('../../routes/notifications.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../api/[...route].js', import.meta.url), 'utf8');
const appRoutes = fs.readFileSync(new URL('../../src/app/routes.js', import.meta.url), 'utf8');

test('Phase 7 migration is additive, idempotent and stores observable integration state without raw tokens', () => {
  for (const table of ['communication_integrations', 'email_templates', 'outbound_messages', 'notifications']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
  }
  for (const column of ['external_event_id', 'meeting_url', 'sync_status', 'last_synced_at']) {
    assert.match(migration, new RegExp(column));
    assert.match(schema, new RegExp(column));
  }
  assert.match(migration, /token_reference/);
  assert.doesNotMatch(migration, /access_token\s/);
  assert.match(migration, /UNIQUE \(workspace_id, idempotency_key\)/);
  assert.match(migration, /provider_idempotency_key/);
  assert.match(migration, /ON CONFLICT \(version\) DO NOTHING/);
  assert.match(migration, /009_phase7_communications/);
});

test('outbound messages are tenant safe, idempotent, retryable and timeline linked', () => {
  assert.match(messages, /getActiveWorkspace/);
  assert.match(messages, /workspace_id = \$\{workspace\.id\}/);
  assert.match(messages, /ON CONFLICT \(workspace_id, idempotency_key\) DO NOTHING/);
  assert.match(messages, /providerIdempotencyKey = retry/);
  assert.match(messages, /idempotencyKey: providerIdempotencyKey/);
  assert.match(messages, /retry_of_id/);
  assert.match(messages, /Only failed messages can be retried/);
  assert.match(messages, /INSERT INTO activities/);
  assert.match(messages, /INSERT INTO notifications/);
  assert.match(messages, /provider_message_id/);
});

test('templates and notifications remain scoped to the active workspace and current user', () => {
  for (const source of [templates, notifications]) {
    assert.match(source, /getActiveWorkspace/);
    assert.match(source, /workspace_id = \$\{workspace\.id\}/);
  }
  assert.match(notifications, /recipient_user_id = \$\{userId\}/);
  assert.match(templates, /is_active = false/);
});

test('single Vercel handler and SPA router expose the Phase 7 communication workspace', () => {
  for (const route of ['messages', 'notifications', 'email-templates', 'communication-status']) {
    assert.match(routes, new RegExp(`['"]?${route.replace('-', '\\-')}['"]?`));
  }
  assert.match(appRoutes, /communications.*\/communications/);
});
