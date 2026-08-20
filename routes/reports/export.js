import { getDb } from '../../server/db.js';
import { getQueryDate, getQueryEnum, getQueryInteger, getQueryString, getQueryUuid, HttpError, json, withApiRoute } from '../../server/http.js';
import { getExplicitReportWindow, getReportWindow } from '../../server/reporting.js';
import { getActiveWorkspace } from '../../server/workspaces.js';

const EXPORT_LIMIT = 10_000;

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const window = parseWindow(req.query);
    const currency = (getQueryString(req.query, 'currency', 3) || workspace.base_currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'invalid_query', 'currency must be an ISO 4217 three-letter code.');
    const owner = getQueryString(req.query, 'owner', 256);
    const ownerUserId = owner === 'me' ? userId : owner;
    const pipelineId = getQueryUuid(req.query, 'pipeline_id');
    const source = getQueryString(req.query, 'source', 80);
    const recordType = getQueryEnum(req.query, 'record_type', ['all', 'deal', 'payment', 'activity']) || 'all';

    const [deals, payments, activities] = await Promise.all([
      ['all', 'deal'].includes(recordType) ? sql`
        SELECT 'deal' AS record_type, d.id AS record_id, d.name AS subject,
               d.status, d.currency, d.amount, d.probability, d.forecast_category,
               d.owner_user_id, d.lead_source AS source, p.name AS pipeline,
               s.name AS stage, d.created_at::date AS created_date,
               COALESCE(d.actual_close_date, (
                 SELECT MAX(h.changed_at)::date FROM deal_stage_history h
                 JOIN pipeline_stages closed_stage ON closed_stage.id = h.to_stage_id
                   AND closed_stage.pipeline_id = h.pipeline_id AND closed_stage.workspace_id = h.workspace_id
                 WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id
                   AND (closed_stage.is_closed_won OR closed_stage.is_closed_lost)
               )) AS event_date,
               NULL::numeric AS payment_amount, NULL::text AS activity_type
        FROM deals d
        JOIN pipelines p ON p.id = d.pipeline_id AND p.workspace_id = d.workspace_id
        JOIN pipeline_stages s ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id AND s.workspace_id = d.workspace_id
        WHERE d.workspace_id = ${workspace.id} AND d.currency = ${currency}
          AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
          AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
          AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
          AND (d.status = 'open' OR (
            COALESCE(d.actual_close_date, (
              SELECT MAX(h.changed_at)::date FROM deal_stage_history h
              JOIN pipeline_stages closed_stage ON closed_stage.id = h.to_stage_id
                AND closed_stage.pipeline_id = h.pipeline_id AND closed_stage.workspace_id = h.workspace_id
              WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id
                AND (closed_stage.is_closed_won OR closed_stage.is_closed_lost)
            )) >= ${window.startDate}::date
            AND COALESCE(d.actual_close_date, (
              SELECT MAX(h.changed_at)::date FROM deal_stage_history h
              JOIN pipeline_stages closed_stage ON closed_stage.id = h.to_stage_id
                AND closed_stage.pipeline_id = h.pipeline_id AND closed_stage.workspace_id = h.workspace_id
              WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id
                AND (closed_stage.is_closed_won OR closed_stage.is_closed_lost)
            )) < ${window.endDateExclusive}::date
          ))
        ORDER BY d.updated_at DESC, d.id DESC LIMIT ${EXPORT_LIMIT}
      ` : [],
      ['all', 'payment'].includes(recordType) ? sql`
        SELECT 'payment' AS record_type, pay.id AS record_id,
               i.invoice_number AS subject, pay.status, pay.currency,
               NULL::numeric AS amount, NULL::numeric AS probability,
               NULL::text AS forecast_category, d.owner_user_id,
               d.lead_source AS source, pipeline.name AS pipeline,
               stage.name AS stage, pay.created_at::date AS created_date,
               pay.payment_date AS event_date, pay.amount AS payment_amount,
               NULL::text AS activity_type
        FROM payments pay
        JOIN invoices i ON i.id = pay.invoice_id AND i.workspace_id = pay.workspace_id
        LEFT JOIN deals d ON d.id = i.deal_id AND d.workspace_id = i.workspace_id
        LEFT JOIN pipelines pipeline ON pipeline.id = d.pipeline_id AND pipeline.workspace_id = d.workspace_id
        LEFT JOIN pipeline_stages stage ON stage.id = d.stage_id AND stage.pipeline_id = d.pipeline_id AND stage.workspace_id = d.workspace_id
        WHERE pay.workspace_id = ${workspace.id} AND pay.currency = ${currency}
          AND pay.payment_date >= ${window.startDate}::date AND pay.payment_date < ${window.endDateExclusive}::date
          AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
          AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
          AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        ORDER BY pay.payment_date DESC, pay.id DESC LIMIT ${EXPORT_LIMIT}
      ` : [],
      ['all', 'activity'].includes(recordType) ? sql`
        SELECT 'activity' AS record_type, a.id AS record_id, a.subject,
               CASE WHEN a.completed_at IS NULL THEN 'open' ELSE 'completed' END AS status,
               ${currency}::text AS currency, NULL::numeric AS amount,
               NULL::numeric AS probability, NULL::text AS forecast_category,
               a.owner_user_id, d.lead_source AS source, pipeline.name AS pipeline,
               stage.name AS stage, a.created_at::date AS created_date,
               COALESCE(a.completed_at, a.due_at, a.created_at)::date AS event_date,
               NULL::numeric AS payment_amount, a.type AS activity_type
        FROM activities a
        LEFT JOIN deals d ON d.id = a.deal_id AND d.workspace_id = a.workspace_id
        LEFT JOIN pipelines pipeline ON pipeline.id = d.pipeline_id AND pipeline.workspace_id = d.workspace_id
        LEFT JOIN pipeline_stages stage ON stage.id = d.stage_id AND stage.pipeline_id = d.pipeline_id AND stage.workspace_id = d.workspace_id
        WHERE a.workspace_id = ${workspace.id}
          AND (a.created_at >= ${window.startDate}::date AND a.created_at < ${window.endDateExclusive}::date
            OR a.completed_at >= ${window.startDate}::date AND a.completed_at < ${window.endDateExclusive}::date)
          AND (${ownerUserId}::text IS NULL OR a.owner_user_id = ${ownerUserId})
          AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
          AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        ORDER BY a.updated_at DESC, a.id DESC LIMIT ${EXPORT_LIMIT}
      ` : [],
    ]);

    const rows = [...deals, ...payments, ...activities].map(row => ({
      recordType: row.record_type, recordId: row.record_id, subject: row.subject,
      status: row.status, currency: row.currency, amount: numberOrNull(row.amount),
      paymentAmount: numberOrNull(row.payment_amount), probability: numberOrNull(row.probability),
      forecastCategory: row.forecast_category, ownerUserId: row.owner_user_id,
      source: row.source, pipeline: row.pipeline, stage: row.stage,
      activityType: row.activity_type, createdDate: row.created_date ? String(row.created_date) : null,
      eventDate: row.event_date ? String(row.event_date) : null,
    }));
    return json(res, 200, { data: {
      generatedAt: new Date().toISOString(),
      columns: ['recordType', 'recordId', 'subject', 'status', 'currency', 'amount', 'paymentAmount', 'probability', 'forecastCategory', 'ownerUserId', 'source', 'pipeline', 'stage', 'activityType', 'createdDate', 'eventDate'],
      filters: { ...window, currency, owner: owner || null, pipelineId, source, recordType },
      rows,
      truncated: deals.length === EXPORT_LIMIT || payments.length === EXPORT_LIMIT || activities.length === EXPORT_LIMIT,
    } });
  },
});

function parseWindow(query) {
  const startDate = getQueryDate(query, 'startDate');
  const endDate = getQueryDate(query, 'endDate');
  if (Boolean(startDate) !== Boolean(endDate)) throw new HttpError(400, 'invalid_query', 'startDate and endDate must be provided together.');
  try {
    return startDate && endDate ? getExplicitReportWindow(startDate, endDate) : getReportWindow(getQueryInteger(query, 'rangeDays', 30, 1, 3_650));
  } catch (error) {
    throw new HttpError(400, 'invalid_query', error.message);
  }
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}
