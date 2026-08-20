import { randomUUID } from 'node:crypto';

import { getDb } from '../server/db.js';
import { calculateDocumentTotals } from '../server/financial.js';
import { financialAuditQuery, reserveDocumentNumber } from '../server/financial-records.js';
import {
  getPagination,
  getQueryEnum,
  getQueryString,
  getQueryUuid,
  getRequiredId,
  HttpError,
  json,
  noContent,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { QUOTE_STATUSES, validateQuote } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      if (req.query?.id) {
        return json(res, 200, { data: await getQuoteDetail(sql, workspace.id, getRequiredId(req.query)) });
      }
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search');
      const status = getQueryEnum(req.query, 'status', QUOTE_STATUSES);
      const dealId = getQueryUuid(req.query, 'deal_id');
      const currency = getQueryString(req.query, 'currency', 3)?.toUpperCase() || null;
      const rows = await sql`
        SELECT q.id, q.deal_id, q.account_id, q.contact_id, q.quote_number, q.version,
               q.status, q.issue_date, q.expiry_date, q.currency, q.subtotal,
               q.discount_type, q.discount_value, q.discount_amount, q.tax_amount,
               q.total_amount, q.sent_at, q.viewed_at, q.accepted_at, q.rejected_at,
               q.created_at, q.updated_at, d.name AS deal_name, a.name AS account_name,
               c.name AS contact_name, COUNT(*) OVER() AS __total_count
        FROM quotes q
        LEFT JOIN deals d ON d.id = q.deal_id AND d.workspace_id = q.workspace_id
        LEFT JOIN accounts a ON a.id = q.account_id AND a.workspace_id = q.workspace_id
        LEFT JOIN contacts c ON c.id = q.contact_id AND c.workspace_id = q.workspace_id
        WHERE q.workspace_id = ${workspace.id}
          AND (${search}::text IS NULL OR q.quote_number ILIKE ${search ? `%${search}%` : null} OR d.name ILIKE ${search ? `%${search}%` : null} OR a.name ILIKE ${search ? `%${search}%` : null} OR c.name ILIKE ${search ? `%${search}%` : null})
          AND (${status}::text IS NULL OR q.status = ${status})
          AND (${dealId}::uuid IS NULL OR q.deal_id = ${dealId})
          AND (${currency}::text IS NULL OR q.currency = ${currency})
        ORDER BY q.updated_at DESC, q.id DESC
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateQuote(req.body);
      if (!input.deal_id) throw new HttpError(400, 'invalid_reference', 'A quote must be linked to a deal.');
      const deal = await getQuoteDeal(sql, workspace.id, input.deal_id);
      const quoteId = randomUUID();
      const quoteNumber = await reserveDocumentNumber(sql, workspace.id, 'quote');
      const totals = calculateDocumentTotals({
        items: input.items,
        discountType: input.discount_type,
        discountValue: input.discount_value,
        taxComponents: input.tax_components || [],
      });
      const currency = input.currency || deal.currency || workspace.base_currency;
      const queries = [
        sql`
          INSERT INTO quotes (
            id, workspace_id, deal_id, account_id, contact_id, quote_number, version,
            status, issue_date, expiry_date, currency, discount_type, discount_value,
            discount_amount, subtotal, tax_amount, total_amount, notes, terms,
            created_by, updated_by
          ) VALUES (
            ${quoteId}, ${workspace.id}, ${deal.id}, ${input.account_id ?? deal.account_id},
            ${input.contact_id ?? deal.primary_contact_id}, ${quoteNumber}, 1, 'draft',
            ${input.issue_date}, ${input.expiry_date ?? null}, ${currency},
            ${totals.discount_type}, ${totals.discount_value}, ${totals.discount_amount},
            ${totals.subtotal}, ${totals.tax_amount}, ${totals.total_amount},
            ${input.notes ?? null}, ${input.terms ?? workspace.default_quote_terms ?? null},
            ${userId}, ${userId}
          ) RETURNING id
        `,
        ...quoteItemQueries(sql, workspace.id, quoteId, totals.items),
        ...taxQueries(sql, workspace.id, 'quote_id', quoteId, totals.tax_components),
        financialAuditQuery(sql, {
          workspaceId: workspace.id,
          actorUserId: userId,
          action: 'quote.created',
          entityType: 'quote',
          entityId: quoteId,
          afterState: { quote_number: quoteNumber, version: 1, status: 'draft', currency, total_amount: totals.total_amount },
          requestId,
        }),
      ];
      await sql.transaction(queries);
      return json(res, 201, { data: await getQuoteDetail(sql, workspace.id, quoteId) });
    }

    const quoteId = getRequiredId(req.query);
    const existing = await getQuoteDetail(sql, workspace.id, quoteId);
    if (req.method === 'PUT') {
      if (existing.status !== 'draft' || existing.sent_at) {
        throw new HttpError(409, 'financial_record_protected', 'Only unsent draft quotes can be edited. Create a revision instead.');
      }
      const input = validateQuote(req.body, { partial: true });
      const merged = {
        ...existing,
        ...input,
        items: input.items || existing.items,
        tax_components: input.tax_components || existing.tax_components,
      };
      if (merged.expiry_date && merged.expiry_date < merged.issue_date) {
        throw new HttpError(400, 'validation_error', 'Request validation failed.', [{ field: 'expiry_date', message: 'must be on or after issue_date' }]);
      }
      if (input.deal_id) await getQuoteDeal(sql, workspace.id, input.deal_id);
      const totals = calculateDocumentTotals({
        items: merged.items,
        discountType: merged.discount_type,
        discountValue: merged.discount_value,
        taxComponents: merged.tax_components,
      });
      const queries = [
        sql`
          UPDATE quotes SET
            deal_id = ${merged.deal_id}, account_id = ${merged.account_id ?? null},
            contact_id = ${merged.contact_id ?? null}, issue_date = ${merged.issue_date},
            expiry_date = ${merged.expiry_date ?? null}, currency = ${merged.currency},
            discount_type = ${totals.discount_type}, discount_value = ${totals.discount_value},
            discount_amount = ${totals.discount_amount}, subtotal = ${totals.subtotal},
            tax_amount = ${totals.tax_amount}, total_amount = ${totals.total_amount},
            notes = ${merged.notes ?? null}, terms = ${merged.terms ?? null},
            updated_by = ${userId}, updated_at = NOW()
          WHERE id = ${quoteId} AND workspace_id = ${workspace.id} AND status = 'draft'
          RETURNING id
        `,
        sql`DELETE FROM quote_items WHERE quote_id = ${quoteId} AND workspace_id = ${workspace.id}`,
        sql`DELETE FROM tax_components WHERE quote_id = ${quoteId} AND workspace_id = ${workspace.id}`,
        ...quoteItemQueries(sql, workspace.id, quoteId, totals.items),
        ...taxQueries(sql, workspace.id, 'quote_id', quoteId, totals.tax_components),
        financialAuditQuery(sql, {
          workspaceId: workspace.id,
          actorUserId: userId,
          action: 'quote.updated',
          entityType: 'quote',
          entityId: quoteId,
          beforeState: quoteAuditState(existing),
          afterState: { ...quoteAuditState(existing), currency: merged.currency, total_amount: totals.total_amount },
          requestId,
        }),
      ];
      await sql.transaction(queries);
      return json(res, 200, { data: await getQuoteDetail(sql, workspace.id, quoteId) });
    }

    if (existing.status !== 'draft' || existing.sent_at) {
      throw new HttpError(409, 'financial_record_protected', 'Only unsent draft quotes can be deleted. Cancel the quote instead.');
    }
    const linkedInvoices = await sql`SELECT id FROM invoices WHERE quote_id = ${quoteId} AND workspace_id = ${workspace.id} LIMIT 1`;
    if (linkedInvoices[0]) throw new HttpError(409, 'financial_record_protected', 'A quote linked to an invoice cannot be deleted.');
    await sql.transaction([
      financialAuditQuery(sql, {
        workspaceId: workspace.id,
        actorUserId: userId,
        action: 'quote.deleted',
        entityType: 'quote',
        entityId: quoteId,
        beforeState: quoteAuditState(existing),
        requestId,
      }),
      sql`DELETE FROM quotes WHERE id = ${quoteId} AND workspace_id = ${workspace.id}`,
    ]);
    return noContent(res);
  },
});

export async function getQuoteDetail(sql, workspaceId, quoteId) {
  const rows = await sql`
    SELECT q.*, d.name AS deal_name, a.name AS account_name,
           c.name AS contact_name, c.email AS contact_email,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', qi.id, 'description', qi.description, 'quantity', qi.quantity,
             'unit_price', qi.unit_price, 'amount', qi.amount, 'position', qi.position
           ) ORDER BY qi.position, qi.id) FROM quote_items qi
             WHERE qi.quote_id = q.id AND qi.workspace_id = q.workspace_id), '[]'::jsonb) AS items,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', tc.id, 'name', tc.name, 'rate', tc.rate, 'amount', tc.amount,
             'inclusive', tc.inclusive, 'position', tc.position
           ) ORDER BY tc.position, tc.id) FROM tax_components tc
             WHERE tc.quote_id = q.id AND tc.workspace_id = q.workspace_id), '[]'::jsonb) AS tax_components,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', delivery.id, 'recipient', delivery.recipient, 'provider', delivery.provider,
             'provider_message_id', delivery.provider_message_id, 'status', delivery.status,
             'sent_at', delivery.sent_at, 'failed_at', delivery.failed_at,
             'failure_reason', delivery.failure_reason, 'created_at', delivery.created_at
           ) ORDER BY delivery.created_at DESC, delivery.id DESC) FROM invoice_deliveries delivery
             WHERE delivery.quote_id = q.id AND delivery.workspace_id = q.workspace_id), '[]'::jsonb) AS deliveries
    FROM quotes q
    LEFT JOIN deals d ON d.id = q.deal_id AND d.workspace_id = q.workspace_id
    LEFT JOIN accounts a ON a.id = q.account_id AND a.workspace_id = q.workspace_id
    LEFT JOIN contacts c ON c.id = q.contact_id AND c.workspace_id = q.workspace_id
    WHERE q.id = ${quoteId} AND q.workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Quote not found.');
  return rows[0];
}

function quoteItemQueries(sql, workspaceId, quoteId, items) {
  return items.map((item, position) => sql`
    INSERT INTO quote_items (
      workspace_id, quote_id, position, description, quantity, unit_price, amount
    ) VALUES (
      ${workspaceId}, ${quoteId}, ${position}, ${item.description},
      ${item.quantity}, ${item.unit_price}, ${item.amount}
    )
  `);
}

export function taxQueries(sql, workspaceId, targetColumn, targetId, components) {
  return components.map((component, position) => sql`
    INSERT INTO tax_components (
      workspace_id, ${sql.unsafe(targetColumn)}, name, rate, amount, inclusive, position
    ) VALUES (
      ${workspaceId}, ${targetId}, ${component.name}, ${component.rate},
      ${component.amount}, ${component.inclusive}, ${position}
    )
  `);
}

async function getQuoteDeal(sql, workspaceId, dealId) {
  const rows = await sql`
    SELECT id, account_id, primary_contact_id, currency
    FROM deals WHERE id = ${dealId} AND workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Deal does not exist in this workspace.');
  return rows[0];
}

function quoteAuditState(quote) {
  return {
    quote_number: quote.quote_number,
    version: quote.version,
    status: quote.status,
    currency: quote.currency,
    total_amount: Number(quote.total_amount),
  };
}
