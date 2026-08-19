import { getDb } from '../server/db.js';
import { getQueryInteger, json, withApiRoute } from '../server/http.js';
import { getReportWindow } from '../server/reporting.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const rangeDays = getQueryInteger(req.query, 'rangeDays', 30, 1, 3_650);
    const window = getReportWindow(rangeDays);
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    const [leadSummaryRows, sourceRows, stageRows, meetingRows, invoiceSummaryRows, revenueTrendRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= ${window.startDate}::date AND created_at < ${window.endDateExclusive}::date)::int AS new_leads,
          COUNT(*) FILTER (WHERE won_at >= ${window.startDate}::date AND won_at < ${window.endDateExclusive}::date)::int AS deals_won,
          COUNT(*) FILTER (WHERE lost_at >= ${window.startDate}::date AND lost_at < ${window.endDateExclusive}::date)::int AS deals_lost
        FROM leads
        WHERE workspace_id = ${workspace.id}
      `,
      sql`
        SELECT COALESCE(source, 'Unknown') AS name, COUNT(*)::int AS count
        FROM leads
        WHERE workspace_id = ${workspace.id}
          AND created_at >= ${window.startDate}::date
          AND created_at < ${window.endDateExclusive}::date
        GROUP BY COALESCE(source, 'Unknown')
        ORDER BY count DESC, name ASC
        LIMIT 20
      `,
      sql`
        SELECT stage, COUNT(*)::int AS count
        FROM leads
        WHERE workspace_id = ${workspace.id}
        GROUP BY stage
      `,
      sql`
        SELECT COUNT(*)::int AS count
        FROM meetings
        WHERE workspace_id = ${workspace.id}
          AND date_time >= ${window.startDate}::date
          AND date_time < ${window.endDateExclusive}::date
      `,
      sql`
        SELECT
          COUNT(*)::int AS paid_invoices,
          COALESCE(SUM(total_amount), 0)::numeric AS revenue_collected
        FROM invoices
        WHERE workspace_id = ${workspace.id}
          AND status = 'paid'
          AND COALESCE(paid_at::date, invoice_date) >= ${window.startDate}::date
          AND COALESCE(paid_at::date, invoice_date) < ${window.endDateExclusive}::date
      `,
      sql`
        SELECT COALESCE(paid_at::date, invoice_date) AS day, COALESCE(SUM(total_amount), 0)::numeric AS revenue
        FROM invoices
        WHERE workspace_id = ${workspace.id}
          AND status = 'paid'
          AND COALESCE(paid_at::date, invoice_date) >= ${window.startDate}::date
          AND COALESCE(paid_at::date, invoice_date) < ${window.endDateExclusive}::date
        GROUP BY COALESCE(paid_at::date, invoice_date)
        ORDER BY day
      `,
    ]);

    const leads = leadSummaryRows[0] || {};
    const won = Number(leads.deals_won || 0);
    const lost = Number(leads.deals_lost || 0);
    const closed = won + lost;
    const invoiceSummary = invoiceSummaryRows[0] || {};

    return json(res, 200, {
      data: {
        period: window,
        metrics: {
          newLeads: Number(leads.new_leads || 0),
          dealsWon: won,
          dealsLost: lost,
          closeRate: closed ? Math.round((won / closed) * 100) : 0,
          revenueCollected: Number(invoiceSummary.revenue_collected || 0),
          paidInvoices: Number(invoiceSummary.paid_invoices || 0),
          meetingsScheduled: Number(meetingRows[0]?.count || 0),
          averageLeadsPerDay: Number(leads.new_leads || 0) / rangeDays,
        },
        sourceData: sourceRows.map(row => ({ name: row.name, count: Number(row.count || 0) })),
        funnelData: stageRows.map(row => ({ stage: row.stage, count: Number(row.count || 0) })),
        revenueTrend: revenueTrendRows.map(row => ({ date: String(row.day), revenue: Number(row.revenue || 0) })),
        definitions: {
          newLeads: 'Leads created during the selected period.',
          dealsWon: 'Leads whose won_at timestamp falls in the selected period.',
          dealsLost: 'Leads whose lost_at timestamp falls in the selected period.',
          revenueCollected: 'Paid invoice totals grouped by paid_at, falling back to invoice_date for legacy records.',
          funnel: 'Current lead stage distribution across the workspace; it is not a historical conversion funnel until stage history exists.',
        },
      },
    });
  },
});
