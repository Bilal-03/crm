import { randomUUID } from 'node:crypto';

import { getDb } from '../server/db.js';
import { calculateDocumentTotals, isFinancialDocumentEditable } from '../server/financial.js';
import { financialAuditQuery, getInvoiceDetail, reserveDocumentNumber } from '../server/financial-records.js';
import {
  getPagination,
  getQueryDate,
  getQueryEnum,
  getQueryString,
  getQueryUuid,
  getRequiredId,
  getSort,
  HttpError,
  json,
  noContent,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { calculateInvoiceTotals, INVOICE_STATUSES, validateInvoice } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { taxQueries } from './quotes.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      if (req.query?.id) {
        return json(res, 200, { data: await getInvoiceDetail(sql, workspace.id, getRequiredId(req.query)) });
      }
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const status = getQueryEnum(req.query, 'status', INVOICE_STATUSES);
      const owner = getQueryString(req.query, 'owner', 256);
      const ownerUserId = owner === 'me' ? userId : owner;
      const dealId = getQueryUuid(req.query, 'deal_id');
      const quoteId = getQueryUuid(req.query, 'quote_id');
      const currency = getQueryString(req.query, 'currency', 3)?.toUpperCase() || null;
      const from = getQueryDate(req.query, 'from');
      const to = getQueryDate(req.query, 'to');
      const orderBy = getSort(req.query, {
        created: 'created_at', invoiceDate: 'invoice_date', dueDate: 'due_date', total: 'total_amount',
      }, 'created', 'desc', 'id');
      const rows = await sql`
        SELECT * FROM (
          SELECT i.id, i.customer_id, i.deal_id, i.quote_id, i.invoice_number,
                 i.invoice_date, i.due_date,
                 CASE
                   WHEN i.status IN ('cancelled', 'void', 'paid', 'partial') THEN i.status
                   WHEN i.sent_at IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'overdue'
                   WHEN i.sent_at IS NOT NULL THEN 'sent'
                   ELSE 'draft'
                 END AS status,
                 i.currency, i.items, i.notes, i.terms, i.subtotal, i.tax_mode,
                 i.tax_rate, i.tax_amount, i.discount_type, i.discount_value,
                 i.discount_amount, i.total_amount, i.amount_paid, i.credited_amount,
                 i.balance_due, i.sent_at, i.voided_at, i.cancelled_at, i.created_at,
                 i.updated_at, i.paid_at, c.name AS customer_name,
                 c.company AS customer_company, d.name AS deal_name,
                 q.quote_number, COUNT(*) OVER() AS __total_count
          FROM invoices i
          JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
          LEFT JOIN deals d ON d.id = i.deal_id AND d.workspace_id = i.workspace_id
          LEFT JOIN quotes q ON q.id = i.quote_id AND q.workspace_id = i.workspace_id
          WHERE i.workspace_id = ${workspace.id}
            AND (${search}::text IS NULL OR i.invoice_number ILIKE ${search ? `%${search}%` : null} OR c.name ILIKE ${search ? `%${search}%` : null} OR c.company ILIKE ${search ? `%${search}%` : null})
            AND (${ownerUserId}::text IS NULL OR i.user_id = ${ownerUserId})
            AND (${dealId}::uuid IS NULL OR i.deal_id = ${dealId})
            AND (${quoteId}::uuid IS NULL OR i.quote_id = ${quoteId})
            AND (${currency}::text IS NULL OR i.currency = ${currency})
            AND (${from}::date IS NULL OR i.invoice_date >= ${from}::date)
            AND (${to}::date IS NULL OR i.invoice_date <= ${to}::date)
        ) listed
        WHERE (${status}::text IS NULL OR listed.status = ${status})
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateInvoice(req.body, { allowAmountPaid: false });
      await assertInvoiceReferences(sql, workspace.id, input);
      if (input.due_date < input.invoice_date) throw invalidDueDate();
      const invoiceId = randomUUID();
      const invoiceNumber = await reserveDocumentNumber(sql, workspace.id, 'invoice');
      const taxes = normalizedTaxInput(input);
      const totals = calculateDocumentTotals({
        items: input.items,
        discountType: input.discount_type,
        discountValue: input.discount_value ?? input.discount_amount,
        taxComponents: taxes,
      });
      const currency = input.currency || workspace.base_currency;
      await sql.transaction([
        sql`
          INSERT INTO invoices (
            id, workspace_id, user_id, customer_id, deal_id, quote_id, invoice_number,
            invoice_date, due_date, status, currency, items, notes, terms, subtotal,
            tax_mode, tax_rate, tax_amount, discount_type, discount_value,
            discount_amount, total_amount, amount_paid, credited_amount, balance_due,
            created_by, updated_by
          ) VALUES (
            ${invoiceId}, ${workspace.id}, ${userId}, ${input.customer_id}, ${input.deal_id ?? null},
            ${input.quote_id ?? null}, ${invoiceNumber}, ${input.invoice_date}, ${input.due_date},
            'draft', ${currency}, ${JSON.stringify(totals.items)}, ${input.notes ?? null},
            ${input.terms ?? workspace.default_invoice_terms ?? null}, ${totals.subtotal},
            ${taxMode(totals.tax_components)}, ${legacyTaxRate(totals.tax_components)},
            ${totals.tax_amount}, ${totals.discount_type}, ${totals.discount_value},
            ${totals.discount_amount}, ${totals.total_amount}, 0, 0, ${totals.total_amount},
            ${userId}, ${userId}
          ) RETURNING id
        `,
        ...taxQueries(sql, workspace.id, 'invoice_id', invoiceId, totals.tax_components),
        financialAuditQuery(sql, {
          workspaceId: workspace.id, actorUserId: userId, action: 'invoice.created',
          entityType: 'invoice', entityId: invoiceId,
          afterState: { invoice_number: invoiceNumber, status: 'draft', currency, total_amount: totals.total_amount },
          requestId,
        }),
      ]);
      return json(res, 201, { data: await getInvoiceDetail(sql, workspace.id, invoiceId) });
    }

    const id = getRequiredId(req.query);
    const existing = await getInvoiceDetail(sql, workspace.id, id);

    if (req.method === 'PUT') {
      const updates = validateInvoice(req.body, { partial: true, allowAmountPaid: false });
      if (updates.status !== undefined && updates.status !== existing.status) {
        throw new HttpError(400, 'invalid_lifecycle_change', 'Use an invoice action to change financial document status.');
      }
      if (!isFinancialDocumentEditable(existing, {
        paymentCount: existing.payments.length,
        deliveryCount: existing.deliveries.length,
      })) {
        throw new HttpError(409, 'financial_record_protected', 'Only unsent draft invoices without payments or delivery attempts can be edited.');
      }
      const merged = {
        ...existing,
        ...updates,
        items: updates.items || existing.items,
        tax_components: updates.tax_components || existing.tax_components,
      };
      if (merged.due_date < merged.invoice_date) throw invalidDueDate();
      await assertInvoiceReferences(sql, workspace.id, merged);
      const totals = calculateDocumentTotals({
        items: merged.items,
        discountType: merged.discount_type,
        discountValue: updates.discount_value ?? merged.discount_value ?? merged.discount_amount,
        taxComponents: updates.tax_components ? normalizedTaxInput(updates) : merged.tax_components,
      });
      const queries = [
        sql`
          UPDATE invoices SET
            customer_id = ${merged.customer_id}, deal_id = ${merged.deal_id ?? null},
            quote_id = ${merged.quote_id ?? null}, invoice_date = ${merged.invoice_date},
            due_date = ${merged.due_date}, currency = ${merged.currency || workspace.base_currency},
            items = ${JSON.stringify(totals.items)}, notes = ${merged.notes ?? null},
            terms = ${merged.terms ?? null}, subtotal = ${totals.subtotal},
            tax_mode = ${taxMode(totals.tax_components)},
            tax_rate = ${legacyTaxRate(totals.tax_components)}, tax_amount = ${totals.tax_amount},
            discount_type = ${totals.discount_type}, discount_value = ${totals.discount_value},
            discount_amount = ${totals.discount_amount}, total_amount = ${totals.total_amount},
            balance_due = ${totals.total_amount}, updated_by = ${userId}, updated_at = NOW()
          WHERE id = ${id} AND workspace_id = ${workspace.id} AND status = 'draft' AND sent_at IS NULL
          RETURNING id
        `,
        sql`DELETE FROM tax_components WHERE invoice_id = ${id} AND workspace_id = ${workspace.id}`,
        ...taxQueries(sql, workspace.id, 'invoice_id', id, totals.tax_components),
        financialAuditQuery(sql, {
          workspaceId: workspace.id, actorUserId: userId, action: 'invoice.updated',
          entityType: 'invoice', entityId: id, beforeState: invoiceAuditState(existing),
          afterState: { ...invoiceAuditState(existing), currency: merged.currency, total_amount: totals.total_amount },
          requestId,
        }),
      ];
      await sql.transaction(queries);
      return json(res, 200, { data: await getInvoiceDetail(sql, workspace.id, id) });
    }

    if (!isInvoiceDeletable(existing, existing.payments.length, existing.deliveries.length)) {
      throw new HttpError(409, 'financial_record_protected', 'Only unpaid, undelivered draft invoices can be deleted. Void or cancel the invoice instead.');
    }
    await sql.transaction([
      financialAuditQuery(sql, {
        workspaceId: workspace.id, actorUserId: userId, action: 'invoice.deleted',
        entityType: 'invoice', entityId: id, beforeState: invoiceAuditState(existing), requestId,
      }),
      sql`DELETE FROM invoices WHERE id = ${id} AND workspace_id = ${workspace.id}`,
    ]);
    return noContent(res);
  },
});

// Retained for compatibility with existing callers and unit tests.
export function buildInvoice(input) {
  if (input.due_date < input.invoice_date) throw invalidDueDate();
  const taxRate = Number(input.tax_rate ?? 0);
  const discountAmount = Number(input.discount_amount ?? 0);
  const preliminary = calculateInvoiceTotals(input.items, taxRate, discountAmount, Number(input.amount_paid ?? 0));
  const amountPaid = input.status === 'paid' ? preliminary.total_amount : preliminary.amount_paid;
  const totals = calculateInvoiceTotals(input.items, taxRate, discountAmount, amountPaid);
  return {
    ...input, tax_rate: taxRate, discount_amount: discountAmount, ...totals,
    paid_at: input.status === 'paid' ? input.paid_at ?? new Date().toISOString() : null,
  };
}

export function isInvoiceDeletable(invoice, paymentCount = 0, deliveryCount = 0) {
  return invoice?.status === 'draft'
    && Number(invoice.amount_paid || 0) === 0
    && Number(invoice.credited_amount || 0) === 0
    && Number(paymentCount) === 0
    && Number(deliveryCount) === 0
    && !invoice.sent_at;
}

async function assertInvoiceReferences(sql, workspaceId, input) {
  const customers = await sql`SELECT id FROM customers WHERE id = ${input.customer_id} AND workspace_id = ${workspaceId}`;
  if (!customers[0]) throw new HttpError(400, 'invalid_reference', 'Customer does not exist in this workspace.');
  if (input.deal_id) {
    const deals = await sql`SELECT id FROM deals WHERE id = ${input.deal_id} AND workspace_id = ${workspaceId}`;
    if (!deals[0]) throw new HttpError(400, 'invalid_reference', 'Deal does not exist in this workspace.');
  }
  if (input.quote_id) {
    const quotes = await sql`SELECT id, deal_id, status FROM quotes WHERE id = ${input.quote_id} AND workspace_id = ${workspaceId}`;
    if (!quotes[0]) throw new HttpError(400, 'invalid_reference', 'Quote does not exist in this workspace.');
    if (quotes[0].status !== 'accepted') throw new HttpError(409, 'quote_not_accepted', 'Only accepted quotes can be linked to invoices.');
    if (input.deal_id && quotes[0].deal_id !== input.deal_id) throw new HttpError(409, 'provenance_mismatch', 'Invoice deal must match the linked quote.');
  }
}

function normalizedTaxInput(input) {
  if (input.tax_components?.length) return input.tax_components;
  if (Number(input.tax_rate || 0) > 0) {
    return [{ name: 'Tax', rate: Number(input.tax_rate), inclusive: input.tax_mode === 'inclusive' }];
  }
  return [];
}

function taxMode(components) {
  if (!components.length || components.every(component => !component.inclusive)) return 'exclusive';
  if (components.every(component => component.inclusive)) return 'inclusive';
  return 'mixed';
}

function legacyTaxRate(components) {
  return components.reduce((sum, component) => sum + Number(component.rate), 0);
}

function invalidDueDate() {
  return new HttpError(400, 'validation_error', 'Request validation failed.', [
    { field: 'due_date', message: 'must be on or after invoice_date' },
  ]);
}

function invoiceAuditState(invoice) {
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    currency: invoice.currency,
    total_amount: Number(invoice.total_amount),
    amount_paid: Number(invoice.amount_paid),
    credited_amount: Number(invoice.credited_amount || 0),
    balance_due: Number(invoice.balance_due),
  };
}
