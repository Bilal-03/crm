import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryDate,
  getQueryEnum,
  getQueryString,
  getQueryUuid,
  getRequiredId,
  getSort,
  HttpError,
  json,
  noContent,
  paginated,
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import {
  assertDealReferences,
  closeDateForDeal,
  dealStatusForStage,
  forecastCategoryForDeal,
  getDealById,
  mapDealRow,
  resolveOwnerUser,
  resolvePipelineStage,
} from '../server/core-model.js';
import { validateDeal } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const requestedId = getQueryUuid(req.query, 'id');
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search', 160);
      const pipelineId = getQueryUuid(req.query, 'pipeline_id');
      const stageId = getQueryUuid(req.query, 'stage_id');
      const owner = getQueryString(req.query, 'owner', 256);
      const status = getQueryEnum(req.query, 'status', ['open', 'won', 'lost']);
      const forecastCategory = getQueryEnum(req.query, 'forecast_category', ['omitted', 'pipeline', 'best_case', 'commit', 'closed']);
      const from = getQueryDate(req.query, 'from');
      const to = getQueryDate(req.query, 'to');
      const orderBy = getSort(req.query, {
        created: 'd.created_at',
        updated: 'd.updated_at',
        name: 'd.name',
        amount: 'd.amount',
        closeDate: 'd.expected_close_date',
      }, 'updated', 'desc', 'd.id');
      const rows = await sql`
        SELECT d.id, d.workspace_id, d.account_id, d.primary_contact_id, d.owner_user_id,
               d.created_by, d.updated_by, d.pipeline_id, d.stage_id, d.source_lead_id,
               d.name, d.amount, d.currency, d.probability, d.expected_close_date,
               d.actual_close_date, d.forecast_category, d.lead_source, d.status,
               d.lost_reason, d.next_activity_date, d.created_at, d.updated_at,
               p.name AS pipeline_name,
               s.key AS stage_key, s.name AS stage_name, s.position AS stage_position,
               s.color AS stage_color, s.is_closed_won AS stage_is_closed_won,
               s.is_closed_lost AS stage_is_closed_lost,
               a.name AS account_name,
               c.name AS primary_contact_name, c.email AS primary_contact_email,
               COUNT(*) OVER() AS __total_count
        FROM deals d
        JOIN pipelines p ON p.id = d.pipeline_id AND p.workspace_id = d.workspace_id
        JOIN pipeline_stages s ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id AND s.workspace_id = d.workspace_id
        LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
        LEFT JOIN contacts c ON c.id = d.primary_contact_id AND c.workspace_id = d.workspace_id
        WHERE d.workspace_id = ${workspace.id}
          AND (${requestedId}::uuid IS NULL OR d.id = ${requestedId})
          AND (${search}::text IS NULL OR d.name ILIKE ${search ? `%${search}%` : null}
            OR a.name ILIKE ${search ? `%${search}%` : null}
            OR c.name ILIKE ${search ? `%${search}%` : null}
            OR d.lead_source ILIKE ${search ? `%${search}%` : null})
          AND (${pipelineId}::uuid IS NULL OR d.pipeline_id = ${pipelineId})
          AND (${stageId}::uuid IS NULL OR d.stage_id = ${stageId})
          AND (${owner}::text IS NULL OR d.owner_user_id = ${owner})
          AND (${status}::text IS NULL OR d.status = ${status})
          AND (${forecastCategory}::text IS NULL OR d.forecast_category = ${forecastCategory})
          AND (${from}::date IS NULL OR d.expected_close_date >= ${from}::date)
          AND (${to}::date IS NULL OR d.expected_close_date <= ${to}::date)
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${requestedId ? 1 : pagination.pageSize} OFFSET ${requestedId ? 0 : pagination.offset}
      `;
      const result = stripTotalCount(rows).data.map(mapDealRow);
      if (requestedId) {
        if (!result[0]) throw new HttpError(404, 'not_found', 'Deal not found.');
        return json(res, 200, { data: result[0] });
      }
      return json(res, 200, paginated(result, pagination, Number(rows[0]?.__total_count ?? 0)));
    }

    if (req.method === 'POST') {
      const input = validateDeal(req.body);
      const ownerUserId = await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id);
      const { account, contact } = await assertDealReferences(sql, workspace.id, input.account_id, input.primary_contact_id);
      const pipelineStage = await resolvePipelineStage(sql, workspace.id, input.pipeline_id, input.stage_id);
      const status = dealStatusForStage(pipelineStage.stage, input.status);
      const rows = await sql`
        INSERT INTO deals (
          workspace_id, account_id, primary_contact_id, owner_user_id, created_by, updated_by,
          pipeline_id, stage_id, name, amount, currency, probability, expected_close_date,
          actual_close_date, forecast_category, lead_source, status, lost_reason, next_activity_date
        )
        VALUES (
          ${workspace.id}, ${account?.id ?? null}, ${contact?.id ?? null}, ${ownerUserId}, ${userId}, ${userId},
          ${pipelineStage.pipeline.id}, ${pipelineStage.stage.id}, ${input.name}, ${input.amount ?? 0},
          ${input.currency ?? workspace.base_currency ?? 'USD'}, ${input.probability ?? pipelineStage.stage.probability},
          ${input.expected_close_date ?? null}, ${closeDateForDeal(status, input.actual_close_date)},
          ${forecastCategoryForDeal({ status, stageKey: pipelineStage.stage.key, forecastCategory: input.forecast_category })},
          ${input.lead_source ?? null}, ${status}, ${input.lost_reason ?? null}, ${input.next_activity_date ?? null}
        )
        RETURNING id
      `;
      await recordStageChange(sql, workspace.id, rows[0].id, pipelineStage.pipeline.id, null, pipelineStage.stage.id, userId);
      return json(res, 201, { data: await getDealById(sql, workspace.id, rows[0].id) });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`
      SELECT id, workspace_id, account_id, primary_contact_id, owner_user_id, pipeline_id, stage_id,
             name, amount, currency, probability, expected_close_date, actual_close_date,
             forecast_category, lead_source, status, lost_reason, next_activity_date
      FROM deals
      WHERE id = ${id} AND workspace_id = ${workspace.id}
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Deal not found.');

    if (req.method === 'PUT') {
      const input = validateDeal(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      const pipelineChanged = has('pipeline_id') && input.pipeline_id !== existing.pipeline_id;
      const stageChangedByInput = has('stage_id');
      const pipelineStage = await resolvePipelineStage(
        sql,
        workspace.id,
        pipelineChanged ? input.pipeline_id : existing.pipeline_id,
        pipelineChanged ? input.stage_id : stageChangedByInput ? input.stage_id : existing.stage_id,
      );
      const stageChanged = pipelineStage.stage.id !== existing.stage_id || pipelineStage.pipeline.id !== existing.pipeline_id;
      const accountId = has('account_id') ? input.account_id : existing.account_id;
      const contactId = has('primary_contact_id') ? input.primary_contact_id : existing.primary_contact_id;
      const { account, contact } = await assertDealReferences(sql, workspace.id, accountId, contactId);
      const ownerUserId = has('owner_user_id')
        ? await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id)
        : existing.owner_user_id;
      const status = dealStatusForStage(pipelineStage.stage, has('status') ? input.status : stageChanged ? undefined : existing.status);
      const actualCloseDate = has('actual_close_date')
        ? input.actual_close_date
        : status === 'open'
          ? stageChanged || has('status') ? null : existing.actual_close_date
          : existing.actual_close_date || closeDateForDeal(status, null);
      const forecastCategory = has('forecast_category')
        ? input.forecast_category
        : stageChanged || has('status')
          ? forecastCategoryForDeal({ status, stageKey: pipelineStage.stage.key })
          : existing.forecast_category;
      const rows = await sql`
        UPDATE deals
        SET
          account_id = ${account?.id ?? null},
          primary_contact_id = ${contact?.id ?? null},
          owner_user_id = ${ownerUserId},
          updated_by = ${userId},
          pipeline_id = ${pipelineStage.pipeline.id},
          stage_id = ${pipelineStage.stage.id},
          name = ${has('name') ? input.name : existing.name},
          amount = ${has('amount') ? input.amount : existing.amount},
          currency = ${has('currency') ? input.currency : existing.currency},
          probability = ${has('probability') ? input.probability : stageChanged ? pipelineStage.stage.probability : existing.probability},
          expected_close_date = ${has('expected_close_date') ? input.expected_close_date : existing.expected_close_date},
          actual_close_date = ${actualCloseDate},
          forecast_category = ${forecastCategory},
          lead_source = ${has('lead_source') ? input.lead_source : existing.lead_source},
          status = ${status},
          lost_reason = ${has('lost_reason') ? input.lost_reason : existing.lost_reason},
          next_activity_date = ${has('next_activity_date') ? input.next_activity_date : existing.next_activity_date},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id
      `;
      if (stageChanged) {
        await recordStageChange(
          sql,
          workspace.id,
          id,
          pipelineStage.pipeline.id,
          pipelineStage.pipeline.id === existing.pipeline_id ? existing.stage_id : null,
          pipelineStage.stage.id,
          userId,
        );
      }
      return json(res, 200, { data: await getDealById(sql, workspace.id, rows[0].id) });
    }

    const deleted = await sql`
      DELETE FROM deals WHERE id = ${id} AND workspace_id = ${workspace.id} RETURNING id
    `;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Deal not found.');
    return noContent(res);
  },
});

async function recordStageChange(sql, workspaceId, dealId, pipelineId, fromStageId, toStageId, userId) {
  await sql`
    INSERT INTO deal_stage_history (
      workspace_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by, changed_at
    )
    VALUES (${workspaceId}, ${dealId}, ${pipelineId}, ${fromStageId}, ${toStageId}, ${userId}, NOW())
  `;
}
