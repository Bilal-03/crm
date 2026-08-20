import { randomUUID } from 'node:crypto';

import { getDb } from '../../server/db.js';
import {
  financialAuditQuery,
  getInvoiceDetail,
  invoiceReconciliationQuery,
  requireFinancialManager,
  reserveDocumentNumber,
} from '../../server/financial-records.js';
import { HttpError, json, withApiRoute } from '../../server/http.js';
import { validateInvoiceAction } from '../../server/validation.js';
import { getActiveWorkspace } from '../../server/workspaces.js';
import { assertRecordAccess } from '../../server/authorization.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId, requestId }) {
    const input = validateInvoiceAction(req.body);
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    await assertRecordAccess(sql, workspace, userId, 'invoices', 'user_id', input.invoice_id);
    const invoice = await getInvoiceDetail(sql, workspace.id, input.invoice_id);

    if (input.action === 'cancel') {
      if (invoice.status === 'cancelled') return json(res, 200, { data: invoice });
      if (invoice.status !== 'draft' || invoice.sent_at || invoice.payments.some(payment => payment.status === 'settled')) {
        throw new HttpError(409, 'financial_record_protected', 'Only an unsent, unpaid draft invoice can be cancelled.');
      }
      await sql.transaction([
        sql`
          UPDATE invoices SET status = 'cancelled', cancelled_at = NOW(), updated_by = ${userId}, updated_at = NOW()
          WHERE id = ${invoice.id} AND workspace_id = ${workspace.id} AND status = 'draft'
          RETURNING id
        `,
        financialAuditQuery(sql, {
          workspaceId: workspace.id,
          actorUserId: userId,
          action: 'invoice.cancelled',
          entityType: 'invoice',
          entityId: invoice.id,
          beforeState: invoiceAuditState(invoice),
          afterState: { ...invoiceAuditState(invoice), status: 'cancelled' },
          requestId,
        }),
      ]);
      return json(res, 200, { data: await getInvoiceDetail(sql, workspace.id, invoice.id) });
    }

    requireFinancialManager(workspace);
    if (input.action === 'void') {
      if (invoice.status === 'void') return json(res, 200, { data: invoice });
      if (!['sent', 'overdue'].includes(invoice.status) || invoice.payments.some(payment => payment.status === 'settled')) {
        throw new HttpError(409, 'financial_record_protected', 'Only sent or overdue invoices without payments can be voided. Use a credit note for paid invoices.');
      }
      await sql.transaction([
        sql`
          UPDATE invoices
          SET status = 'void', voided_at = NOW(), balance_due = 0,
              notes = concat_ws(E'\n', notes, ${`Void reason: ${input.reason}`}),
              updated_by = ${userId}, updated_at = NOW()
          WHERE id = ${invoice.id} AND workspace_id = ${workspace.id}
          RETURNING id
        `,
        financialAuditQuery(sql, {
          workspaceId: workspace.id,
          actorUserId: userId,
          action: 'invoice.voided',
          entityType: 'invoice',
          entityId: invoice.id,
          beforeState: invoiceAuditState(invoice),
          afterState: { ...invoiceAuditState(invoice), status: 'void', reason: input.reason },
          requestId,
        }),
      ]);
      return json(res, 200, { data: await getInvoiceDetail(sql, workspace.id, invoice.id) });
    }

    if (['cancelled', 'void'].includes(invoice.status)) {
      throw new HttpError(409, 'financial_record_protected', 'Credit notes cannot be issued against a cancelled or void invoice.');
    }
    const existingCredits = invoice.credit_notes
      .filter(note => note.status === 'issued')
      .reduce((sum, note) => sum + Number(note.amount), 0);
    if (Number(input.amount) > Number(invoice.total_amount) - existingCredits) {
      throw new HttpError(409, 'credit_exceeds_invoice', 'Credit note amount exceeds the remaining creditable invoice total.');
    }
    const creditNoteId = randomUUID();
    const creditNoteNumber = await reserveDocumentNumber(sql, workspace.id, 'credit_note');
    const results = await sql.transaction([
      sql`
        WITH locked_invoice AS (
          SELECT id, total_amount
          FROM invoices
          WHERE id = ${invoice.id} AND workspace_id = ${workspace.id}
          FOR UPDATE
        )
        INSERT INTO credit_notes (
          id, workspace_id, invoice_id, credit_note_number, amount, currency,
          reason, created_by
        ) SELECT
          ${creditNoteId}, ${workspace.id}, ${invoice.id}, ${creditNoteNumber},
          ${input.amount}, ${invoice.currency}, ${input.reason}, ${userId}
        FROM locked_invoice locked
        WHERE ${input.amount} <= locked.total_amount - COALESCE((
          SELECT SUM(amount) FROM credit_notes
          WHERE invoice_id = locked.id AND workspace_id = ${workspace.id} AND status = 'issued'
        ), 0)
        RETURNING *
      `,
      invoiceReconciliationQuery(sql, workspace.id, invoice.id),
      creditAuditQuery(sql, {
        workspaceId: workspace.id, actorUserId: userId, creditNoteId,
        invoiceId: invoice.id, creditNoteNumber, amount: input.amount,
        currency: invoice.currency, reason: input.reason, requestId,
      }),
    ]);
    if (!results[0][0]) {
      throw new HttpError(409, 'credit_conflict', 'The creditable invoice amount changed before this credit note could be issued.');
    }
    return json(res, 201, {
      data: {
        credit_note: results[0][0],
        invoice: await getInvoiceDetail(sql, workspace.id, invoice.id),
      },
    });
  },
});

function invoiceAuditState(invoice) {
  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    currency: invoice.currency,
    total_amount: Number(invoice.total_amount),
    amount_paid: Number(invoice.amount_paid),
    credited_amount: Number(invoice.credited_amount),
    balance_due: Number(invoice.balance_due),
  };
}

function creditAuditQuery(sql, { workspaceId, actorUserId, creditNoteId, invoiceId, creditNoteNumber, amount, currency, reason, requestId }) {
  return sql`
    INSERT INTO financial_audit_events (
      workspace_id, actor_user_id, action, entity_type, entity_id, after_state, request_id
    )
    SELECT ${workspaceId}, ${actorUserId}, 'credit_note.issued', 'credit_note', ${creditNoteId},
           ${JSON.stringify({ invoice_id: invoiceId, credit_note_number: creditNoteNumber, amount, currency, reason })}::jsonb,
           ${requestId}
    WHERE EXISTS (
      SELECT 1 FROM credit_notes WHERE id = ${creditNoteId} AND workspace_id = ${workspaceId}
    )
  `;
}
