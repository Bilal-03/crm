import { getDb } from '../server/db.js';
import { calculateGoalProgress, GOAL_METRICS } from '../server/goals.js';
import {
  getPagination,
  getQueryEnum,
  getQueryString,
  getRequiredId,
  HttpError,
  json,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { validateSalesGoal } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const state = getQueryEnum(req.query, 'state', ['active', 'archived', 'all']) || 'active';
      const owner = getQueryString(req.query, 'owner', 256);
      const ownerUserId = owner === 'me' ? userId : owner;
      const rows = await sql`
        WITH goal_scope AS (
          SELECT g.*, member.email AS owner_email, COUNT(*) OVER() AS __total_count
          FROM sales_goals g
          LEFT JOIN workspace_members member
            ON member.workspace_id = g.workspace_id AND member.user_id = g.owner_user_id
          WHERE g.workspace_id = ${workspace.id}
            AND (${state} = 'all' OR g.status = ${state})
            AND (${ownerUserId}::text IS NULL OR g.owner_user_id = ${ownerUserId})
          ORDER BY g.period_end DESC, g.created_at DESC, g.id DESC
          LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
        ), deal_events AS (
          SELECT g.id AS goal_id, g.metric, d.status, d.amount, d.probability,
                 d.expected_close_date,
                 COALESCE(d.actual_close_date, (
                   SELECT MAX(h.changed_at)::date FROM deal_stage_history h
                   JOIN pipeline_stages stage
                     ON stage.id = h.to_stage_id AND stage.pipeline_id = h.pipeline_id
                    AND stage.workspace_id = h.workspace_id
                   WHERE h.workspace_id = d.workspace_id AND h.deal_id = d.id
                     AND stage.is_closed_won
                 )) AS effective_close_date
          FROM goal_scope g
          JOIN deals d ON d.workspace_id = g.workspace_id AND d.currency = g.currency
            AND (g.scope = 'team' OR d.owner_user_id = g.owner_user_id)
        ), deal_values AS (
          SELECT g.id AS goal_id,
                 COALESCE(SUM(d.amount) FILTER (
                   WHERE g.metric = 'won_revenue' AND d.status = 'won'
                     AND d.effective_close_date BETWEEN g.period_start AND g.period_end
                 ), 0)::numeric AS won_actual,
                 COALESCE(SUM(d.amount * d.probability / 100) FILTER (
                   WHERE g.metric = 'won_revenue' AND d.status = 'open'
                     AND d.expected_close_date BETWEEN g.period_start AND g.period_end
                 ), 0)::numeric AS won_open_forecast,
                 COUNT(*) FILTER (
                   WHERE g.metric = 'deals_won' AND d.status = 'won'
                     AND d.effective_close_date BETWEEN g.period_start AND g.period_end
                 )::numeric AS deals_actual,
                 COALESCE(SUM(d.probability / 100) FILTER (
                   WHERE g.metric = 'deals_won' AND d.status = 'open'
                     AND d.expected_close_date BETWEEN g.period_start AND g.period_end
                 ), 0)::numeric AS deals_open_forecast
          FROM goal_scope g LEFT JOIN deal_events d ON d.goal_id = g.id
          GROUP BY g.id
        ), payment_values AS (
          SELECT g.id AS goal_id, COALESCE(SUM(payment.amount), 0)::numeric AS collected_actual
          FROM goal_scope g
          LEFT JOIN invoices invoice ON invoice.workspace_id = g.workspace_id AND invoice.currency = g.currency
          LEFT JOIN deals d ON d.id = invoice.deal_id AND d.workspace_id = invoice.workspace_id
          LEFT JOIN payments payment ON payment.invoice_id = invoice.id
            AND payment.workspace_id = invoice.workspace_id AND payment.status = 'settled'
            AND payment.payment_date BETWEEN g.period_start AND g.period_end
          WHERE g.metric = 'collected_revenue'
            AND (g.scope = 'team' OR d.owner_user_id = g.owner_user_id)
          GROUP BY g.id
        ), invoice_values AS (
          SELECT g.id AS goal_id, COALESCE(SUM(invoice.balance_due), 0)::numeric AS collectible_forecast
          FROM goal_scope g
          LEFT JOIN invoices invoice ON invoice.workspace_id = g.workspace_id AND invoice.currency = g.currency
            AND invoice.status NOT IN ('paid', 'cancelled', 'void')
            AND invoice.due_date BETWEEN g.period_start AND g.period_end
          LEFT JOIN deals d ON d.id = invoice.deal_id AND d.workspace_id = invoice.workspace_id
          WHERE g.metric = 'collected_revenue'
            AND (g.scope = 'team' OR d.owner_user_id = g.owner_user_id)
          GROUP BY g.id
        )
        SELECT g.*,
               CASE g.metric
                 WHEN 'won_revenue' THEN deal.won_actual
                 WHEN 'deals_won' THEN deal.deals_actual
                 WHEN 'collected_revenue' THEN COALESCE(payment.collected_actual, 0)
               END::numeric AS actual_value,
               CASE g.metric
                 WHEN 'won_revenue' THEN deal.won_actual + deal.won_open_forecast
                 WHEN 'deals_won' THEN deal.deals_actual + deal.deals_open_forecast
                 WHEN 'collected_revenue' THEN COALESCE(payment.collected_actual, 0) + COALESCE(invoice.collectible_forecast, 0)
               END::numeric AS forecast_value,
               (CURRENT_TIMESTAMP AT TIME ZONE ${workspace.timezone})::date AS as_of_date
        FROM goal_scope g
        LEFT JOIN deal_values deal ON deal.goal_id = g.id
        LEFT JOIN payment_values payment ON payment.goal_id = g.id
        LEFT JOIN invoice_values invoice ON invoice.goal_id = g.id
        ORDER BY g.period_end DESC, g.created_at DESC, g.id DESC
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, {
        ...paginated(result.data.map(mapGoal), pagination, result.total),
        definitions: GOAL_METRICS,
        permissions: { canManage: ['owner', 'admin'].includes(workspace.role) },
      });
    }

    assertCanManage(workspace.role);
    if (req.method === 'POST') {
      const input = validateSalesGoal({ ...req.body, currency: req.body?.currency || workspace.base_currency });
      await assertOwner(sql, workspace.id, input);
      const rows = await sql`
        INSERT INTO sales_goals (
          workspace_id, name, scope, owner_user_id, metric, currency,
          target_value, period_start, period_end, created_by, updated_by
        ) VALUES (
          ${workspace.id}, ${input.name}, ${input.scope}, ${input.owner_user_id}, ${input.metric},
          ${input.currency}, ${input.target_value}, ${input.period_start}, ${input.period_end}, ${userId}, ${userId}
        ) RETURNING *
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`
      SELECT * FROM sales_goals WHERE id = ${id} AND workspace_id = ${workspace.id}
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Sales goal not found.');

    if (req.method === 'DELETE') {
      const rows = await sql`
        UPDATE sales_goals SET status = 'archived', updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING *
      `;
      return json(res, 200, { data: rows[0] });
    }

    const input = validateSalesGoal({
      name: req.body?.name ?? existing.name,
      scope: req.body?.scope ?? existing.scope,
      owner_user_id: Object.prototype.hasOwnProperty.call(req.body || {}, 'owner_user_id') ? req.body.owner_user_id : existing.owner_user_id,
      metric: req.body?.metric ?? existing.metric,
      currency: req.body?.currency ?? existing.currency,
      target_value: req.body?.target_value ?? existing.target_value,
      period_start: req.body?.period_start ?? String(existing.period_start),
      period_end: req.body?.period_end ?? String(existing.period_end),
    });
    await assertOwner(sql, workspace.id, input);
    const rows = await sql`
      UPDATE sales_goals SET name = ${input.name}, scope = ${input.scope},
        owner_user_id = ${input.owner_user_id}, metric = ${input.metric}, currency = ${input.currency},
        target_value = ${input.target_value}, period_start = ${input.period_start}, period_end = ${input.period_end},
        updated_by = ${userId}, updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspace.id}
      RETURNING *
    `;
    return json(res, 200, { data: rows[0] });
  },
});

function assertCanManage(role) {
  if (!['owner', 'admin'].includes(role)) {
    throw new HttpError(403, 'goal_permission_denied', 'Only workspace managers can manage goals and quotas.');
  }
}

async function assertOwner(sql, workspaceId, input) {
  if (input.scope !== 'owner') return;
  const rows = await sql`
    SELECT user_id FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${input.owner_user_id}
  `;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Goal owner is not a member of this workspace.');
}

function mapGoal(row) {
  const {
    __total_count: _totalCount,
    actual_value: actualValue,
    forecast_value: forecastValue,
    as_of_date: asOfDate,
    ...goal
  } = row;
  return {
    ...goal,
    target_value: Number(goal.target_value),
    progress: calculateGoalProgress(goal, { actual: actualValue, forecast: forecastValue }, asOfDate),
    metricDefinition: GOAL_METRICS[goal.metric],
  };
}
