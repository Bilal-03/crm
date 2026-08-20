import { getDb } from '../server/db.js';
import {
  getQueryDate,
  getQueryInteger,
  getQueryString,
  getQueryUuid,
  HttpError,
  json,
  withApiRoute,
} from '../server/http.js';
import { getExplicitReportWindow, getReportWindow, REPORT_DEFINITIONS } from '../server/reporting.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const filters = parseFilters(req.query, userId, workspace.base_currency);
    const window = reportWindow(req.query);
    const { currency, ownerUserId, pipelineId, source } = filters;

    const [summaryRows, currencyRows, stageRows, sourceRows, ownerRows, activityRows, invoiceRows, trendRows] = await Promise.all([
      sql`
        WITH deal_events AS (
          SELECT d.*,
                 COALESCE(d.actual_close_date, (
                   SELECT MAX(h.changed_at)::date
                   FROM deal_stage_history h
                   JOIN pipeline_stages closed_stage
                     ON closed_stage.id = h.to_stage_id
                    AND closed_stage.pipeline_id = h.pipeline_id
                    AND closed_stage.workspace_id = h.workspace_id
                   WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id
                     AND (closed_stage.is_closed_won OR closed_stage.is_closed_lost)
                 )) AS effective_close_date
          FROM deals d
          WHERE d.workspace_id = ${workspace.id}
            AND d.currency = ${currency}
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        )
        SELECT
          COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
          COALESCE(SUM(amount) FILTER (WHERE status = 'open'), 0)::numeric AS open_pipeline,
          COALESCE(SUM(amount * probability / 100) FILTER (WHERE status = 'open'), 0)::numeric AS weighted_pipeline,
          COALESCE(SUM(amount) FILTER (WHERE status = 'open' AND forecast_category IN ('best_case', 'commit')), 0)::numeric AS best_case,
          COALESCE(SUM(amount) FILTER (WHERE status = 'open' AND forecast_category = 'commit'), 0)::numeric AS commit,
          COUNT(*) FILTER (WHERE status = 'won' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date)::int AS won_count,
          COUNT(*) FILTER (WHERE status = 'lost' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date)::int AS lost_count,
          COALESCE(SUM(amount) FILTER (WHERE status = 'won' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS won_amount,
          COALESCE(SUM(amount) FILTER (WHERE status = 'lost' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS lost_amount,
          COALESCE(AVG(amount) FILTER (WHERE status = 'won' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS average_deal_size,
          COALESCE(AVG(effective_close_date - created_at::date) FILTER (WHERE status IN ('won', 'lost') AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS average_cycle_days
        FROM deal_events
      `,
      sql`
        WITH currencies AS (
          SELECT ${workspace.base_currency}::text AS currency
          UNION
          SELECT currency FROM deals WHERE workspace_id = ${workspace.id}
          UNION
          SELECT currency FROM invoices WHERE workspace_id = ${workspace.id}
        ), deal_events AS (
          SELECT d.*,
                 COALESCE(d.actual_close_date, (
                   SELECT MAX(h.changed_at)::date FROM deal_stage_history h
                   JOIN pipeline_stages s ON s.id = h.to_stage_id AND s.pipeline_id = h.pipeline_id AND s.workspace_id = h.workspace_id
                   WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id AND (s.is_closed_won OR s.is_closed_lost)
                 )) AS effective_close_date
          FROM deals d
          WHERE d.workspace_id = ${workspace.id}
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        ), aggregate_by_currency AS (
          SELECT currency,
               COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
               COALESCE(SUM(amount) FILTER (WHERE status = 'open'), 0)::numeric AS open_pipeline,
               COALESCE(SUM(amount * probability / 100) FILTER (WHERE status = 'open'), 0)::numeric AS weighted_pipeline,
               COALESCE(SUM(amount) FILTER (WHERE status = 'won' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS won_amount,
               COALESCE(SUM(amount) FILTER (WHERE status = 'lost' AND effective_close_date >= ${window.startDate}::date AND effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS lost_amount
          FROM deal_events GROUP BY currency
        )
        SELECT currencies.currency, COALESCE(aggregate_by_currency.open_count, 0)::int AS open_count,
               COALESCE(aggregate_by_currency.open_pipeline, 0)::numeric AS open_pipeline,
               COALESCE(aggregate_by_currency.weighted_pipeline, 0)::numeric AS weighted_pipeline,
               COALESCE(aggregate_by_currency.won_amount, 0)::numeric AS won_amount,
               COALESCE(aggregate_by_currency.lost_amount, 0)::numeric AS lost_amount
        FROM currencies LEFT JOIN aggregate_by_currency USING (currency)
        ORDER BY currencies.currency
      `,
      sql`
        WITH entered AS (
          SELECT h.deal_id, h.to_stage_id AS stage_id, MIN(h.changed_at) AS entered_at
          FROM deal_stage_history h
          JOIN deals d ON d.id = h.deal_id AND d.workspace_id = h.workspace_id
          WHERE h.workspace_id = ${workspace.id} AND d.currency = ${currency}
            AND h.changed_at >= ${window.startDate}::date AND h.changed_at < ${window.endDateExclusive}::date
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
          GROUP BY h.deal_id, h.to_stage_id
        ), conversion AS (
          SELECT e.stage_id, COUNT(*)::int AS entered_count,
                 COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM deal_stage_history exit_event
                   WHERE exit_event.workspace_id = ${workspace.id}
                     AND exit_event.deal_id = e.deal_id
                     AND exit_event.from_stage_id = e.stage_id
                     AND exit_event.changed_at > e.entered_at
                     AND exit_event.changed_at < ${window.endDateExclusive}::date
                 ))::int AS converted_count
          FROM entered e GROUP BY e.stage_id
        ), current_stage AS (
          SELECT d.stage_id, COUNT(*)::int AS current_count,
                 COALESCE(SUM(d.amount), 0)::numeric AS current_amount,
                 COALESCE(AVG(CURRENT_DATE - COALESCE((
                   SELECT MAX(h.changed_at)::date FROM deal_stage_history h
                   WHERE h.workspace_id = d.workspace_id AND h.deal_id = d.id AND h.to_stage_id = d.stage_id
                 ), d.created_at::date)), 0)::numeric AS average_age_days
          FROM deals d
          WHERE d.workspace_id = ${workspace.id} AND d.currency = ${currency} AND d.status = 'open'
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
          GROUP BY d.stage_id
        )
        SELECT s.id, s.pipeline_id, s.name, s.position,
               COALESCE(current_stage.current_count, 0)::int AS current_count,
               COALESCE(current_stage.current_amount, 0)::numeric AS current_amount,
               COALESCE(current_stage.average_age_days, 0)::numeric AS average_age_days,
               COALESCE(conversion.entered_count, 0)::int AS entered_count,
               COALESCE(conversion.converted_count, 0)::int AS converted_count
        FROM pipeline_stages s
        LEFT JOIN current_stage ON current_stage.stage_id = s.id
        LEFT JOIN conversion ON conversion.stage_id = s.id
        WHERE s.workspace_id = ${workspace.id} AND (${pipelineId}::uuid IS NULL OR s.pipeline_id = ${pipelineId})
        ORDER BY s.pipeline_id, s.position, s.id
      `,
      sql`
        WITH deal_events AS (
          SELECT d.*, COALESCE(d.lead_source, 'Unknown') AS source_name,
                 COALESCE(d.actual_close_date, (
                   SELECT MAX(h.changed_at)::date FROM deal_stage_history h
                   JOIN pipeline_stages s ON s.id = h.to_stage_id AND s.pipeline_id = h.pipeline_id AND s.workspace_id = h.workspace_id
                   WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id AND (s.is_closed_won OR s.is_closed_lost)
                 )) AS effective_close_date
          FROM deals d WHERE d.workspace_id = ${workspace.id} AND d.currency = ${currency}
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        ), collected AS (
          SELECT i.deal_id, COALESCE(SUM(p.amount), 0)::numeric AS amount
          FROM payments p JOIN invoices i ON i.id = p.invoice_id AND i.workspace_id = p.workspace_id
          WHERE p.workspace_id = ${workspace.id} AND p.status = 'settled' AND p.currency = ${currency}
            AND p.payment_date >= ${window.startDate}::date AND p.payment_date < ${window.endDateExclusive}::date
          GROUP BY i.deal_id
        )
        SELECT d.source_name AS source, COUNT(*)::int AS deals,
               COUNT(*) FILTER (WHERE d.status = 'won' AND d.effective_close_date >= ${window.startDate}::date AND d.effective_close_date < ${window.endDateExclusive}::date)::int AS won_deals,
               COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'won' AND d.effective_close_date >= ${window.startDate}::date AND d.effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS won_amount,
               COALESCE(SUM(collected.amount), 0)::numeric AS revenue_collected
        FROM deal_events d LEFT JOIN collected ON collected.deal_id = d.id
        GROUP BY d.source_name ORDER BY won_amount DESC, source ASC
      `,
      sql`
        WITH member_universe AS (
          SELECT m.user_id, m.email FROM workspace_members m
          WHERE m.workspace_id = ${workspace.id}
            AND (${ownerUserId}::text IS NULL OR m.user_id = ${ownerUserId})
        ), deal_events AS (
          SELECT d.*, COALESCE(d.actual_close_date, (
            SELECT MAX(h.changed_at)::date FROM deal_stage_history h
            JOIN pipeline_stages s ON s.id = h.to_stage_id AND s.pipeline_id = h.pipeline_id AND s.workspace_id = h.workspace_id
            WHERE h.deal_id = d.id AND h.workspace_id = d.workspace_id AND (s.is_closed_won OR s.is_closed_lost)
          )) AS effective_close_date
          FROM deals d WHERE d.workspace_id = ${workspace.id} AND d.currency = ${currency}
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        ), deal_performance AS (
          SELECT d.owner_user_id,
                 COUNT(*) FILTER (WHERE d.status = 'open')::int AS open_deals,
                 COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'open'), 0)::numeric AS open_pipeline,
                 COUNT(*) FILTER (WHERE d.status = 'won' AND d.effective_close_date >= ${window.startDate}::date AND d.effective_close_date < ${window.endDateExclusive}::date)::int AS won_deals,
                 COUNT(*) FILTER (WHERE d.status = 'lost' AND d.effective_close_date >= ${window.startDate}::date AND d.effective_close_date < ${window.endDateExclusive}::date)::int AS lost_deals,
                 COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'won' AND d.effective_close_date >= ${window.startDate}::date AND d.effective_close_date < ${window.endDateExclusive}::date), 0)::numeric AS won_amount
          FROM deal_events d GROUP BY d.owner_user_id
        ), activity_counts AS (
          SELECT a.owner_user_id,
                 COUNT(*) FILTER (WHERE a.created_at >= ${window.startDate}::date AND a.created_at < ${window.endDateExclusive}::date)::int AS created_count,
                 COUNT(*) FILTER (WHERE a.completed_at >= ${window.startDate}::date AND a.completed_at < ${window.endDateExclusive}::date)::int AS completed_count
          FROM activities a
          LEFT JOIN deals related_deal ON related_deal.id = a.deal_id AND related_deal.workspace_id = a.workspace_id
          WHERE a.workspace_id = ${workspace.id}
            AND (${pipelineId}::uuid IS NULL OR related_deal.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(related_deal.lead_source, 'Unknown') = ${source})
          GROUP BY a.owner_user_id
        )
        SELECT members.user_id AS owner_user_id, members.email AS owner_email,
               COALESCE(deals.open_deals, 0)::int AS open_deals,
               COALESCE(deals.open_pipeline, 0)::numeric AS open_pipeline,
               COALESCE(deals.won_deals, 0)::int AS won_deals,
               COALESCE(deals.lost_deals, 0)::int AS lost_deals,
               COALESCE(deals.won_amount, 0)::numeric AS won_amount,
               COALESCE(activity.created_count, 0)::int AS activities_created,
               COALESCE(activity.completed_count, 0)::int AS activities_completed
        FROM member_universe members
        LEFT JOIN deal_performance deals ON deals.owner_user_id = members.user_id
        LEFT JOIN activity_counts activity ON activity.owner_user_id = members.user_id
        ORDER BY won_amount DESC, members.user_id
      `,
      sql`
        SELECT COUNT(*) FILTER (WHERE a.created_at >= ${window.startDate}::date AND a.created_at < ${window.endDateExclusive}::date)::int AS created,
               COUNT(*) FILTER (WHERE a.completed_at >= ${window.startDate}::date AND a.completed_at < ${window.endDateExclusive}::date)::int AS completed,
               COUNT(*) FILTER (WHERE a.completed_at IS NULL AND a.due_at < NOW())::int AS currently_overdue
        FROM activities a
        LEFT JOIN deals d ON d.id = a.deal_id AND d.workspace_id = a.workspace_id
        WHERE a.workspace_id = ${workspace.id}
          AND (${ownerUserId}::text IS NULL OR a.owner_user_id = ${ownerUserId})
          AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
          AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
      `,
      sql`
        WITH invoice_scope AS (
          SELECT i.id, i.invoice_date, i.balance_due, i.status
          FROM invoices i
          LEFT JOIN deals d ON d.id = i.deal_id AND d.workspace_id = i.workspace_id
          WHERE i.workspace_id = ${workspace.id} AND i.currency = ${currency}
            AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
            AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
            AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        ), payment_scope AS (
          SELECT p.amount
          FROM payments p JOIN invoice_scope scoped ON scoped.id = p.invoice_id
          WHERE p.workspace_id = ${workspace.id} AND p.status = 'settled'
            AND p.payment_date >= ${window.startDate}::date AND p.payment_date < ${window.endDateExclusive}::date
        )
        SELECT (SELECT COUNT(*) FROM invoice_scope WHERE invoice_date >= ${window.startDate}::date AND invoice_date < ${window.endDateExclusive}::date)::int AS invoices_issued,
               COALESCE((SELECT SUM(amount) FROM payment_scope), 0)::numeric AS revenue_collected,
               COALESCE((SELECT SUM(balance_due) FROM invoice_scope WHERE status NOT IN ('paid', 'cancelled', 'void')), 0)::numeric AS outstanding
      `,
      sql`
        SELECT p.payment_date AS day, COALESCE(SUM(p.amount), 0)::numeric AS revenue
        FROM payments p
        JOIN invoices i ON i.id = p.invoice_id AND i.workspace_id = p.workspace_id
        LEFT JOIN deals d ON d.id = i.deal_id AND d.workspace_id = i.workspace_id
        WHERE p.workspace_id = ${workspace.id} AND p.currency = ${currency} AND p.status = 'settled'
          AND p.payment_date >= ${window.startDate}::date AND p.payment_date < ${window.endDateExclusive}::date
          AND (${ownerUserId}::text IS NULL OR d.owner_user_id = ${ownerUserId})
          AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
          AND (${source}::text IS NULL OR COALESCE(d.lead_source, 'Unknown') = ${source})
        GROUP BY p.payment_date ORDER BY p.payment_date
      `,
    ]);

    const summary = summaryRows[0] || {};
    const invoices = invoiceRows[0] || {};
    const wonCount = Number(summary.won_count || 0);
    const lostCount = Number(summary.lost_count || 0);
    const closedCount = wonCount + lostCount;
    const winRate = closedCount ? wonCount / closedCount * 100 : 0;
    const averageDealSize = Number(summary.average_deal_size || 0);
    const averageCycleDays = Number(summary.average_cycle_days || 0);
    const openCount = Number(summary.open_count || 0);

    return json(res, 200, { data: {
      period: window,
      filters: { currency, owner: filters.owner || null, pipelineId, source },
      availableCurrencies: currencyRows.map(row => row.currency),
      metrics: {
        openDeals: openCount,
        openPipeline: Number(summary.open_pipeline || 0),
        weightedPipeline: Number(summary.weighted_pipeline || 0),
        bestCase: Number(summary.best_case || 0),
        commit: Number(summary.commit || 0),
        dealsWon: wonCount,
        dealsLost: lostCount,
        wonAmount: Number(summary.won_amount || 0),
        lostAmount: Number(summary.lost_amount || 0),
        winRate,
        averageDealSize,
        averageCycleDays,
        salesVelocity: averageCycleDays > 0 ? openCount * (winRate / 100) * averageDealSize / averageCycleDays : 0,
        revenueCollected: Number(invoices.revenue_collected || 0),
        invoicesIssued: Number(invoices.invoices_issued || 0),
        outstanding: Number(invoices.outstanding || 0),
        activitiesCreated: Number(activityRows[0]?.created || 0),
        activitiesCompleted: Number(activityRows[0]?.completed || 0),
        activitiesOverdue: Number(activityRows[0]?.currently_overdue || 0),
      },
      currencyBreakdown: currencyRows.map(numericCurrencyRow),
      stagePerformance: stageRows.map(row => ({
        id: row.id, pipelineId: row.pipeline_id, name: row.name, position: Number(row.position),
        currentCount: Number(row.current_count), currentAmount: Number(row.current_amount),
        averageAgeDays: Number(row.average_age_days), enteredCount: Number(row.entered_count),
        convertedCount: Number(row.converted_count),
        conversionRate: Number(row.entered_count) ? Number(row.converted_count) / Number(row.entered_count) * 100 : 0,
      })),
      sourcePerformance: sourceRows.map(row => ({ source: row.source, deals: Number(row.deals), wonDeals: Number(row.won_deals), wonAmount: Number(row.won_amount), revenueCollected: Number(row.revenue_collected) })),
      ownerPerformance: ownerRows.map(row => ({ ownerUserId: row.owner_user_id, ownerEmail: row.owner_email, openDeals: Number(row.open_deals), openPipeline: Number(row.open_pipeline), wonDeals: Number(row.won_deals), lostDeals: Number(row.lost_deals), wonAmount: Number(row.won_amount), activitiesCreated: Number(row.activities_created), activitiesCompleted: Number(row.activities_completed) })),
      revenueTrend: trendRows.map(row => ({ date: String(row.day), revenue: Number(row.revenue) })),
      definitions: REPORT_DEFINITIONS,
      dateSemantics: {
        period: 'The start date is inclusive and the displayed end date is inclusive; the API stores an exclusive end boundary.',
        closedDeals: 'Deals are attributed to their actual_close_date, or the latest closed-stage history event for legacy records.',
        revenue: 'Revenue is attributed to settled payment_date, not invoice creation or invoice status.',
        pipeline: 'Pipeline values are a current snapshot and are not limited by the selected date period.',
      },
    } });
  },
});

function parseFilters(query, userId, baseCurrency) {
  const requestedCurrency = getQueryString(query, 'currency', 3);
  const currency = (requestedCurrency || baseCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'invalid_query', 'currency must be an ISO 4217 three-letter code.');
  const owner = getQueryString(query, 'owner', 256);
  return {
    currency,
    owner,
    ownerUserId: owner === 'me' ? userId : owner,
    pipelineId: getQueryUuid(query, 'pipeline_id'),
    source: getQueryString(query, 'source', 80),
  };
}

function reportWindow(query) {
  const startDate = getQueryDate(query, 'startDate');
  const endDate = getQueryDate(query, 'endDate');
  if (Boolean(startDate) !== Boolean(endDate)) throw new HttpError(400, 'invalid_query', 'startDate and endDate must be provided together.');
  try {
    return startDate && endDate
      ? getExplicitReportWindow(startDate, endDate)
      : getReportWindow(getQueryInteger(query, 'rangeDays', 30, 1, 3_650));
  } catch (error) {
    throw new HttpError(400, 'invalid_query', error.message);
  }
}

function numericCurrencyRow(row) {
  return {
    currency: row.currency, openDeals: Number(row.open_count),
    openPipeline: Number(row.open_pipeline), weightedPipeline: Number(row.weighted_pipeline),
    wonAmount: Number(row.won_amount), lostAmount: Number(row.lost_amount),
  };
}
