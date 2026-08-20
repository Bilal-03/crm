import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCurrencyMatch,
  calculateDocumentTotals,
  deriveInvoiceFinancials,
  isFinancialDocumentEditable,
} from '../../server/financial.js';
import { validateInvoice, validatePayment } from '../../server/validation.js';

test('Phase 5 totals support percentage discounts and mixed inclusive/exclusive taxes', () => {
  const totals = calculateDocumentTotals({
    items: [{ description: 'Implementation', quantity: 2, unit_price: 100 }],
    discountType: 'percent',
    discountValue: 10,
    taxComponents: [
      { name: 'Included GST', rate: 10, inclusive: true },
      { name: 'Service tax', rate: 5, inclusive: false },
    ],
  });
  assert.equal(totals.subtotal, 200);
  assert.equal(totals.discount_amount, 20);
  assert.equal(totals.tax_amount, 24.54);
  assert.equal(totals.total_amount, 188.18);
});

test('invoice balances are derived only from settled payments and issued credits', () => {
  assert.deepEqual(deriveInvoiceFinancials({
    totalAmount: 500,
    payments: [{ amount: 100, status: 'settled' }, { amount: 50, status: 'void' }],
    creditNotes: [{ amount: 75, status: 'issued' }],
    sentAt: '2026-08-01T00:00:00.000Z',
    dueDate: '2026-08-15',
    today: '2026-08-20',
  }), { amount_paid: 100, credited_amount: 75, balance_due: 325, status: 'partial' });
});

test('financial guards protect delivered documents and cross-currency payments', () => {
  assert.equal(isFinancialDocumentEditable({ status: 'draft', sent_at: null }), true);
  assert.equal(isFinancialDocumentEditable({ status: 'draft', sent_at: null }, { deliveryCount: 1 }), false);
  assert.throws(() => assertCurrencyMatch('USD', 'EUR'), error => error.code === 'currency_mismatch');
});

test('invoice round trips accept normalized unit_price items and payments require amounts', () => {
  const invoice = validateInvoice({ items: [{ description: 'Seat', quantity: 2, unit_price: 25 }] }, { partial: true });
  assert.deepEqual(invoice.items[0], { description: 'Seat', quantity: 2, rate: 25, amount: 50 });
  assert.throws(() => validatePayment({
    invoice_id: '123e4567-e89b-42d3-a456-426614174000',
    payment_date: '2026-08-20',
  }), error => error.code === 'validation_error' && error.details?.[0]?.field === 'amount');
});
