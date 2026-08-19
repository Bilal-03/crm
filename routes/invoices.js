import { randomUUID } from 'node:crypto';

import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryDate,
  getQueryEnum,
  getQueryString,
  getRequiredId,
  getSort,
  HttpError,
  json,
  noContent,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { calculateInvoiceTotals, validateInvoice } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const status = getQueryEnum(req.query, 'status', ['draft', 'sent', 'paid', 'overdue', 'partial', 'cancelled']);
      const from = getQueryDate(req.query, 'from');
      const to = getQueryDate(req.query, 'to');
      const orderBy = getSort(req.query, {
        created: 'i.created_at',
        invoiceDate: 'i.invoice_date',
        dueDate: 'i.due_date',
        total: 'i.total_amount',
      }, 'created', 'desc', 'i.id');
      const rows = await sql`
        SELECT i.id, i.customer_id, i.invoice_number, i.invoice_date, i.due_date, i.status, i.items, i.notes, i.terms,
               i.subtotal, i.tax_rate, i.tax_amount, i.discount_amount, i.total_amount, i.amount_paid, i.balance_due,
               i.created_at, i.updated_at, i.paid_at, COUNT(*) OVER() AS __total_count
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
        WHERE i.workspace_id = ${workspace.id}
          AND (${search}::text IS NULL OR i.invoice_number ILIKE ${search ? `%${search}%` : null} OR c.name ILIKE ${search ? `%${search}%` : null} OR c.company ILIKE ${search ? `%${search}%` : null})
          AND (${status}::text IS NULL OR i.status = ${status})
          AND (${from}::date IS NULL OR i.invoice_date >= ${from}::date)
          AND (${to}::date IS NULL OR i.invoice_date <= ${to}::date)
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateInvoice(req.body);
      await assertOwnedCustomer(sql, input.customer_id, workspace.id);
      const invoice = buildInvoice({
        ...input,
        invoice_number: createInvoiceNumber(),
      });
      const rows = await sql`
        INSERT INTO invoices (
          workspace_id, user_id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
          subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due, paid_at
        )
        VALUES (
          ${workspace.id}, ${userId}, ${invoice.customer_id}, ${invoice.invoice_number}, ${invoice.invoice_date}, ${invoice.due_date},
          ${invoice.status}, ${JSON.stringify(invoice.items)}, ${invoice.notes ?? null}, ${invoice.terms ?? null},
          ${invoice.subtotal}, ${invoice.tax_rate}, ${invoice.tax_amount}, ${invoice.discount_amount},
          ${invoice.total_amount}, ${invoice.amount_paid}, ${invoice.balance_due}, ${invoice.paid_at}
        )
        RETURNING id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
                  subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
                  created_at, updated_at, paid_at
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);

    if (req.method === 'PUT') {
      const updates = validateInvoice(req.body, { partial: true, allowAmountPaid: false });
      const existingRows = await sql`
        SELECT id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
               subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
               created_at, updated_at, paid_at
        FROM invoices WHERE id = ${id} AND workspace_id = ${workspace.id}
      `;
      if (!existingRows[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');

      const existing = existingRows[0];
      const invoice = buildInvoice({
        ...existing,
        ...updates,
        invoice_number: existing.invoice_number,
      });
      if (updates.customer_id) await assertOwnedCustomer(sql, updates.customer_id, workspace.id);

      const rows = await sql`
        UPDATE invoices SET
          customer_id = ${invoice.customer_id},
          invoice_date = ${invoice.invoice_date},
          due_date = ${invoice.due_date},
          status = ${invoice.status},
          items = ${JSON.stringify(invoice.items)},
          notes = ${invoice.notes ?? null},
          terms = ${invoice.terms ?? null},
          subtotal = ${invoice.subtotal},
          tax_rate = ${invoice.tax_rate},
          tax_amount = ${invoice.tax_amount},
          discount_amount = ${invoice.discount_amount},
          total_amount = ${invoice.total_amount},
          amount_paid = ${invoice.amount_paid},
          balance_due = ${invoice.balance_due},
          paid_at = ${invoice.paid_at},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
                  subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
                  created_at, updated_at, paid_at
      `;
      return json(res, 200, { data: rows[0] });
    }

    const existingRows = await sql`
      SELECT id, status, amount_paid
      FROM invoices
      WHERE id = ${id} AND workspace_id = ${workspace.id}
    `;
    if (!existingRows[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');
    if (!isInvoiceDeletable(existingRows[0])) {
      throw new HttpError(409, 'financial_record_protected', 'Only unpaid draft invoices can be deleted. Void or cancel the invoice instead.');
    }
    const deleted = await sql`DELETE FROM invoices WHERE id = ${id} AND workspace_id = ${workspace.id} RETURNING id`;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');
    return noContent(res);
  },
});

export function buildInvoice(input) {
  if (input.due_date < input.invoice_date) {
    throw new HttpError(400, 'validation_error', 'Request validation failed.', [
      { field: 'due_date', message: 'must be on or after invoice_date' },
    ]);
  }

  const taxRate = Number(input.tax_rate ?? 0);
  const discountAmount = Number(input.discount_amount ?? 0);
  const preliminary = calculateInvoiceTotals(input.items, taxRate, discountAmount, Number(input.amount_paid ?? 0));
  const amountPaid = input.status === 'paid' ? preliminary.total_amount : preliminary.amount_paid;
  const totals = calculateInvoiceTotals(input.items, taxRate, discountAmount, amountPaid);

  return {
    ...input,
    tax_rate: taxRate,
    discount_amount: discountAmount,
    ...totals,
    paid_at: input.status === 'paid' ? input.paid_at ?? new Date().toISOString() : null,
  };
}

export function isInvoiceDeletable(invoice) {
  return invoice?.status === 'draft' && Number(invoice.amount_paid || 0) === 0;
}

async function assertOwnedCustomer(sql, customerId, workspaceId) {
  const rows = await sql`SELECT id FROM customers WHERE id = ${customerId} AND workspace_id = ${workspaceId}`;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Customer does not exist.');
}

function createInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `INV-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
