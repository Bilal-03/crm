import assert from 'node:assert/strict';
import test from 'node:test';

import { pageFromPathname, pathForPage } from '../../src/app/routes.js';

test('main CRM pages have stable URL mappings', () => {
  assert.equal(pathForPage('dashboard'), '/dashboard');
  assert.equal(pathForPage('reports'), '/reports');
  assert.equal(pageFromPathname('/leads'), 'leads');
  assert.equal(pageFromPathname('/team'), 'team');
});

test('unknown CRM pages fall back to the dashboard route', () => {
  assert.equal(pathForPage('unknown'), '/dashboard');
  assert.equal(pageFromPathname('/not-a-page'), 'dashboard');
});
