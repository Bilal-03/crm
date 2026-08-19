import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const files = Object.fromEntries([
  'activities',
  'notes',
  'saved-views',
  'search',
  'assign',
  'imports',
  'duplicates',
].map(name => [name, fs.readFileSync(new URL(`../../routes/${name}.js`, import.meta.url), 'utf8')]));
const routeMap = fs.readFileSync(new URL('../../api/[...route].js', import.meta.url), 'utf8');

test('Phase 4 routes establish workspace scope before resource queries', () => {
  for (const source of Object.values(files)) {
    assert.match(source, /getActiveWorkspace/);
    assert.match(source, /workspace\.id/);
    assert.match(source, /workspace_id/);
  }
});

test('Phase 4 activity and search routes expose bounded, authorized filters', () => {
  assert.match(files.activities, /getQueryUuid/);
  assert.match(files.activities, /a\.workspace_id = \$\{workspace\.id\}/);
  assert.match(files.activities, /CURRENT_TIMESTAMP AT TIME ZONE/);
  assert.match(files.search, /workspace_id = \$\{workspace\.id\}/);
  assert.match(files.search, /Promise\.all/);
});

test('Phase 4 writes preserve transaction and merge safety requirements', () => {
  assert.match(files.imports, /sql\.transaction\(queries\)/);
  assert.match(files.imports, /error_file/);
  assert.match(files.duplicates, /mergeQueries\(sql/);
  assert.match(files.duplicates, /sql\.transaction\(queries\)/);
  assert.match(files.duplicates, /record_notes/);
  assert.match(files.duplicates, /invoices/);
  assert.match(files.assign, /id = ANY\(\$\{input\.ids\}::uuid\[\]\)/);
  assert.match(files.assign, /bulk_conflict/);
});

test('single Vercel handler maps every Phase 4 endpoint', () => {
  for (const route of ['activities', 'notes', 'saved-views', 'search', 'assign', 'imports', 'duplicates']) {
    assert.match(routeMap, new RegExp(`routes/${route}`));
  }
});
