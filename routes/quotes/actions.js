import { randomUUID } from 'node:crypto';

import { getDb } from '../../server/db.js';
import { financialAuditQuery, getInvoiceDetail, reserveDocumentNumber } from '../../server/financial-records.js';
import { HttpError, json, withApiRoute } from '../../server/http.js';
import { validateQuoteAction } from '../../server/validation.js';
import { getActiveWorkspace } from '../../server/workspaces.js';
import { getQuoteDetail, taxQueries } from '../quotes.js';

const TRANSITIONS = Object.freeze({
  send: { from: ['draft'], status: 'sent', timestamp: 'sent_at' },
  view: { from: ['sent'], status: 'viewed', timestamp: 'viewed_at' },
  accept: { from: ['sent', 'viewed'], status: 'accepted', timestamp: 'accepted_at' },
  reject: { from: ['sent', 'viewed'], status: 'rejected', timestamp: 'rejected_at' },
  cancel: { from: ['draft', 'sent', 'viewed'], status: 'cancelled', timestamp: 'cancelled_at' },
});

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId, requestId }) {
    const input = validateQuoteAction(req.body);
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const quote = await getQuoteDetail(sql, workspace.id, input.quote_id);

    if (input.action === 'revise') {
      const revision = await reviseQuote(sql, workspace, quote, userId, requestId);
      return json(res, 201, { data: revision });
    }
    if (input.action === 'convert_to_invoice') {
      const invoice = await convertQuoteToInvoice(sql, workspace, quote, input, userId, requestId);
      return json(res, 201, { data: invoice });
    }

    const transition = TRANSITIONS[input.action];
    if (!transition || !transition.from.includes(quote.status)) {
      throw new HttpError(409, 'invalid_quote_transition', `Quote ${quote.quote_number} cannot transition from ${quote.status} using ${input.action}.`);
    }
    const rows = await sql.transaction([
      sql`
        UPDATE quotes
        SET status = ${transition.status},
            ${sql.unsafe(transition.timestamp)} = NOW(),
            updated_by = ${userId}, updated_at = NOW(),
            notes = CASE WHEN ${input.action === 'reject' && input.reason ? input.reason : null}::text IS NOT NULL
              THEN concat_ws(E'\n', notes, ${input.action === 'reject' ? `Rejected: ${input.reason}` : null})
              ELSE notes END
        WHERE id = ${quote.id} AND workspace_id = ${workspace.id} AND status = ${quote.status}
        RETURNING id
      `,
      financialAuditQuery(sql, {
        workspaceId: workspace.id,
        actorUserId: userId,
        action: `quote.${input.action}`,
        entityType: 'quote',
        entityId: quote.id,
        beforeState: { status: quote.status },
        afterState: { status: transition.status, reason: input.reason || null },
        requestId,
      }),
    ]);
    if (!rows[0][0]) throw new HttpError(409, 'quote_conflict', 'The quote changed before this action could be applied.');
    return json(res, 200, { data: await getQuoteDetail(sql, workspace.id, quote.id) });
  },
});

async function reviseQuote(sql, workspace, quote, userId, requestId) {
  if (quote.status === 'draft') {
    throw new HttpError(409, 'invalid_quote_transition', 'Edit the current draft instead of creating a revision.');
  }
  const revisionId = randomUUID();
  const nextVersion = Number(quote.version) + 1;
  const queries = [
    sql`
      INSERT INTO quotes (
        id, workspace_id, deal_id, account_id, contact_id, quote_number, version,
        status, issue_date, expiry_date, currency, discount_type, discount_value,
        discount_amount, subtotal, tax_amount, total_amount, notes, terms,
        revision_of_quote_id, created_by, updated_by
      ) VALUES (
        ${revisionId}, ${workspace.id}, ${quote.deal_id}, ${quote.account_id}, ${quote.contact_id},
        ${quote.quote_number}, ${nextVersion}, 'draft', CURRENT_DATE, ${quote.expiry_date},
        ${quote.currency}, ${quote.discount_type}, ${quote.discount_value},
        ${quote.discount_amount}, ${quote.subtotal}, ${quote.tax_amount}, ${quote.total_amount},
        ${quote.notes}, ${quote.terms}, ${quote.id}, ${userId}, ${userId}
      ) RETURNING id
    `,
    ...quote.items.map((item, position) => sql`
      INSERT INTO quote_items (workspace_id, quote_id, position, description, quantity, unit_price, amount)
      VALUES (${workspace.id}, ${revisionId}, ${position}, ${item.description}, ${item.quantity}, ${item.unit_price}, ${item.amount})
    `),
    ...taxQueries(sql, workspace.id, 'quote_id', revisionId, quote.tax_components),
    financialAuditQuery(sql, {
      workspaceId: workspace.id,
      actorUserId: userId,
      action: 'quote.revised',
      entityType: 'quote',
      entityId: revisionId,
      beforeState: { source_quote_id: quote.id, source_version: quote.version },
      afterState: { quote_number: quote.quote_number, version: nextVersion, status: 'draft' },
      requestId,
    }),
  ];
  await sql.transaction(queries);
  return getQuoteDetail(sql, workspace.id, revisionId);
}

async function convertQuoteToInvoice(sql, workspace, quote, input, userId, requestId) {
  if (quote.status !== 'accepted') {
    throw new HttpError(409, 'invalid_quote_transition', 'Only an accepted quote can be converted to an invoice.');
  }
  const existing = await sql`SELECT id FROM invoices WHERE quote_id = ${quote.id} AND workspace_id = ${workspace.id}`;
  if (existing[0]) return getInvoiceDetail(sql, workspace.id, existing[0].id);
  const customer = await sql`SELECT id FROM customers WHERE id = ${input.customer_id} AND workspace_id = ${workspace.id}`;
  if (!customer[0]) throw new HttpError(400, 'invalid_reference', 'Customer does not exist in this workspace.');
  if (input.due_date < new Date().toISOString().slice(0, 10)) {
    throw new HttpError(400, 'validation_error', 'Invoice due date cannot be in the past.');
  }
  const invoiceId = randomUUID();
  const invoiceNumber = await reserveDocumentNumber(sql, workspace.id, 'invoice');
  const items = quote.items.map(item => ({
    description: item.description,
    quantity: Number(item.quantity),
    rate: Number(item.unit_price),
    amount: Number(item.amount),
  }));
  await sql.transaction([
    sql`
      INSERT INTO invoices (
        id, workspace_id, user_id, customer_id, deal_id, quote_id, invoice_number,
        invoice_date, due_date, status, currency, items, notes, terms, subtotal,
        tax_mode, tax_rate, tax_amount, discount_type, discount_value,
        discount_amount, total_amount, amount_paid, credited_amount, balance_due,
        created_by, updated_by
      ) VALUES (
        ${invoiceId}, ${workspace.id}, ${userId}, ${input.customer_id}, ${quote.deal_id},
        ${quote.id}, ${invoiceNumber}, CURRENT_DATE, ${input.due_date}, 'draft',
        ${quote.currency}, ${JSON.stringify(items)}::jsonb, ${quote.notes},
        ${workspace.default_invoice_terms ?? quote.terms}, ${quote.subtotal},
        ${quote.tax_components.length && quote.tax_components.every(item => item.inclusive)
          ? 'inclusive'
          : quote.tax_components.some(item => item.inclusive) ? 'mixed' : 'exclusive'},
        ${quote.tax_components.reduce((sum, item) => sum + Number(item.rate), 0)},
        ${quote.tax_amount}, ${quote.discount_type}, ${quote.discount_value},
        ${quote.discount_amount}, ${quote.total_amount}, 0, 0, ${quote.total_amount},
        ${userId}, ${userId}
      ) RETURNING id
    `,
    ...taxQueries(sql, workspace.id, 'invoice_id', invoiceId, quote.tax_components),
    financialAuditQuery(sql, {
      workspaceId: workspace.id,
      actorUserId: userId,
      action: 'invoice.created_from_quote',
      entityType: 'invoice',
      entityId: invoiceId,
      afterState: { invoice_number: invoiceNumber, quote_id: quote.id, quote_version: quote.version, total_amount: Number(quote.total_amount), currency: quote.currency },
      requestId,
    }),
  ]);
  return getInvoiceDetail(sql, workspace.id, invoiceId);
}
