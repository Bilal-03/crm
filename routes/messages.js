import { getDb } from '../server/db.js';
import { createEmailProvider, providerMessage } from '../server/communications.js';
import {
  getPagination,
  getQueryEnum,
  getQueryString,
  getQueryUuid,
  HttpError,
  json,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { validateOutboundMessage } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

const TARGETS = [
  ['lead_id', 'leads', 'Lead'],
  ['account_id', 'accounts', 'Account'],
  ['contact_id', 'contacts', 'Contact'],
  ['deal_id', 'deals', 'Deal'],
];

export default withApiRoute({
  methods: ['GET', 'POST'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const status = getQueryEnum(req.query, 'status', ['queued', 'sent', 'delivered', 'failed']);
      const search = getQueryString(req.query, 'search', 160);
      const leadId = getQueryUuid(req.query, 'lead_id');
      const accountId = getQueryUuid(req.query, 'account_id');
      const contactId = getQueryUuid(req.query, 'contact_id');
      const dealId = getQueryUuid(req.query, 'deal_id');
      const rows = await sql`
        SELECT m.*, t.name AS template_name, l.name AS lead_name,
               a.name AS account_name, c.name AS contact_name, d.name AS deal_name,
               COUNT(*) OVER() AS __total_count
        FROM outbound_messages m
        LEFT JOIN email_templates t ON t.id = m.template_id AND t.workspace_id = m.workspace_id
        LEFT JOIN leads l ON l.id = m.lead_id AND l.workspace_id = m.workspace_id
        LEFT JOIN accounts a ON a.id = m.account_id AND a.workspace_id = m.workspace_id
        LEFT JOIN contacts c ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
        LEFT JOIN deals d ON d.id = m.deal_id AND d.workspace_id = m.workspace_id
        WHERE m.workspace_id = ${workspace.id}
          AND (${status}::text IS NULL OR m.status = ${status})
          AND (${search}::text IS NULL OR m.subject ILIKE ${search ? `%${search}%` : null}
            OR m.recipient ILIKE ${search ? `%${search}%` : null}
            OR m.body_text ILIKE ${search ? `%${search}%` : null})
          AND (${leadId}::uuid IS NULL OR m.lead_id = ${leadId})
          AND (${accountId}::uuid IS NULL OR m.account_id = ${accountId})
          AND (${contactId}::uuid IS NULL OR m.contact_id = ${contactId})
          AND (${dealId}::uuid IS NULL OR m.deal_id = ${dealId})
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data.map(mapMessage), pagination, result.total));
    }

    let input = validateOutboundMessage(req.body);
    let retry = null;
    if (input.retry_of_id) {
      const retryRows = await sql`
        SELECT * FROM outbound_messages
        WHERE id = ${input.retry_of_id} AND workspace_id = ${workspace.id}
      `;
      retry = retryRows[0];
      if (!retry) throw new HttpError(404, 'not_found', 'Message to retry was not found.');
      if (retry.status !== 'failed') throw new HttpError(409, 'message_not_retryable', 'Only failed messages can be retried.');
      input = cloneRetry(input.idempotency_key, retry);
    }

    const existingRows = await sql`
      SELECT * FROM outbound_messages
      WHERE workspace_id = ${workspace.id} AND idempotency_key = ${input.idempotency_key}
    `;
    if (existingRows[0]) return json(res, 200, { data: mapMessage(existingRows[0]) });

    await assertReferences(sql, workspace.id, input);
    const provider = createEmailProvider();
    const providerIdempotencyKey = retry
      ? retry.provider_idempotency_key
      : `crm-${workspace.id}-${input.idempotency_key}`;
    const insertedRows = await sql`
      INSERT INTO outbound_messages (
        workspace_id, provider, idempotency_key, provider_idempotency_key, retry_of_id, template_id,
        lead_id, account_id, contact_id, deal_id, from_address, recipient,
        subject, body_text, body_html, status, attempt_count, attempted_by, request_id
      ) VALUES (
        ${workspace.id}, ${provider.name}, ${input.idempotency_key}, ${providerIdempotencyKey}, ${input.retry_of_id ?? null},
        ${input.template_id ?? null}, ${input.lead_id ?? null}, ${input.account_id ?? null},
        ${input.contact_id ?? null}, ${input.deal_id ?? null}, ${provider.fromAddress || 'not-configured'},
        ${input.recipient}, ${input.subject}, ${input.body_text}, ${input.body_html ?? null}, 'queued',
        ${retry ? Number(retry.attempt_count) + 1 : 1}, ${userId}, ${requestId}
      )
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING *
    `;
    if (!insertedRows[0]) {
      const concurrentRows = await sql`
        SELECT * FROM outbound_messages
        WHERE workspace_id = ${workspace.id} AND idempotency_key = ${input.idempotency_key}
      `;
      return json(res, 200, { data: mapMessage(concurrentRows[0]) });
    }
    const message = insertedRows[0];

    let delivery;
    try {
      delivery = await provider.send({
        recipient: input.recipient,
        subject: input.subject,
        bodyText: input.body_text,
        bodyHtml: input.body_html,
        idempotencyKey: providerIdempotencyKey,
      });
    } catch (error) {
      const reason = providerMessage(error);
      await sql.transaction([
        sql`
          UPDATE outbound_messages SET status = 'failed', failure_reason = ${reason},
            failed_at = NOW(), updated_at = NOW()
          WHERE id = ${message.id} AND workspace_id = ${workspace.id}
        `,
        sql`
          INSERT INTO notifications (
            workspace_id, recipient_user_id, type, title, body, entity_type, entity_id
          ) VALUES (
            ${workspace.id}, ${userId}, 'failed_sync', 'Email delivery failed',
            ${`${input.subject}: ${reason}`.slice(0, 1_000)}, 'outbound_message', ${message.id}
          )
        `,
      ]);
      const notConfigured = error?.code === 'provider_not_configured';
      throw new HttpError(
        notConfigured ? 503 : 502,
        notConfigured ? 'email_not_configured' : 'email_delivery_failed',
        notConfigured ? 'Email delivery is not configured.' : 'The email provider could not deliver the message.',
      );
    }

    const updatedRows = await sql`
      UPDATE outbound_messages SET status = ${delivery.status},
        provider_message_id = ${delivery.providerMessageId}, sent_at = NOW(), updated_at = NOW()
      WHERE id = ${message.id} AND workspace_id = ${workspace.id}
      RETURNING *
    `;
    const activityMessage = input.body_text.slice(0, 2_000);
    try {
      await sql`
        INSERT INTO activities (
          workspace_id, user_id, lead_id, account_id, contact_id, deal_id, type,
          subject, description, message, completed_at, priority, owner_user_id,
          outcome, created_by, timestamp, created_at, updated_at
        ) VALUES (
          ${workspace.id}, ${userId}, ${input.lead_id ?? null}, ${input.account_id ?? null},
          ${input.contact_id ?? null}, ${input.deal_id ?? null}, 'email', ${input.subject},
          ${activityMessage}, ${activityMessage}, NOW(), 'normal', ${userId},
          ${`Sent to ${input.recipient}`}, ${userId}, NOW(), NOW(), NOW()
        )
      `;
    } catch (timelineError) {
      console.error(JSON.stringify({
        level: 'error', event: 'email_timeline_logging_failed', requestId,
        messageId: message.id, error: timelineError instanceof Error ? timelineError.message : String(timelineError),
      }));
      await sql`
        INSERT INTO notifications (
          workspace_id, recipient_user_id, type, title, body, entity_type, entity_id
        ) VALUES (
          ${workspace.id}, ${userId}, 'failed_sync', 'Email timeline logging failed',
          'The email was sent, but its CRM timeline activity could not be created.',
          'outbound_message', ${message.id}
        )
      `;
    }
    return json(res, 202, { data: mapMessage(updatedRows[0]) });
  },
});

async function assertReferences(sql, workspaceId, input) {
  for (const [field, table, label] of TARGETS) {
    if (!input[field]) continue;
    const rows = await sql`
      SELECT id FROM ${sql.unsafe(table)}
      WHERE id = ${input[field]} AND workspace_id = ${workspaceId}
    `;
    if (!rows[0]) throw new HttpError(400, 'invalid_reference', `${label} does not exist in this workspace.`);
  }
  if (input.template_id) {
    const rows = await sql`
      SELECT id FROM email_templates
      WHERE id = ${input.template_id} AND workspace_id = ${workspaceId} AND is_active = true
    `;
    if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Email template does not exist or is inactive.');
  }
}

function cloneRetry(idempotencyKey, message) {
  return {
    idempotency_key: idempotencyKey,
    retry_of_id: message.id,
    template_id: message.template_id,
    lead_id: message.lead_id,
    account_id: message.account_id,
    contact_id: message.contact_id,
    deal_id: message.deal_id,
    recipient: message.recipient,
    subject: message.subject,
    body_text: message.body_text,
    body_html: message.body_html,
  };
}

function mapMessage(row) {
  if (!row) return row;
  const {
    lead_name: leadName,
    account_name: accountName,
    contact_name: contactName,
    deal_name: dealName,
    template_name: templateName,
    __total_count: _totalCount,
    ...message
  } = row;
  const target = message.lead_id
    ? { resource: 'lead', id: message.lead_id, name: leadName }
    : message.account_id
      ? { resource: 'account', id: message.account_id, name: accountName }
      : message.contact_id
        ? { resource: 'contact', id: message.contact_id, name: contactName }
        : { resource: 'deal', id: message.deal_id, name: dealName };
  return { ...message, templateName, target };
}
