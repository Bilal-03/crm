import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import router from '../../api/router.js';

const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const spaFallback = config.rewrites.find(rule => rule.destination === '/index.html');
const nestedRoutes = [
  'leads/bulk', 'leads/convert', 'deals/summary', 'invoices/actions',
  'quotes/actions', 'payments/actions', 'reports/export',
];

test('the SPA fallback does not intercept API requests', () => {
  assert.ok(spaFallback, 'vercel.json must define an index.html SPA fallback');

  const matcher = new RegExp(`^${spaFallback.source}$`);
  assert.doesNotMatch('/api', matcher);
  assert.doesNotMatch('/api/leads', matcher);
  assert.doesNotMatch('/api/leads/bulk', matcher);
  assert.match('/dashboard', matcher);
  assert.match('/sales/leads', matcher);
});

test('nested business API paths are rewritten to the single Vercel router function', () => {
  for (const route of nestedRoutes) {
    const rewrite = config.rewrites.find(rule => rule.source === `/api/${route}`);
    assert.ok(rewrite, `${route} must have a deployment rewrite`);
    assert.match(rewrite.destination, /^\/api\/router\?route=/);
  }
});

test('the single Vercel router dispatches a nested business route', async () => {
  const req = {
    method: 'POST',
    url: '/api/router?route=leads%2Fconvert',
    query: { route: 'leads/convert' },
    headers: { 'content-type': 'application/json' },
  };
  const headers = new Map();
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value) { this.body = value; },
  };

  await router(req, res);

  assert.equal(res.statusCode, 401, 'the nested route should reach authentication instead of returning 404');
  assert.equal(JSON.parse(res.body).error.code, 'unauthorized');
  assert.equal(headers.get('content-type'), 'application/json; charset=utf-8');
});
