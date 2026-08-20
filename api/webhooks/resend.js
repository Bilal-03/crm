import { Resend } from 'resend';

import { getDb } from '../../server/db.js';
import { createNotification } from '../../server/notifications.js';

export const config = { api: { bodyParser: false } };

export default async function resendWebhook(req, res) {
  setHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return send(res, 503, { error: { code: 'webhook_not_configured', message: 'Webhook verification is not configured.' } });

  try {
    const payload = await readRawBody(req);
    const event = new Resend().webhooks.verify({
      payload,
      headers: {
        id: requiredHeader(req, 'svix-id'),
        timestamp: requiredHeader(req, 'svix-timestamp'),
        signature: requiredHeader(req, 'svix-signature'),
      },
      webhookSecret: secret,
    });
    const status = deliveryStatus(event.type);
    if (!status || !event.data?.email_id) return send(res, 202, { received: true });

    const sql = getDb();
    const messages = await sql`
      UPDATE outbound_messages
      SET status = ${status},
          delivered_at = CASE WHEN ${status} = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
          failed_at = CASE WHEN ${status} = 'failed' THEN COALESCE(failed_at, NOW()) ELSE failed_at END,
          failure_reason = CASE WHEN ${status} = 'failed' THEN ${failureReason(event)} ELSE failure_reason END,
          updated_at = NOW()
      WHERE provider = 'resend' AND provider_message_id = ${event.data.email_id}
      RETURNING id, workspace_id, attempted_by, subject, recipient, status, failure_reason
    `;
    const message = messages[0];
    if (message) {
      await sql`
        UPDATE activities
        SET outcome = ${status === 'delivered'
          ? `Delivered to ${message.recipient}`
          : status === 'failed' ? `Delivery failed: ${message.failure_reason}` : `Sent to ${message.recipient}`},
            updated_at = NOW()
        WHERE workspace_id = ${message.workspace_id}
          AND source_type = 'outbound_message' AND source_id = ${message.id}
      `;
      if (status === 'failed') {
        await createNotification(sql, {
          workspaceId: message.workspace_id,
          recipientUserId: message.attempted_by,
          type: 'failed_sync',
          title: 'Email delivery failed',
          body: `${message.subject}: ${message.failure_reason}`.slice(0, 1_000),
          entityType: 'outbound_message',
          entityId: message.id,
          dedupeKey: `resend-failure:${event.data.email_id}`,
          actionUrl: '/communications',
        });
      }
    }
    return send(res, 200, { received: true });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'warn', event: 'resend_webhook_rejected',
      error: error instanceof Error ? error.message : String(error),
    }));
    return send(res, 400, { error: { code: 'invalid_webhook', message: 'Webhook signature or payload is invalid.' } });
  }
}

function deliveryStatus(type) {
  if (type === 'email.delivered') return 'delivered';
  if (['email.failed', 'email.bounced', 'email.suppressed', 'email.complained'].includes(type)) return 'failed';
  if (['email.sent', 'email.delivery_delayed'].includes(type)) return 'sent';
  return null;
}

function failureReason(event) {
  return String(event.data?.failed?.reason
    || event.data?.bounce?.message
    || event.data?.suppressed?.message
    || `Resend reported ${event.type}.`).slice(0, 1_000);
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Webhook payload is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requiredHeader(req, name) {
  const value = req.headers[name];
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${name} header.`);
  return value;
}

function setHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function send(res, status, body) {
  res.statusCode = status;
  return res.end(JSON.stringify(body));
}
