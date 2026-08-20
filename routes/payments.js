import { randomUUID } from 'node:crypto';

import { getDb } from '../server/db.js';
import { assertCurrencyMatch } from '../server/financial.js';
import {
  getInvoiceDetail,
  invoiceReconciliationQuery,
} from '../server/financial-records.js';
import {
  getPagination,
  getQueryDate,
  getQueryEnum,
  getQueryUuid,
  json,
  paginated,
  stripTotalCount,
  withApiRoute,
  HttpError,
} from '../server/http.js';
import { validatePayment } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const invoiceId = getQueryUuid(req.query, 'invoice_id');
      const status = getQueryEnum(req.query, 'status', ['settled', 'void']);
      const from = getQueryDate(req.query, 'from');
      const to = getQueryDate(req.query, 'to');
      const rows = await sql`
        SELECT p.id, p.invoice_id, p.amount, p.currency, p.payment_date,
               p.payment_method, p.transaction_reference, p.notes, p.status,
               p.voided_at, p.created_by, p.created_at, i.invoice_number,
               COUNT(*) OVER() AS __total_count
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id AND i.workspace_id = p.workspace_id
        WHERE p.workspace_id = ${workspace.id}
          AND (${invoiceId}::uuid IS NULL OR p.invoice_id = ${invoiceId})
          AND (${status}::text IS NULL OR p.status = ${status})
          AND (${from}::date IS NULL OR p.payment_date >= ${from}::date)
          AND (${to}::date IS NULL OR p.payment_date <= ${to}::date)
        ORDER BY p.payment_date DESC, p.id DESC
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    const input = validatePayment(req.body);
    const invoice = await getInvoiceDetail(sql, workspace.id, input.invoice_id);
    if (['cancelled', 'void'].includes(invoice.status)) {
      throw new HttpError(409, 'financial_record_protected', 'Payments cannot be recorded against a cancelled or void invoice.');
    }
    const currency = input.currency || invoice.currency;
    assertCurrencyMatch(invoice.currency, currency, 'Payment currency');
    if (Number(input.amount) > Number(invoice.balance_due)) {
      throw new HttpError(409, 'payment_exceeds_balance', 'Payment amount cannot exceed the current invoice balance.');
    }
    const paymentId = randomUUID();
    const results = await sql.transaction([
      sql`
        WITH locked_invoice AS (
          SELECT id, balance_due, status
          FROM invoices
          WHERE id = ${invoice.id} AND workspace_id = ${workspace.id}
          FOR UPDATE
        )
        INSERT INTO payments (
          id, workspace_id, invoice_id, amount, currency, payment_date,
          payment_method, transaction_reference, notes, created_by
        ) SELECT
          ${paymentId}, ${workspace.id}, ${invoice.id}, ${input.amount}, ${currency},
          ${input.payment_date}, ${input.payment_method}, ${input.transaction_reference},
          ${input.notes}, ${userId}
        FROM locked_invoice
        WHERE status NOT IN ('cancelled', 'void') AND balance_due >= ${input.amount}
        RETURNING id, invoice_id, amount, currency, payment_date, payment_method,
                  transaction_reference, notes, status, created_by, created_at
      `,
      invoiceReconciliationQuery(sql, workspace.id, invoice.id),
      paymentAuditQuery(sql, {
        workspaceId: workspace.id, actorUserId: userId, paymentId,
        invoiceId: invoice.id, amount: input.amount, currency,
        paymentDate: input.payment_date, requestId,
      }),
    ]);
    if (!results[0][0]) {
      throw new HttpError(409, 'payment_conflict', 'The invoice balance changed before this payment could be recorded.');
    }
    return json(res, 201, {
      data: {
        payment: results[0][0],
        invoice: await getInvoiceDetail(sql, workspace.id, invoice.id),
      },
    });
  },
});

function paymentAuditQuery(sql, { workspaceId, actorUserId, paymentId, invoiceId, amount, currency, paymentDate, requestId }) {
  return sql`
    INSERT INTO financial_audit_events (
      workspace_id, actor_user_id, action, entity_type, entity_id, after_state, request_id
    )
    SELECT ${workspaceId}, ${actorUserId}, 'payment.recorded', 'payment', ${paymentId},
           ${JSON.stringify({ invoice_id: invoiceId, amount, currency, payment_date: paymentDate })}::jsonb,
           ${requestId}
    WHERE EXISTS (
      SELECT 1 FROM payments WHERE id = ${paymentId} AND workspace_id = ${workspaceId}
    )
  `;
}
