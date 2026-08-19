import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../migrations/005_phase0_data_correctness.sql', import.meta.url), 'utf8');

test('fresh schema includes the structures previously missing from Team Settings and Phase 0 reporting', () => {
  assert.match(schema, /CREATE TABLE workspace_invitations/);
  assert.match(schema, /email VARCHAR\(320\)/);
  assert.match(schema, /won_at TIMESTAMPTZ/);
  assert.match(schema, /lost_at TIMESTAMPTZ/);
  assert.match(schema, /CREATE TABLE schema_migrations/);
});

test('Phase 0 migration is idempotent for new structures and records its version', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS won_at/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS workspace_invitations/);
  assert.match(migration, /ON CONFLICT \(version\) DO NOTHING/);
  assert.match(migration, /005_phase0_data_correctness/);
});
