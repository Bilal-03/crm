import { getDb } from '../../server/db.js';
import { json, withApiRoute } from '../../server/http.js';
import { getActiveWorkspace } from '../../server/workspaces.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const [totals, byStage, byForecast] = await Promise.all([
      sql`
        SELECT d.currency,
               COUNT(*)::int AS deal_count,
               COALESCE(SUM(CASE WHEN d.status = 'open' THEN d.amount ELSE 0 END), 0) AS open_pipeline_amount,
               COALESCE(SUM(CASE WHEN d.status = 'open' THEN d.amount * d.probability / 100 ELSE 0 END), 0) AS weighted_pipeline_amount,
               COALESCE(SUM(CASE WHEN d.status = 'won' THEN d.amount ELSE 0 END), 0) AS closed_won_amount,
               COALESCE(SUM(CASE WHEN d.status = 'lost' THEN d.amount ELSE 0 END), 0) AS closed_lost_amount
        FROM deals d
        WHERE d.workspace_id = ${workspace.id}
        GROUP BY d.currency
        ORDER BY d.currency
      `,
      sql`
        SELECT d.currency, d.pipeline_id, p.name AS pipeline_name, d.stage_id,
               s.key AS stage_key, s.name AS stage_name, s.position, s.color,
               COUNT(*)::int AS deal_count,
               COALESCE(SUM(d.amount), 0) AS pipeline_amount,
               COALESCE(SUM(d.amount * d.probability / 100), 0) AS weighted_amount
        FROM deals d
        JOIN pipelines p ON p.id = d.pipeline_id AND p.workspace_id = d.workspace_id
        JOIN pipeline_stages s ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id AND s.workspace_id = d.workspace_id
        WHERE d.workspace_id = ${workspace.id} AND d.status = 'open'
        GROUP BY d.currency, d.pipeline_id, p.name, d.stage_id, s.id, s.key, s.name, s.position, s.color
        ORDER BY d.currency, p.name, s.position, s.id
      `,
      sql`
        SELECT d.currency, d.forecast_category, COUNT(*)::int AS deal_count,
               COALESCE(SUM(d.amount), 0) AS amount,
               COALESCE(SUM(d.amount * d.probability / 100), 0) AS weighted_amount
        FROM deals d
        WHERE d.workspace_id = ${workspace.id} AND d.status = 'open'
        GROUP BY d.currency, d.forecast_category
        ORDER BY d.currency, d.forecast_category
      `,
    ]);
    return json(res, 200, {
      data: {
        currency: workspace.base_currency,
        timezone: workspace.timezone,
        totals,
        byStage,
        byForecast,
      },
    });
  },
});
