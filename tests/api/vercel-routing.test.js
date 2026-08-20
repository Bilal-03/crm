import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const spaFallback = config.rewrites.find(rule => rule.destination === '/index.html');

test('the SPA fallback does not intercept API requests', () => {
  assert.ok(spaFallback, 'vercel.json must define an index.html SPA fallback');

  const matcher = new RegExp(`^${spaFallback.source}$`);
  assert.doesNotMatch('/api', matcher);
  assert.doesNotMatch('/api/leads', matcher);
  assert.doesNotMatch('/api/leads/bulk', matcher);
  assert.match('/dashboard', matcher);
  assert.match('/sales/leads', matcher);
});
