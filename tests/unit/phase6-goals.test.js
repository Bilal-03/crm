import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateGoalProgress, GOAL_METRICS } from '../../server/goals.js';
import { validateSalesGoal } from '../../server/validation.js';

const goal = { period_start: '2026-01-01', period_end: '2026-01-10', target_value: 1_000 };

test('goal progress calculates attainment, pacing and forecast-versus-target exactly', () => {
  assert.deepEqual(calculateGoalProgress(goal, { actual: 400, forecast: 1_100 }, new Date('2026-01-05T18:00:00Z')), {
    target: 1_000,
    actual: 400,
    forecast: 1_100,
    totalDays: 10,
    elapsedDays: 5,
    remainingDays: 5,
    elapsedPercent: 50,
    expectedToDate: 500,
    attainmentPercent: 40,
    forecastAttainmentPercent: 110.00000000000001,
    paceVariance: -100,
    remainingValue: 600,
    requiredPerRemainingDay: 120,
    paceStatus: 'behind',
    forecastStatus: 'projected_to_hit',
  });
});

test('goal validation enforces owner scope, periods, currencies and whole deal quotas', () => {
  const ownerGoal = validateSalesGoal({
    name: 'Q1 wins', scope: 'owner', owner_user_id: 'user_123', metric: 'deals_won',
    currency: 'usd', target_value: 12, period_start: '2026-01-01', period_end: '2026-03-31',
  });
  assert.equal(ownerGoal.currency, 'USD');
  assert.equal(ownerGoal.target_value, 12);
  assert.throws(() => validateSalesGoal({ ...ownerGoal, target_value: 12.5 }), /Request validation failed/);
  assert.throws(() => validateSalesGoal({ ...ownerGoal, owner_user_id: null }), /Request validation failed/);
  assert.throws(() => validateSalesGoal({ ...ownerGoal, period_end: '2025-12-31' }), /Request validation failed/);
});

test('every supported goal metric documents actual and forecast semantics', () => {
  assert.deepEqual(Object.keys(GOAL_METRICS), ['won_revenue', 'collected_revenue', 'deals_won']);
  for (const metric of Object.values(GOAL_METRICS)) {
    assert.ok(metric.definition.length > 20);
    assert.ok(metric.forecastDefinition.length > 20);
  }
});
