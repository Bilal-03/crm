import { getDb } from '../server/db.js';
import { getQueryInteger, json, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const trendDays = getQueryInteger(req.query, 'trendDays', 7, 1, 365);

    const [leadSummaryRows, invoiceSummaryRows, meetingSummaryRows, reminderRows, stageRows, leadTrendRows, revenueTrendRows, dealSummaryRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::int AS new_this_month,
          COUNT(*) FILTER (WHERE stage = 'qualified')::int AS qualified,
          COUNT(*) FILTER (WHERE stage = 'proposal')::int AS proposals,
          COUNT(*) FILTER (WHERE stage = 'closed-won')::int AS closed_won,
          COUNT(*) FILTER (WHERE stage IN ('qualified', 'proposal'))::int AS open_pipeline_leads
        FROM leads
        WHERE workspace_id = ${workspace.id}
      `,
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
          COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
          COUNT(*) FILTER (WHERE status NOT IN ('paid', 'cancelled') AND due_date < CURRENT_DATE)::int AS overdue,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0)::numeric AS total_revenue,
          COALESCE(SUM(balance_due) FILTER (WHERE status NOT IN ('paid', 'cancelled')), 0)::numeric AS outstanding,
          COALESCE(SUM(total_amount) FILTER (
            WHERE status = 'paid' AND COALESCE(paid_at::date, invoice_date) >= date_trunc('month', CURRENT_DATE)::date
          ), 0)::numeric AS this_month_revenue
        FROM invoices
        WHERE workspace_id = ${workspace.id}
      `,
      sql`
        SELECT COUNT(*) FILTER (WHERE date_time > NOW())::int AS upcoming
        FROM meetings
        WHERE workspace_id = ${workspace.id}
      `,
      sql`
        SELECT COUNT(*)::int AS overdue
        FROM leads l
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.reminders, '[]'::jsonb)) AS reminder(value)
        WHERE l.workspace_id = ${workspace.id}
          AND COALESCE((reminder.value->>'completed')::boolean, false) = false
          AND (reminder.value->>'date')::date < CURRENT_DATE
      `,
      sql`
        SELECT stage, COUNT(*)::int AS count
        FROM leads
        WHERE workspace_id = ${workspace.id}
        GROUP BY stage
      `,
      sql`
        SELECT created_at::date AS day, COUNT(*)::int AS leads
        FROM leads
        WHERE workspace_id = ${workspace.id}
          AND created_at >= CURRENT_DATE - ${trendDays - 1}::int
          AND created_at < CURRENT_DATE + 1
        GROUP BY created_at::date
        ORDER BY day
      `,
      sql`
        SELECT COALESCE(paid_at::date, invoice_date) AS day, COALESCE(SUM(total_amount), 0)::numeric AS revenue
        FROM invoices
        WHERE workspace_id = ${workspace.id}
          AND status = 'paid'
          AND COALESCE(paid_at::date, invoice_date) >= CURRENT_DATE - ${trendDays - 1}::int
          AND COALESCE(paid_at::date, invoice_date) < CURRENT_DATE + 1
        GROUP BY COALESCE(paid_at::date, invoice_date)
        ORDER BY day
      `,
      sql`
        SELECT d.currency,
               COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'open'), 0) AS open_pipeline_amount,
               COALESCE(SUM(d.amount * d.probability / 100) FILTER (WHERE d.status = 'open'), 0) AS weighted_pipeline_amount,
               COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'won'), 0) AS closed_won_amount,
               COALESCE(SUM(d.amount) FILTER (WHERE d.status = 'lost'), 0) AS closed_lost_amount
        FROM deals d
        WHERE d.workspace_id = ${workspace.id}
        GROUP BY d.currency
        ORDER BY d.currency
      `,
    ]);

    const leads = leadSummaryRows[0] || {};
    const invoices = invoiceSummaryRows[0] || {};
    const meetings = meetingSummaryRows[0] || {};
    const baseCurrencyDeals = dealSummaryRows.find(row => row.currency === workspace.base_currency) || {};
    const trendByDay = new Map();
    leadTrendRows.forEach(row => trendByDay.set(String(row.day), { leads: Number(row.leads || 0), revenue: 0 }));
    revenueTrendRows.forEach(row => {
      const key = String(row.day);
      trendByDay.set(key, { ...(trendByDay.get(key) || { leads: 0 }), revenue: Number(row.revenue || 0) });
    });

    return json(res, 200, {
      data: {
        asOf: new Date().toISOString(),
        leads: {
          total: Number(leads.total || 0),
          newThisMonth: Number(leads.new_this_month || 0),
          qualified: Number(leads.qualified || 0),
          proposals: Number(leads.proposals || 0),
          closedWon: Number(leads.closed_won || 0),
          openPipelineLeads: Number(leads.open_pipeline_leads || 0),
        },
        meetings: { upcoming: Number(meetings.upcoming || 0) },
        reminders: { overdue: Number(reminderRows[0]?.overdue || 0) },
        invoices: {
          total: Number(invoices.total || 0),
          paid: Number(invoices.paid || 0),
          draft: Number(invoices.draft || 0),
          overdue: Number(invoices.overdue || 0),
          totalRevenue: Number(invoices.total_revenue || 0),
          outstanding: Number(invoices.outstanding || 0),
          thisMonthRevenue: Number(invoices.this_month_revenue || 0),
        },
        deals: {
          currency: workspace.base_currency,
          openPipelineAmount: Number(baseCurrencyDeals.open_pipeline_amount || 0),
          weightedPipelineAmount: Number(baseCurrencyDeals.weighted_pipeline_amount || 0),
          closedWonAmount: Number(baseCurrencyDeals.closed_won_amount || 0),
          closedLostAmount: Number(baseCurrencyDeals.closed_lost_amount || 0),
          byCurrency: dealSummaryRows.map(row => ({
            currency: row.currency,
            openPipelineAmount: Number(row.open_pipeline_amount || 0),
            weightedPipelineAmount: Number(row.weighted_pipeline_amount || 0),
            closedWonAmount: Number(row.closed_won_amount || 0),
            closedLostAmount: Number(row.closed_lost_amount || 0),
          })),
        },
        stages: stageRows.map(row => ({ stage: row.stage, count: Number(row.count || 0) })),
        revenueTrend: buildTrend(trendDays, trendByDay),
      },
    });
  },
});

function buildTrend(trendDays, values) {
  const today = new Date();
  const trend = [];
  for (let index = trendDays - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    trend.push({
      date: key,
      leads: values.get(key)?.leads || 0,
      revenue: values.get(key)?.revenue || 0,
    });
  }
  return trend;
}
