import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';

import { getDb } from '../server/db.js';
import { financialAuditQuery } from '../server/financial-records.js';
import { getRequiredId, HttpError, json, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';

const MAX_PDF_BYTES = 3 * 1024 * 1024;

export default withApiRoute({
  methods: ['POST'],
  maxBodyBytes: 4 * 1024 * 1024,
  async handler({ req, res, userId, requestId }) {
    if (!process.env.RESEND_API_KEY || !process.env.INVOICE_FROM_EMAIL) {
      throw new HttpError(503, 'email_not_configured', 'Invoice email is not configured.');
    }

    const invoiceId = getRequiredId({ id: req.body?.invoiceId });
    const pdf = decodePdf(req.body?.pdfBase64);
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const rows = await sql`
      SELECT i.id, i.invoice_number, i.total_amount, i.balance_due, i.currency,
             i.due_date, i.status, i.sent_at, c.name, c.email
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
      WHERE i.id = ${invoiceId} AND i.workspace_id = ${workspace.id}
    `;
    const invoice = rows[0];
    if (!invoice) throw new HttpError(404, 'not_found', 'Invoice not found.');
    invoice.legal_name = workspace.legal_name;
    if (['cancelled', 'void'].includes(invoice.status)) {
      throw new HttpError(409, 'financial_record_protected', 'A cancelled or void invoice cannot be delivered.');
    }
    const deliveryId = randomUUID();
    await sql`
      INSERT INTO invoice_deliveries (
        id, workspace_id, invoice_id, recipient, provider, status, retry_of_id, attempted_by, request_id
      ) VALUES (
        ${deliveryId}, ${workspace.id}, ${invoice.id}, ${invoice.email}, 'resend', 'queued',
        (SELECT id FROM invoice_deliveries
         WHERE workspace_id = ${workspace.id} AND invoice_id = ${invoice.id} AND status = 'failed'
         ORDER BY created_at DESC, id DESC LIMIT 1),
        ${userId}, ${requestId}
      )
    `;

    const resend = new Resend(process.env.RESEND_API_KEY);
    let deliveryResult;
    try {
      deliveryResult = await resend.emails.send({
        from: process.env.INVOICE_FROM_EMAIL,
        to: [invoice.email],
        subject: `Invoice ${invoice.invoice_number}`,
        html: invoiceEmailHtml(invoice),
        attachments: [{ filename: `${safeFilename(invoice.invoice_number)}.pdf`, content: pdf }],
      });
    } catch (providerError) {
      await recordDeliveryFailure(sql, { workspace, invoice, deliveryId, userId, requestId, error: providerError });
      throw new HttpError(502, 'email_delivery_failed', 'The email provider could not be reached.');
    }
    const { data, error } = deliveryResult;
    if (error) {
      await recordDeliveryFailure(sql, { workspace, invoice, deliveryId, userId, requestId, error });
      console.error(JSON.stringify({ level: 'error', event: 'invoice_email_failed', code: error.name }));
      throw new HttpError(502, 'email_delivery_failed', 'The email provider rejected the message.');
    }

    await sql.transaction([
      sql`
        UPDATE invoice_deliveries SET status = 'sent', provider_message_id = ${data.id}, sent_at = NOW()
        WHERE id = ${deliveryId} AND workspace_id = ${workspace.id}
      `,
      sql`
        UPDATE invoices SET sent_at = COALESCE(sent_at, NOW()),
          status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
          updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${invoice.id} AND workspace_id = ${workspace.id}
      `,
      financialAuditQuery(sql, {
        workspaceId: workspace.id, actorUserId: userId, action: 'invoice.sent',
        entityType: 'invoice', entityId: invoice.id,
        beforeState: { status: invoice.status, sent_at: invoice.sent_at },
        afterState: { status: invoice.status === 'draft' ? 'sent' : invoice.status, provider: 'resend', provider_message_id: data.id, delivery_id: deliveryId },
        requestId,
      }),
    ]);
    return json(res, 202, { data: { messageId: data.id, deliveryId, status: 'sent' } });
  },
});

function decodePdf(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'validation_error', 'A PDF attachment is required.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new HttpError(400, 'validation_error', 'The PDF attachment is invalid.');
  }
  const content = Buffer.from(value, 'base64');
  if (content.length === 0 || content.length > MAX_PDF_BYTES || content.subarray(0, 5).toString() !== '%PDF-') {
    throw new HttpError(400, 'validation_error', 'The PDF attachment must be a PDF no larger than 3 MB.');
  }
  return content;
}

function invoiceEmailHtml(invoice) {
  return `
    <p>Hello ${escapeHtml(invoice.name)},</p>
    <p>Please find invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> attached.</p>
    <p>Amount due: <strong>${escapeHtml(formatCurrency(invoice.balance_due, invoice.currency))}</strong><br>
       Due date: ${escapeHtml(String(invoice.due_date))}</p>
    <p>Thank you for your business${invoice.legal_name ? ` with ${escapeHtml(invoice.legal_name)}` : ''}.</p>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
}

function formatCurrency(value, currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD' }).format(Number(value));
  } catch {
    return `${currency || 'USD'} ${Number(value).toFixed(2)}`;
  }
}

function providerFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : 'Provider rejected the message.';
  return message.slice(0, 1_000);
}

async function recordDeliveryFailure(sql, { workspace, invoice, deliveryId, userId, requestId, error }) {
  await sql.transaction([
    sql`
      UPDATE invoice_deliveries SET status = 'failed', failed_at = NOW(),
        failure_reason = ${providerFailure(error)}
      WHERE id = ${deliveryId} AND workspace_id = ${workspace.id}
    `,
    financialAuditQuery(sql, {
      workspaceId: workspace.id, actorUserId: userId, action: 'invoice.delivery_failed',
      entityType: 'invoice', entityId: invoice.id,
      afterState: { invoice_id: invoice.id, recipient: invoice.email, provider: 'resend', status: 'failed' },
      requestId,
    }),
  ]);
}
