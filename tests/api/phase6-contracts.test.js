import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const reports = fs.readFileSync(new URL('../../routes/reports.js', import.meta.url), 'utf8');
const reportExport = fs.readFileSync(new URL('../../routes/reports/export.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../../routes/dashboard.js', import.meta.url), 'utf8');
const routeMap = fs.readFileSync(new URL('../../api/[...route].js', import.meta.url), 'utf8');

test('Phase 6 reports are tenant scoped and apply filters server-side', () => {
  for (const source of [reports, reportExport]) {
    assert.match(source, /getActiveWorkspace/);
    assert.match(source, /workspace_id = \$\{workspace\.id\}/);
    assert.match(source, /ownerUserId/);
    assert.match(source, /pipelineId/);
    assert.match(source, /source/);
    assert.match(source, /currency/);
  }
});

test('Phase 6 uses event dates rather than creation dates for outcomes and revenue', () => {
  assert.match(reports, /actual_close_date/);
  assert.match(reports, /deal_stage_history/);
  assert.match(reports, /effective_close_date/);
  assert.match(reports, /p\.payment_date/);
  assert.match(reports, /p\.status = 'settled'/);
  assert.doesNotMatch(reports, /SUM\(total_amount\).*status = 'paid'/s);
  assert.match(dashboard, /FROM payments/);
  assert.match(dashboard, /currency = \$\{workspace\.base_currency\}/);
});

test('Phase 6 exposes forecast, conversion, aging and management breakdowns', () => {
  for (const contract of ['weighted_pipeline', 'best_case', 'commit', 'average_cycle_days', 'conversionRate', 'averageAgeDays', 'sourcePerformance', 'ownerPerformance', 'currencyBreakdown', 'salesVelocity']) {
    assert.match(reports, new RegExp(contract));
  }
});

test('Phase 6 export is bounded, filtered, and routed through the authenticated API', () => {
  assert.match(reportExport, /EXPORT_LIMIT = 10_000/);
  assert.match(reportExport, /record_type/);
  assert.match(reportExport, /payment_date/);
  assert.match(routeMap, /reports\/export/);
});
