import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryString,
  getQueryUuid,
  getRequiredId,
  HttpError,
  json,
  noContent,
  paginated,
  withApiRoute,
} from '../server/http.js';
import { getPipelineWithStages, DEFAULT_PIPELINE_STAGES } from '../server/pipelines.js';
import { validatePipeline, validatePipelineStage } from '../server/validation.js';
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
      const rows = await sql`
        SELECT id, workspace_id, name, is_default, created_by, updated_by, created_at, updated_at,
               COUNT(*) OVER() AS __total_count
        FROM pipelines
        WHERE workspace_id = ${workspace.id}
          AND (${requestedId}::uuid IS NULL OR id = ${requestedId})
          AND (${search}::text IS NULL OR name ILIKE ${search ? `%${search}%` : null})
        ORDER BY is_default DESC, created_at ASC, id ASC
        LIMIT ${requestedId ? 1 : pagination.pageSize} OFFSET ${requestedId ? 0 : pagination.offset}
      `;
      const pipelines = await Promise.all(rows.map(async row => (await getPipelineWithStages(sql, workspace.id, row.id))[0]));
      if (requestedId) {
        if (!pipelines[0]) throw new HttpError(404, 'not_found', 'Pipeline not found.');
        return json(res, 200, { data: pipelines[0] });
      }
      return json(res, 200, paginated(pipelines, pagination, Number(rows[0]?.__total_count ?? 0)));
    }

    if (!['owner', 'admin'].includes(workspace.role)) {
      throw new HttpError(403, 'manager_required', 'Only workspace managers can change pipelines.');
    }

    if (req.method === 'POST') {
      const input = validatePipeline(req.body);
      const stages = parseStages(req.body?.stages, false);
      if (input.is_default) {
        await clearDefault(sql, workspace.id, userId);
      }
      const rows = await sql`
        INSERT INTO pipelines (workspace_id, name, is_default, created_by, updated_by)
        VALUES (${workspace.id}, ${input.name}, ${input.is_default ?? false}, ${userId}, ${userId})
        RETURNING id, workspace_id, name, is_default, created_by, updated_by, created_at, updated_at
      `;
      const pipeline = rows[0];
      await insertStages(sql, workspace.id, pipeline.id, userId, stages ?? DEFAULT_PIPELINE_STAGES);
      const result = (await getPipelineWithStages(sql, workspace.id, pipeline.id))[0];
      return json(res, 201, { data: result });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`
      SELECT id, workspace_id, name, is_default, created_by, updated_by, created_at, updated_at
      FROM pipelines
      WHERE id = ${id} AND workspace_id = ${workspace.id}
    `;
    if (!existingRows[0]) throw new HttpError(404, 'not_found', 'Pipeline not found.');
    const existing = existingRows[0];

    if (req.method === 'PUT') {
      const input = validatePipeline(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      if (has('is_default') && input.is_default === false && existing.is_default) {
        throw new HttpError(400, 'default_pipeline_required', 'Choose another default pipeline before disabling this one.');
      }
      if (has('is_default') && input.is_default) await clearDefault(sql, workspace.id, userId, id);
      const rows = await sql`
        UPDATE pipelines
        SET
          name = ${has('name') ? input.name : existing.name},
          is_default = ${has('is_default') ? input.is_default : existing.is_default},
          updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, workspace_id, name, is_default, created_by, updated_by, created_at, updated_at
      `;
      const stages = parseStages(req.body?.stages, true);
      if (stages) await insertStages(sql, workspace.id, id, userId, stages);
      const result = (await getPipelineWithStages(sql, workspace.id, id))[0];
      return json(res, 200, { data: result });
    }

    if (existing.is_default) {
      throw new HttpError(400, 'default_pipeline_required', 'The default pipeline cannot be deleted.');
    }
    const dealRows = await sql`
      SELECT COUNT(*)::int AS count FROM deals WHERE workspace_id = ${workspace.id} AND pipeline_id = ${id}
    `;
    if (Number(dealRows[0]?.count || 0) > 0) {
      throw new HttpError(409, 'pipeline_in_use', 'A pipeline with deals cannot be deleted.');
    }
    const deleted = await sql`
      DELETE FROM pipelines WHERE id = ${id} AND workspace_id = ${workspace.id} RETURNING id
    `;
    if (!deleted[0]) throw new HttpError(404, 'not_found', 'Pipeline not found.');
    return noContent(res);
  },
});

async function clearDefault(sql, workspaceId, userId, exceptId = null) {
  await sql`
    UPDATE pipelines
    SET is_default = false, updated_by = ${userId}, updated_at = NOW()
    WHERE workspace_id = ${workspaceId}
      AND is_default
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId})
  `;
}
function parseStages(value, partial) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new HttpError(400, 'validation_error', 'stages must contain between 1 and 100 items.');
  }
  const stages = value.map(stage => {
    const input = validatePipelineStage(stage, { partial });
    return {
      ...input,
      key: input.key ?? `stage-${value.indexOf(stage) + 1}`,
      name: input.name ?? input.key ?? 'Stage',
      position: input.position ?? (value.indexOf(stage) + 1) * 10,
      probability: input.probability ?? 0,
      color: input.color ?? '#6366F1',
      is_closed_won: input.is_closed_won ?? false,
      is_closed_lost: input.is_closed_lost ?? false,
    };
  });
  const keys = new Set();
  for (const stage of stages) {
    if (keys.has(stage.key)) throw new HttpError(400, 'validation_error', 'Pipeline stage keys must be unique.');
    keys.add(stage.key);
  }
  return stages;
}

async function insertStages(sql, workspaceId, pipelineId, userId, stages) {
  for (const stage of stages) {
    if (stage.id) {
      const rows = await sql`
        UPDATE pipeline_stages
        SET key = ${stage.key}, name = ${stage.name}, position = ${stage.position},
            probability = ${stage.probability}, color = ${stage.color},
            is_closed_won = ${stage.is_closed_won}, is_closed_lost = ${stage.is_closed_lost},
            updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${stage.id} AND workspace_id = ${workspaceId} AND pipeline_id = ${pipelineId}
        RETURNING id
      `;
      if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Pipeline stage does not belong to this pipeline.');
      continue;
    }
    await sql`
      INSERT INTO pipeline_stages (
        workspace_id, pipeline_id, key, name, position, probability, color,
        is_closed_won, is_closed_lost, created_by, updated_by
      )
      VALUES (
        ${workspaceId}, ${pipelineId}, ${stage.key}, ${stage.name}, ${stage.position}, ${stage.probability}, ${stage.color},
        ${stage.is_closed_won}, ${stage.is_closed_lost}, ${userId}, ${userId}
      )
    `;
  }
}
