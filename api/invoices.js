import { randomUUID } from 'node:crypto';

import { getDb } from '../server/db.js';
import { getPagination, getRequiredId, HttpError, json, noContent, paginated, withApiRoute } from '../server/http.js';
import { calculateInvoiceTotals, validateInvoice } from '../server/validation.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();

    if (req.method === 'GET') {
      const { limit, offset } = getPagination(req.query);
      const rows = await sql`
        SELECT id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
               subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
               created_at, updated_at, paid_at
        FROM invoices
        WHERE user_id = ${userId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1} OFFSET ${offset}
      `;
      return json(res, 200, paginated(rows, limit, offset));
    }

    if (req.method === 'POST') {
      const input = validateInvoice(req.body);
      await assertOwnedCustomer(sql, input.customer_id, userId);
      const invoice = buildInvoice({
        ...input,
        invoice_number: createInvoiceNumber(),
      });
      const rows = await sql`
        INSERT INTO invoices (
          user_id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
          subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due, paid_at
        )
        VALUES (
          ${userId}, ${invoice.customer_id}, ${invoice.invoice_number}, ${invoice.invoice_date}, ${invoice.due_date},
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
      const updates = validateInvoice(req.body, { partial: true });
      const existingRows = await sql`
        SELECT id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
               subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
               created_at, updated_at, paid_at
        FROM invoices WHERE id = ${id} AND user_id = ${userId}
      `;
      if (!existingRows[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');

      const existing = existingRows[0];
      const invoice = buildInvoice({
        ...existing,
        ...updates,
        invoice_number: existing.invoice_number,
      });
      if (updates.customer_id) await assertOwnedCustomer(sql, updates.customer_id, userId);

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
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, customer_id, invoice_number, invoice_date, due_date, status, items, notes, terms,
                  subtotal, tax_rate, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
                  created_at, updated_at, paid_at
      `;
      return json(res, 200, { data: rows[0] });
    }

    const deleted = await sql`DELETE FROM invoices WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');
    return noContent(res);
  },
});

function buildInvoice(input) {
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

async function assertOwnedCustomer(sql, customerId, userId) {
  const rows = await sql`SELECT id FROM customers WHERE id = ${customerId} AND user_id = ${userId}`;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Customer does not exist.');
}

function createInvoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `INV-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
