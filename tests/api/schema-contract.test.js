import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../migrations/005_phase0_data_correctness.sql', import.meta.url), 'utf8');
const phase2Migration = fs.readFileSync(new URL('../../migrations/006_phase2_core_model.sql', import.meta.url), 'utf8');
const phase4Migration = fs.readFileSync(new URL('../../migrations/007_phase4_productivity.sql', import.meta.url), 'utf8');
const phase5Migration = fs.readFileSync(new URL('../../migrations/008_phase5_quote_to_cash.sql', import.meta.url), 'utf8');
const phase7Migration = fs.readFileSync(new URL('../../migrations/009_phase7_communications.sql', import.meta.url), 'utf8');
const goalsMigration = fs.readFileSync(new URL('../../migrations/010_phase6_goals_quotas.sql', import.meta.url), 'utf8');
const calendarMigration = fs.readFileSync(new URL('../../migrations/011_phase7_google_calendar.sql', import.meta.url), 'utf8');

test('fresh schema includes the structures previously missing from Team Settings and Phase 0 reporting', () => {
  assert.match(schema, /CREATE TABLE workspace_invitations/);
  assert.match(schema, /email VARCHAR\(320\)/);
  assert.match(schema, /won_at TIMESTAMPTZ/);
  assert.match(schema, /lost_at TIMESTAMPTZ/);
  assert.match(schema, /CREATE TABLE schema_migrations/);
  assert.match(schema, /CREATE TABLE accounts/);
  assert.match(schema, /CREATE TABLE contacts/);
  assert.match(schema, /CREATE TABLE pipelines/);
  assert.match(schema, /CREATE TABLE pipeline_stages/);
  assert.match(schema, /CREATE TABLE deals/);
  assert.match(schema, /CREATE TABLE deal_stage_history/);
  assert.match(schema, /base_currency CHAR\(3\)/);
  assert.match(schema, /normalized_email VARCHAR\(320\)/);
});

test('Phase 0 migration is idempotent for new structures and records its version', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS won_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS workspace_invitations/);
  assert.match(migration, /ON CONFLICT \(version\) DO NOTHING/);
  assert.match(migration, /005_phase0_data_correctness/);
});

test('Phase 2 migration is backward-compatible, idempotent and verifies the backfill', () => {
  assert.match(phase2Migration, /ADD COLUMN IF NOT EXISTS base_currency/);
  assert.match(phase2Migration, /ADD COLUMN IF NOT EXISTS normalized_email/);
  assert.match(phase2Migration, /CREATE TABLE IF NOT EXISTS accounts/);
  assert.match(phase2Migration, /CREATE TABLE IF NOT EXISTS contacts/);
  assert.match(phase2Migration, /CREATE TABLE IF NOT EXISTS pipelines/);
  assert.match(phase2Migration, /CREATE TABLE IF NOT EXISTS pipeline_stages/);
  assert.match(phase2Migration, /CREATE TABLE IF NOT EXISTS deals/);
  assert.match(phase2Migration, /CREATE TABLE IF NOT EXISTS deal_stage_history/);
  assert.match(phase2Migration, /ROW_NUMBER\(\) OVER/);
  assert.match(phase2Migration, /contact_normalized_email IS NULL OR l\.email_rank = 1/);
  assert.match(phase2Migration, /ON CONFLICT \(workspace_id, source_lead_id\)/);
  assert.match(phase2Migration, /RAISE EXCEPTION 'Phase 2 backfill incomplete/);
  assert.match(phase2Migration, /006_phase2_core_model/);
});

test('Phase 4 migration creates first-class productivity records and preserves legacy data', () => {
  assert.match(schema, /CREATE TABLE record_notes/);
  assert.match(schema, /CREATE TABLE saved_views/);
  assert.match(schema, /subject VARCHAR\(200\)/);
  assert.match(schema, /due_at TIMESTAMPTZ/);
  assert.match(schema, /num_nonnulls\(lead_id, account_id, contact_id, deal_id\) = 1/);
  assert.match(phase4Migration, /ALTER TABLE activities/);
  assert.match(phase4Migration, /legacy_source_id/);
  assert.match(phase4Migration, /INSERT INTO record_notes/);
  assert.match(phase4Migration, /INSERT INTO activities/);
  assert.match(phase4Migration, /value->>'createdAt'/);
  assert.match(phase4Migration, /AT TIME ZONE w\.timezone/);
  assert.match(phase4Migration, /WITH ORDINALITY/);
  assert.match(phase4Migration, /md5\(concat_ws/);
  assert.match(phase4Migration, /ON CONFLICT \(version\) DO NOTHING/);
  assert.match(phase4Migration, /007_phase4_productivity/);
});

test('fresh schema and Phase 5 migration include quote-to-cash financial integrity records', () => {
  for (const table of ['quotes', 'quote_items', 'tax_components', 'payments', 'credit_notes', 'invoice_deliveries', 'financial_audit_events']) {
    assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
    assert.match(phase5Migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /credited_amount NUMERIC\(14, 2\)/);
  assert.match(phase5Migration, /RAISE EXCEPTION 'Phase 5 invoice reconciliation failed'/);
  assert.match(phase5Migration, /ON CONFLICT \(version\) DO NOTHING/);
});

test('fresh schema and Phase 7 migration include communication and sync integrity records', () => {
  for (const table of ['communication_integrations', 'email_templates', 'outbound_messages', 'notifications']) {
    assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
    assert.match(phase7Migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /outbound_messages_target_check/);
  assert.match(phase7Migration, /meetings_workspace_external_event_unique_idx/);
  assert.match(phase7Migration, /009_phase7_communications/);
});

test('fresh schema and Phase 6 completion migration include goals and quota integrity', () => {
  assert.match(schema, /CREATE TABLE sales_goals/);
  assert.match(schema, /sales_goals_scope_owner_check/);
  assert.match(goalsMigration, /CREATE TABLE IF NOT EXISTS sales_goals/);
  assert.match(goalsMigration, /010_phase6_goals_quotas/);
});

test('fresh schema and Phase 7 calendar migration include secure OAuth credential records', () => {
  for (const table of ['integration_credentials', 'integration_oauth_states']) {
    assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
    assert.match(calendarMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(schema, /meetings_end_after_start_check/);
  assert.match(calendarMigration, /011_phase7_google_calendar/);
});
