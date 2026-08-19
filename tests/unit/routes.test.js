import assert from 'node:assert/strict';
import test from 'node:test';

import { pageFromPathname, pathForPage } from '../../src/app/routes.js';

test('main CRM pages have stable URL mappings', () => {
  assert.equal(pathForPage('dashboard'), '/dashboard');
  assert.equal(pathForPage('leads'), '/sales/leads');
  assert.equal(pathForPage('contacts'), '/sales/contacts');
  assert.equal(pathForPage('accounts'), '/sales/accounts');
  assert.equal(pathForPage('deals'), '/sales/deals');
  assert.equal(pathForPage('pipeline'), '/sales/pipeline');
  assert.equal(pathForPage('activities'), '/activities');
  assert.equal(pathForPage('reports'), '/reports');
  assert.equal(pageFromPathname('/leads'), 'leads');
  assert.equal(pageFromPathname('/sales/accounts'), 'accounts');
  assert.equal(pageFromPathname('/sales/deals'), 'deals');
  assert.equal(pageFromPathname('/sales/pipeline'), 'pipeline');
  assert.equal(pageFromPathname('/activities'), 'activities');
  assert.equal(pageFromPathname('/my-day'), 'activities');
  assert.equal(pageFromPathname('/team'), 'team');
});

test('unknown CRM pages fall back to the dashboard route', () => {
  assert.equal(pathForPage('unknown'), '/dashboard');
  assert.equal(pageFromPathname('/not-a-page'), 'dashboard');
});
