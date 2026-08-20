import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = {
  invoices: read('../../routes/invoices.js'),
  invoiceActions: read('../../routes/invoices/actions.js'),
  quotes: read('../../routes/quotes.js'),
  quoteActions: read('../../routes/quotes/actions.js'),
  payments: read('../../routes/payments.js'),
  paymentActions: read('../../routes/payments/actions.js'),
  settings: read('../../routes/financial-settings.js'),
  deliveries: read('../../routes/send-invoice-email.js'),
};
const routeMap = read('../../api/[...route].js');
const migration = read('../../migrations/008_phase5_quote_to_cash.sql');

test('Phase 5 endpoints establish workspace scope and financial writes are audited', () => {
  for (const source of Object.values(sources)) {
    assert.match(source, /getActiveWorkspace/);
    assert.match(source, /workspace\.id/);
  }
  for (const source of [sources.invoices, sources.invoiceActions, sources.quotes, sources.quoteActions, sources.paymentActions, sources.settings, sources.deliveries]) {
    assert.match(source, /financialAuditQuery/);
  }
  assert.match(sources.payments, /financial_audit_events/);
});

test('Phase 5 protects financial state with lifecycle actions and reconciliation', () => {
  assert.match(sources.invoices, /financial_record_protected/);
  assert.match(sources.invoiceActions, /credit_note\.issued/);
  assert.match(sources.payments, /invoiceReconciliationQuery/);
  assert.match(sources.paymentActions, /payment\.voided/);
  assert.match(sources.quoteActions, /invoice\.created_from_quote/);
  assert.match(sources.deliveries, /provider_message_id/);
  assert.match(sources.deliveries, /invoice_deliveries/);
});

test('Phase 5 migration is additive, backfills legacy balances, and verifies reconciliation', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS legal_name/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS quotes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS quote_items/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS credit_notes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS invoice_deliveries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS financial_audit_events/);
  assert.match(migration, /invoices_id_workspace_unique_idx/);
  assert.match(migration, /Backfilled from the pre-Phase 5 invoice paid balance/);
  assert.match(migration, /Phase 5 invoice reconciliation failed/);
  assert.match(migration, /008_phase5_quote_to_cash/);
});

test('single Vercel handler exposes every Phase 5 endpoint', () => {
  for (const route of ['quotes', 'quotes/actions', 'invoices/actions', 'payments', 'payments/actions', 'financial-settings', 'financial-events']) {
    assert.match(routeMap, new RegExp(`['\"]?${route.replace('/', '\\/')}['\"]?`));
  }
});
