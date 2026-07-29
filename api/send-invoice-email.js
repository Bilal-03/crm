import { Resend } from 'resend';

import { getDb } from '../server/db.js';
import { getRequiredId, HttpError, json, withApiRoute } from '../server/http.js';
import { getPersonalWorkspace } from '../server/workspaces.js';

const MAX_PDF_BYTES = 3 * 1024 * 1024;

export default withApiRoute({
  methods: ['POST'],
  maxBodyBytes: 4 * 1024 * 1024,
  async handler({ req, res, userId }) {
    if (!process.env.RESEND_API_KEY || !process.env.INVOICE_FROM_EMAIL) {
      throw new HttpError(503, 'email_not_configured', 'Invoice email is not configured.');
    }

    const invoiceId = getRequiredId({ id: req.body?.invoiceId });
    const pdf = decodePdf(req.body?.pdfBase64);
    const sql = getDb();
    const workspace = await getPersonalWorkspace(sql, userId);
    const rows = await sql`
      SELECT i.invoice_number, i.total_amount, i.due_date, c.name, c.email
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.workspace_id = i.workspace_id
      WHERE i.id = ${invoiceId} AND i.workspace_id = ${workspace.id}
    `;
    const invoice = rows[0];
    if (!invoice) throw new HttpError(404, 'not_found', 'Invoice not found.');

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.INVOICE_FROM_EMAIL,
      to: [invoice.email],
      subject: `Invoice ${invoice.invoice_number}`,
      html: invoiceEmailHtml(invoice),
      attachments: [{ filename: `${safeFilename(invoice.invoice_number)}.pdf`, content: pdf }],
    });
    if (error) {
      console.error(JSON.stringify({ level: 'error', event: 'invoice_email_failed', code: error.name }));
      throw new HttpError(502, 'email_delivery_failed', 'The email provider rejected the message.');
    }

    return json(res, 202, { data: { messageId: data.id } });
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
    <p>Amount due: <strong>$${Number(invoice.total_amount).toFixed(2)}</strong><br>
       Due date: ${escapeHtml(String(invoice.due_date))}</p>
    <p>Thank you for your business.</p>
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
