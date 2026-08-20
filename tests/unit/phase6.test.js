import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateManagementMetrics, getExplicitReportWindow, REPORT_DEFINITIONS } from '../../server/reporting.js';
import { createPhase6Fixtures } from '../fixtures/phase6-fixtures.js';

test('Phase 6 management metrics produce exact event-based fixture results', () => {
  const fixture = createPhase6Fixtures();
  const metrics = calculateManagementMetrics(fixture, fixture.window, fixture.currency);
  assert.deepEqual(metrics, {
    openPipeline: 1500,
    weightedPipeline: 720,
    bestCase: 500,
    commit: 200,
    wonAmount: 600,
    lostAmount: 200,
    dealsWon: 1,
    dealsLost: 1,
    winRate: 50,
    averageDealSize: 600,
    averageCycleDays: 10,
    salesVelocity: 90,
    revenueCollected: 250,
    activitiesCreated: 2,
    activitiesCompleted: 2,
  });
});

test('Phase 6 never combines unlike currencies', () => {
  const fixture = createPhase6Fixtures();
  const usd = calculateManagementMetrics(fixture, fixture.window, 'USD');
  const eur = calculateManagementMetrics(fixture, fixture.window, 'EUR');
  assert.equal(usd.openPipeline, 1500);
  assert.equal(eur.openPipeline, 999);
  assert.equal(usd.revenueCollected, 250);
  assert.equal(eur.revenueCollected, 500);
});

test('explicit reporting windows use inclusive display dates and an exclusive SQL boundary', () => {
  assert.deepEqual(getExplicitReportWindow('2026-08-01', '2026-08-30'), {
    rangeDays: 30,
    startDate: '2026-08-01',
    endDateExclusive: '2026-08-31',
  });
  assert.throws(() => getExplicitReportWindow('2026-08-31', '2026-08-01'), /endDate/);
});

test('every Phase 6 KPI exposes a definition', () => {
  for (const metric of ['openPipeline', 'weightedPipeline', 'bestCase', 'commit', 'wonAmount', 'lostAmount', 'winRate', 'averageDealSize', 'averageCycleDays', 'salesVelocity', 'revenueCollected', 'stageConversion', 'stageAge']) {
    assert.equal(typeof REPORT_DEFINITIONS[metric], 'string');
    assert.ok(REPORT_DEFINITIONS[metric].length > 20);
  }
});
