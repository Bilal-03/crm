import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiFiles = {
  accounts: fs.readFileSync(new URL('../../routes/accounts.js', import.meta.url), 'utf8'),
  contacts: fs.readFileSync(new URL('../../routes/contacts.js', import.meta.url), 'utf8'),
  pipelines: fs.readFileSync(new URL('../../routes/pipelines.js', import.meta.url), 'utf8'),
  deals: fs.readFileSync(new URL('../../routes/deals.js', import.meta.url), 'utf8'),
  pipelinesSource: fs.readFileSync(new URL('../../routes/pipelines.js', import.meta.url), 'utf8'),
  summary: fs.readFileSync(new URL('../../routes/deals/summary.js', import.meta.url), 'utf8'),
  conversion: fs.readFileSync(new URL('../../server/core-model.js', import.meta.url), 'utf8'),
};
const workspaceSource = fs.readFileSync(new URL('../../server/workspaces.js', import.meta.url), 'utf8');

test('Phase 2 resource APIs establish a workspace boundary before querying new objects', () => {
  for (const [resource, source] of Object.entries(apiFiles)) {
    if (resource === 'conversion') continue;
    assert.match(source, /getActiveWorkspace/);
    assert.match(source, /workspace\.id/);
    assert.match(source, /workspace_id/);
  }
  assert.match(apiFiles.conversion, /workspace_id = \$\{workspace\.id\}/);
});

test('workspace resolution keeps routine API requests on the read-only fast path', () => {
  const activeWorkspaceBody = workspaceSource.slice(
    workspaceSource.indexOf('export async function getActiveWorkspace'),
    workspaceSource.indexOf('export async function assertWorkspaceMember'),
  );
  assert.doesNotMatch(activeWorkspaceBody, /ensureDefaultPipeline/);
  assert.match(workspaceSource, /if \(!pipeline\[0\]\) await ensureDefaultPipeline/);
});
test('Phase 2 APIs preserve idempotency, real amounts and stage-history metadata', () => {
  assert.match(apiFiles.conversion, /ON CONFLICT \(workspace_id, source_lead_id\)/);
  assert.match(apiFiles.deals, /changed_by/);
  assert.match(apiFiles.deals, /changed_at/);
  assert.match(apiFiles.summary, /SUM\(d\.amount\)/);
  assert.match(apiFiles.summary, /d\.amount \* d\.probability \/ 100/);
  assert.match(apiFiles.deals, /getDealById\(sql, workspace\.id, requestedId\)/);
  assert.match(apiFiles.conversion, /stage_history/);
  assert.match(apiFiles.pipelinesSource, /return json\(res, 200, paginated\(pipelines/);
});
