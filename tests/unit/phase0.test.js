import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInvoice, isInvoiceDeletable } from '../../api/invoices.js';
import { calculateInvoiceTotals, validateBulkLeadOperation, validateInvoice } from '../../server/validation.js';
import { isProductionDeployment } from '../../server/http.js';
import { calculateReportMetrics, getReportWindow } from '../../server/reporting.js';
import { DEFAULT_PIPELINE_STAGES } from '../../server/pipelines.js';
import { legacyLeadAmount } from '../../server/core-model.js';
import { normalizeDomain, normalizeEmail, normalizeName, normalizePhone } from '../../server/normalization.js';
import { validateDeal, validatePipelineStage } from '../../server/validation.js';
import { createPhase0Fixtures } from '../fixtures/phase0-fixtures.js';

test('invoice totals use cents and cap paid amount at the total', () => {
  const totals = calculateInvoiceTotals([
    { quantity: 2, rate: 19.995 },
    { quantity: 1, rate: 10 },
  ], 10, 5, 1000);

  assert.deepEqual(totals, {
    subtotal: 49.99,
    tax_amount: 5,
    total_amount: 49.99,
    amount_paid: 49.99,
    balance_due: 0,
  });
});

test('invoice edits reject client-controlled payment resets', () => {
  assert.throws(
    () => validateInvoice({ amount_paid: 0 }, { partial: true, allowAmountPaid: false }),
    error => error.code === 'validation_error' && error.details[0].field === 'amount_paid',
  );
});

test('rebuilding an invoice for an edit preserves an existing partial payment', () => {
  const invoice = buildInvoice({
    customer_id: '00000000-0000-4000-8000-000000000001',
    invoice_date: '2026-08-01',
    due_date: '2026-08-31',
    status: 'partial',
    items: [{ description: 'Implementation', quantity: 1, rate: 100, amount: 100 }],
    tax_rate: 0,
    discount_amount: 0,
    amount_paid: 25,
    notes: 'Updated note',
    terms: 'Due in 30 days',
  });

  assert.equal(invoice.amount_paid, 25);
  assert.equal(invoice.balance_due, 75);
  assert.equal(invoice.total_amount, 100);
});

test('only unpaid draft invoices are deletable', () => {
  assert.equal(isInvoiceDeletable({ status: 'draft', amount_paid: 0 }), true);
  assert.equal(isInvoiceDeletable({ status: 'sent', amount_paid: 0 }), false);
  assert.equal(isInvoiceDeletable({ status: 'draft', amount_paid: 1 }), false);
});

test('bulk lead operations require unique UUIDs and a stage for updates', () => {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ];
  assert.deepEqual(validateBulkLeadOperation({ action: 'update', ids, updates: { stage: 'proposal' } }), {
    action: 'update',
    ids,
    stage: 'proposal',
  });
  assert.throws(() => validateBulkLeadOperation({ action: 'update', ids }), /Request validation failed/);
  assert.throws(() => validateBulkLeadOperation({ action: 'delete', ids: [ids[0], ids[0]] }), /Request validation failed/);
});

test('report metrics use close and payment dates instead of creation dates', () => {
  const fixtures = createPhase0Fixtures();
  const window = getReportWindow(30, fixtures.now);
  const metrics = calculateReportMetrics(fixtures, window);

  assert.equal(fixtures.leads.length, 501);
  assert.equal(metrics.newLeads, 499);
  assert.equal(metrics.dealsWon, 1);
  assert.equal(metrics.dealsLost, 1);
  assert.equal(metrics.closeRate, 50);
  assert.equal(metrics.revenueCollected, 1500);
  assert.equal(metrics.paidInvoices, 1);
  assert.equal(metrics.meetingsScheduled, 1);
});

test('development deployment mode explicitly permits test-key deployments', () => {
  assert.equal(isProductionDeployment({
    CLERK_DEPLOYMENT_MODE: 'development',
    VERCEL_ENV: 'production',
    NODE_ENV: 'production',
  }), false);
  assert.equal(isProductionDeployment({
    CLERK_DEPLOYMENT_MODE: 'production',
    VERCEL_ENV: 'preview',
    NODE_ENV: 'production',
  }), true);
  assert.equal(isProductionDeployment({ VERCEL_ENV: 'production' }), true);
});

test('Phase 2 normalization and legacy quote conversion are deterministic', () => {
  assert.equal(normalizeEmail('  Sales@Example.COM '), 'sales@example.com');
  assert.equal(normalizePhone('+91 (987) 654-3210'), '+919876543210');
  assert.equal(normalizeDomain('https://www.Example.com/path'), 'example.com');
  assert.equal(normalizeName('  Acme   Corporation '), 'acme corporation');
  assert.equal(legacyLeadAmount([
    { quantity: 2, price: 19.995 },
    { quantity: 1, price: 10 },
  ]), 49.99);
});

test('Phase 2 defaults preserve configurable stage metadata and validate deals', () => {
  assert.equal(DEFAULT_PIPELINE_STAGES.length, 6);
  assert.equal(DEFAULT_PIPELINE_STAGES.find(stage => stage.key === 'closed-won').probability, 100);
  assert.throws(
    () => validatePipelineStage({ key: 'invalid', name: 'Invalid', position: 1, is_closed_won: true, is_closed_lost: true }),
    error => error.code === 'validation_error',
  );
  assert.deepEqual(validateDeal({ name: 'Expansion', amount: 1250, currency: 'inr' }).currency, 'INR');
});
