import test from 'node:test';
import assert from 'node:assert/strict';

import { getPagination, getRequiredId, HttpError, paginated } from '../server/http.js';
import {
  calculateInvoiceTotals,
  validateActivity,
  validateInvoice,
  validateLead,
} from '../server/validation.js';

test('lead validation normalizes email and ignores identity fields', () => {
  const lead = validateLead({
    id: 'client-controlled',
    user_id: 'another-user',
    name: '  Ada Lovelace  ',
    email: ' ADA@EXAMPLE.COM ',
    stage: 'qualified',
  });

  assert.equal(lead.name, 'Ada Lovelace');
  assert.equal(lead.email, 'ada@example.com');
  assert.equal(lead.stage, 'qualified');
  assert.equal('user_id' in lead, false);
  assert.equal('id' in lead, false);
});

test('partial lead updates support clearing nullable fields', () => {
  assert.deepEqual(validateLead({ company: null }, { partial: true }), { company: null });
});

test('invalid activity references are rejected before reaching SQL', () => {
  assert.throws(
    () => validateActivity({ lead_id: 'not-a-uuid', type: 'note', message: 'hello' }),
    error => error instanceof HttpError && error.code === 'validation_error',
  );
});

test('invoice validation recomputes line amounts', () => {
  const invoice = validateInvoice({
    customer_id: '5d0eaa61-8738-4d23-b825-74e3ca100a85',
    invoice_date: '2026-07-29',
    due_date: '2026-08-29',
    items: [{ description: 'Support', quantity: 3, rate: 19.99, amount: 0.01 }],
  });

  assert.equal(invoice.items[0].amount, 59.97);
});

test('invoice totals use cents and clamp amount paid', () => {
  const totals = calculateInvoiceTotals(
    [{ description: 'Service', quantity: 3, rate: 19.99 }],
    10,
    5,
    100,
  );

  assert.deepEqual(totals, {
    subtotal: 59.97,
    tax_amount: 6,
    total_amount: 60.97,
    amount_paid: 60.97,
    balance_due: 0,
  });
});

test('pagination is bounded and exposes a next offset', () => {
  assert.deepEqual(getPagination({ limit: '2', offset: '4' }), { limit: 2, offset: 4 });
  assert.deepEqual(paginated([1, 2, 3], 2, 4), {
    data: [1, 2],
    pagination: { limit: 2, offset: 4, hasMore: true, nextOffset: 6 },
  });
  assert.throws(() => getPagination({ limit: '1000' }), HttpError);
});

test('resource IDs must be UUIDs', () => {
  assert.equal(
    getRequiredId({ id: '5d0eaa61-8738-4d23-b825-74e3ca100a85' }),
    '5d0eaa61-8738-4d23-b825-74e3ca100a85',
  );
  assert.throws(() => getRequiredId({ id: '../admin' }), HttpError);
});
