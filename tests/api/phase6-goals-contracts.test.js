import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../migrations/010_phase6_goals_quotas.sql', import.meta.url), 'utf8');
const goals = fs.readFileSync(new URL('../../routes/goals.js', import.meta.url), 'utf8');
const routeMap = fs.readFileSync(new URL('../../api/[...route].js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../../src/features/reporting/GoalsPanel.jsx', import.meta.url), 'utf8');

test('Phase 6 goal migration enforces one active quota per scope, metric, currency and period', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sales_goals/);
  assert.match(migration, /sales_goals_scope_owner_check/);
  assert.match(migration, /sales_goals_workspace_owner_fk/);
  assert.match(migration, /COALESCE\(owner_user_id, '__team__'\)/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(migration, /010_phase6_goals_quotas/);
});

test('goal calculations are tenant safe, event based, owner aware and currency isolated', () => {
  assert.match(goals, /getActiveWorkspace/);
  assert.match(goals, /g\.workspace_id = \$\{workspace\.id\}/);
  assert.match(goals, /d\.currency = g\.currency/);
  assert.match(goals, /effective_close_date/);
  assert.match(goals, /payment\.payment_date BETWEEN g\.period_start AND g\.period_end/);
  assert.match(goals, /d\.owner_user_id = g\.owner_user_id/);
  assert.match(goals, /calculateGoalProgress/);
});

test('only managers mutate quotas and the reporting UI shows pacing and forecast-versus-target', () => {
  assert.match(goals, /\['owner', 'admin'\]\.includes\(role\)/);
  assert.match(goals, /Goal owner is not a member of this workspace/);
  assert.match(routeMap, /goals/);
  for (const term of ['attainmentPercent', 'elapsedPercent', 'requiredPerRemainingDay', 'forecastStatus']) {
    assert.match(ui, new RegExp(term));
  }
});
