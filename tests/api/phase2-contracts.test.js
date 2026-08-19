import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiFiles = {
  accounts: fs.readFileSync(new URL('../../api/accounts.js', import.meta.url), 'utf8'),
  contacts: fs.readFileSync(new URL('../../api/contacts.js', import.meta.url), 'utf8'),
  pipelines: fs.readFileSync(new URL('../../api/pipelines.js', import.meta.url), 'utf8'),
  deals: fs.readFileSync(new URL('../../api/deals.js', import.meta.url), 'utf8'),
  summary: fs.readFileSync(new URL('../../api/deals/summary.js', import.meta.url), 'utf8'),
  conversion: fs.readFileSync(new URL('../../server/core-model.js', import.meta.url), 'utf8'),
};

test('Phase 2 resource APIs establish a workspace boundary before querying new objects', () => {
  for (const [resource, source] of Object.entries(apiFiles)) {
    if (resource === 'conversion') continue;
    assert.match(source, /getActiveWorkspace/);
    assert.match(source, /workspace\.id/);
    assert.match(source, /workspace_id/);
  }
  assert.match(apiFiles.conversion, /workspace_id = \$\{workspace\.id\}/);
});
test('Phase 2 APIs preserve idempotency, real amounts and stage-history metadata', () => {
  assert.match(apiFiles.conversion, /ON CONFLICT \(workspace_id, source_lead_id\)/);
  assert.match(apiFiles.deals, /changed_by/);
  assert.match(apiFiles.deals, /changed_at/);
  assert.match(apiFiles.summary, /SUM\(d\.amount\)/);
  assert.match(apiFiles.summary, /d\.amount \* d\.probability \/ 100/);
});
