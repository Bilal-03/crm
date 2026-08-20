import assert from 'node:assert/strict';
import test from 'node:test';

import { conditionsMatch } from '../../server/automations.js';
import { canAccessAllRecords } from '../../server/authorization.js';

test('automation conditions are constrained, deterministic and require every condition', () => {
  const payload = { status: 'won', amount: 12500, owner: { region: 'west' } };
  assert.equal(conditionsMatch({ all: [
    { field: 'status', operator: 'eq', value: 'won' },
    { field: 'amount', operator: 'gte', value: 10000 },
    { field: 'owner.region', operator: 'neq', value: 'east' },
  ] }, payload), true);
  assert.equal(conditionsMatch({ all: [{ field: 'amount', operator: 'lt', value: 100 }] }, payload), false);
  assert.equal(conditionsMatch({ all: [{ field: '__proto__.x', operator: 'exists', value: true }] }, payload), false);
});

test('owner and admin roles have all-record access while members are own-record scoped', () => {
  assert.equal(canAccessAllRecords({ role: 'owner' }), true);
  assert.equal(canAccessAllRecords({ role: 'admin' }), true);
  assert.equal(canAccessAllRecords({ role: 'member' }), false);
});
