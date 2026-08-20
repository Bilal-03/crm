import { HttpError } from './http.js';

const NUMBERING = Object.freeze({
  quote: { prefix: 'quote_prefix', sequence: 'next_quote_number' },
  invoice: { prefix: 'invoice_prefix', sequence: 'next_invoice_number' },
  credit_note: { prefix: 'credit_note_prefix', sequence: 'next_credit_note_number' },
});

export async function reserveDocumentNumber(sql, workspaceId, type, date = new Date()) {
  const config = NUMBERING[type];
  if (!config) throw new Error(`Unsupported financial document type: ${type}`);
  const rows = await sql`
    UPDATE workspaces
    SET ${sql.unsafe(config.sequence)} = ${sql.unsafe(config.sequence)} + 1,
        updated_at = NOW()
    WHERE id = ${workspaceId}
    RETURNING ${sql.unsafe(config.prefix)} AS prefix,
              ${sql.unsafe(config.sequence)} - 1 AS sequence
  `;
  if (!rows[0]) throw new HttpError(404, 'workspace_not_found', 'Workspace not found.');
  const year = date.getUTCFullYear();
  return `${rows[0].prefix}-${year}-${String(rows[0].sequence).padStart(5, '0')}`;
}

export function financialAuditQuery(sql, {
  workspaceId,
  actorUserId,
  action,
  entityType,
  entityId = null,
  beforeState = null,
  afterState = null,
  requestId = null,
}) {
  return sql`
    INSERT INTO financial_audit_events (
      workspace_id, actor_user_id, action, entity_type, entity_id,
      before_state, after_state, request_id
    ) VALUES (
      ${workspaceId}, ${actorUserId}, ${action}, ${entityType}, ${entityId},
      ${beforeState ? JSON.stringify(beforeState) : null}::jsonb,
      ${afterState ? JSON.stringify(afterState) : null}::jsonb,
      ${requestId}
    )
    RETURNING id
  `;
}

export async function reconcileInvoice(sql, workspaceId, invoiceId) {
  const rows = await invoiceReconciliationQuery(sql, workspaceId, invoiceId);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');
  return rows[0];
}

export function invoiceReconciliationQuery(sql, workspaceId, invoiceId) {
  return sql`
    WITH totals AS (
      SELECT i.id,
             COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.workspace_id = i.workspace_id AND p.status = 'settled'), 0) AS paid,
             COALESCE((SELECT SUM(c.amount) FROM credit_notes c WHERE c.invoice_id = i.id AND c.workspace_id = i.workspace_id AND c.status = 'issued'), 0) AS credited
      FROM invoices i
      WHERE i.id = ${invoiceId} AND i.workspace_id = ${workspaceId}
    )
    UPDATE invoices i
    SET amount_paid = LEAST(t.paid, i.total_amount),
        credited_amount = LEAST(t.credited, GREATEST(i.total_amount - LEAST(t.paid, i.total_amount), 0)),
        balance_due = CASE
          WHEN i.status IN ('cancelled', 'void') THEN 0
          ELSE GREATEST(i.total_amount - t.paid - t.credited, 0)
        END,
        status = CASE
          WHEN i.status IN ('cancelled', 'void') THEN i.status
          WHEN i.total_amount > 0 AND t.paid + t.credited >= i.total_amount THEN 'paid'
          WHEN t.paid > 0 OR t.credited > 0 THEN 'partial'
          WHEN i.sent_at IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'overdue'
          WHEN i.sent_at IS NOT NULL THEN 'sent'
          ELSE 'draft'
        END,
        paid_at = CASE
          WHEN i.total_amount > 0 AND t.paid >= i.total_amount THEN COALESCE(i.paid_at, NOW())
          WHEN t.paid < i.total_amount THEN NULL
          ELSE i.paid_at
        END,
        updated_at = NOW()
    FROM totals t
    WHERE i.id = t.id
    RETURNING i.*
  `;
}

export async function getInvoiceDetail(sql, workspaceId, invoiceId) {
  const rows = await sql`
    SELECT i.*,
           c.name AS customer_name, c.company AS customer_company, c.email AS customer_email,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'amount', p.amount, 'currency', p.currency,
               'payment_date', p.payment_date, 'payment_method', p.payment_method,
               'transaction_reference', p.transaction_reference, 'notes', p.notes,
               'status', p.status, 'created_at', p.created_at, 'voided_at', p.voided_at
             ) ORDER BY p.payment_date DESC, p.id DESC)
             FROM payments p WHERE p.invoice_id = i.id AND p.workspace_id = i.workspace_id
           ), '[]'::jsonb) AS payments,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', cn.id, 'credit_note_number', cn.credit_note_number,
               'amount', cn.amount, 'currency', cn.currency, 'reason', cn.reason,
               'status', cn.status, 'issued_at', cn.issued_at, 'voided_at', cn.voided_at
             ) ORDER BY cn.issued_at DESC, cn.id DESC)
             FROM credit_notes cn WHERE cn.invoice_id = i.id AND cn.workspace_id = i.workspace_id
           ), '[]'::jsonb) AS credit_notes,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'recipient', d.recipient, 'provider', d.provider,
               'provider_message_id', d.provider_message_id, 'status', d.status,
               'sent_at', d.sent_at, 'delivered_at', d.delivered_at,
               'failed_at', d.failed_at, 'failure_reason', d.failure_reason,
               'created_at', d.created_at
             ) ORDER BY d.created_at DESC, d.id DESC)
             FROM invoice_deliveries d WHERE d.invoice_id = i.id AND d.workspace_id = i.workspace_id
           ), '[]'::jsonb) AS deliveries,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'rate', t.rate,
               'amount', t.amount, 'inclusive', t.inclusive, 'position', t.position
             ) ORDER BY t.position, t.id)
             FROM tax_components t WHERE t.invoice_id = i.id AND t.workspace_id = i.workspace_id
           ), '[]'::jsonb) AS tax_components
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
    WHERE i.id = ${invoiceId} AND i.workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Invoice not found.');
  return rows[0];
}

export function requireFinancialManager(workspace) {
  if (!['owner', 'admin'].includes(workspace.role)) {
    throw new HttpError(403, 'financial_permission_denied', 'Only workspace owners and admins can void documents or issue credit notes.');
  }
}
