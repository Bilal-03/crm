import { getDb } from '../../server/db.js';
import {
  financialAuditQuery,
  getInvoiceDetail,
  invoiceReconciliationQuery,
  requireFinancialManager,
} from '../../server/financial-records.js';
import { getRequiredId, HttpError, json, withApiRoute } from '../../server/http.js';
import { getActiveWorkspace } from '../../server/workspaces.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    requireFinancialManager(workspace);
    const paymentId = getRequiredId({ id: req.body?.payment_id });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) throw new HttpError(400, 'validation_error', 'A reason is required to void a payment.');
    const rows = await sql`
      SELECT p.*, i.invoice_number
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id AND i.workspace_id = p.workspace_id
      WHERE p.id = ${paymentId} AND p.workspace_id = ${workspace.id}
    `;
    const payment = rows[0];
    if (!payment) throw new HttpError(404, 'not_found', 'Payment not found.');
    if (payment.status === 'void') return json(res, 200, { data: { payment, invoice: await getInvoiceDetail(sql, workspace.id, payment.invoice_id) } });
    const results = await sql.transaction([
      sql`
        UPDATE payments SET status = 'void', voided_at = NOW(), voided_by = ${userId},
          notes = concat_ws(E'\n', notes, ${`Void reason: ${reason}`})
        WHERE id = ${paymentId} AND workspace_id = ${workspace.id} AND status = 'settled'
        RETURNING *
      `,
      invoiceReconciliationQuery(sql, workspace.id, payment.invoice_id),
      financialAuditQuery(sql, {
        workspaceId: workspace.id,
        actorUserId: userId,
        action: 'payment.voided',
        entityType: 'payment',
        entityId: paymentId,
        beforeState: { status: payment.status, amount: Number(payment.amount), invoice_id: payment.invoice_id },
        afterState: { status: 'void', reason },
        requestId,
      }),
    ]);
    if (!results[0][0]) throw new HttpError(409, 'payment_conflict', 'The payment changed before it could be voided.');
    return json(res, 200, {
      data: {
        payment: results[0][0],
        invoice: await getInvoiceDetail(sql, workspace.id, payment.invoice_id),
      },
    });
  },
});
