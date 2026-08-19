import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../migrations/005_phase0_data_correctness.sql', import.meta.url), 'utf8');
const phase2Migration = fs.readFileSync(new URL('../../migrations/006_phase2_core_model.sql', import.meta.url), 'utf8');

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
