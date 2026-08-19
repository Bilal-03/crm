import { HttpError } from './http.js';

export const DEFAULT_PIPELINE_NAME = 'Default Sales Pipeline';

export const DEFAULT_PIPELINE_STAGES = Object.freeze([
  { key: 'new', name: 'New Lead', position: 10, probability: 10, color: '#3B82F6', is_closed_won: false, is_closed_lost: false },
  { key: 'qualified', name: 'Qualified', position: 20, probability: 25, color: '#8B5CF6', is_closed_won: false, is_closed_lost: false },
  { key: 'follow-up', name: 'Follow-up', position: 30, probability: 40, color: '#F59E0B', is_closed_won: false, is_closed_lost: false },
  { key: 'proposal', name: 'Proposal', position: 40, probability: 60, color: '#10B981', is_closed_won: false, is_closed_lost: false },
  { key: 'closed-won', name: 'Closed Won', position: 50, probability: 100, color: '#059669', is_closed_won: true, is_closed_lost: false },
  { key: 'closed-lost', name: 'Closed Lost', position: 60, probability: 0, color: '#EF4444', is_closed_won: false, is_closed_lost: true },
]);

export async function ensureDefaultPipeline(sql, workspace, actorUserId = workspace.owner_user_id) {
  await sql`
    UPDATE pipelines
    SET is_default = false, updated_at = NOW(), updated_by = ${actorUserId}
    WHERE workspace_id = ${workspace.id} AND is_default
  `;
  const created = await sql`
    INSERT INTO pipelines (workspace_id, name, is_default, created_by, updated_by)
    VALUES (${workspace.id}, ${DEFAULT_PIPELINE_NAME}, true, ${actorUserId}, ${actorUserId})
    ON CONFLICT (workspace_id, name) DO NOTHING
    RETURNING id, workspace_id, name, is_default, created_by, updated_by, created_at, updated_at
  `;
  const rows = created.length > 0
    ? created
    : await sql`
      SELECT id, workspace_id, name, is_default, created_by, updated_by, created_at, updated_at
      FROM pipelines
      WHERE workspace_id = ${workspace.id} AND name = ${DEFAULT_PIPELINE_NAME}
    `;
  const pipeline = rows[0];
  if (!pipeline) throw new HttpError(500, 'pipeline_provisioning_failed', 'The default pipeline could not be provisioned.');

  await sql`
    UPDATE pipelines
    SET is_default = true, updated_at = NOW(), updated_by = ${actorUserId}
    WHERE id = ${pipeline.id} AND workspace_id = ${workspace.id}
  `;

  for (const stage of DEFAULT_PIPELINE_STAGES) {
    await sql`
      INSERT INTO pipeline_stages (
        workspace_id, pipeline_id, key, name, position, probability, color,
        is_closed_won, is_closed_lost, created_by, updated_by
      )
      VALUES (
        ${workspace.id}, ${pipeline.id}, ${stage.key}, ${stage.name}, ${stage.position}, ${stage.probability}, ${stage.color},
        ${stage.is_closed_won}, ${stage.is_closed_lost}, ${actorUserId}, ${actorUserId}
      )
      ON CONFLICT (pipeline_id, key) DO NOTHING
    `;
  }

  const stages = await sql`
    SELECT id, workspace_id, pipeline_id, key, name, position, probability, color,
           is_closed_won, is_closed_lost, created_by, updated_by, created_at, updated_at
    FROM pipeline_stages
    WHERE workspace_id = ${workspace.id} AND pipeline_id = ${pipeline.id}
    ORDER BY position ASC, id ASC
  `;
  return { ...pipeline, is_default: true, stages };
}

export async function getPipelineWithStages(sql, workspaceId, pipelineId) {
  const rows = await sql`
    SELECT p.id, p.workspace_id, p.name, p.is_default, p.created_by, p.updated_by,
           p.created_at, p.updated_at,
           s.id AS stage_id, s.key AS stage_key, s.name AS stage_name,
           s.position AS stage_position, s.probability AS stage_probability, s.color AS stage_color,
           s.is_closed_won AS stage_is_closed_won, s.is_closed_lost AS stage_is_closed_lost
    FROM pipelines p
    LEFT JOIN pipeline_stages s ON s.pipeline_id = p.id AND s.workspace_id = p.workspace_id
    WHERE p.workspace_id = ${workspaceId}
      AND (${pipelineId}::uuid IS NULL OR p.id = ${pipelineId})
    ORDER BY p.is_default DESC, p.created_at ASC, p.id ASC, s.position ASC, s.id ASC
  `;
  const pipelines = new Map();
  for (const row of rows) {
    if (!pipelines.has(row.id)) {
      pipelines.set(row.id, {
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        is_default: row.is_default,
        created_by: row.created_by,
        updated_by: row.updated_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        stages: [],
      });
    }
    if (row.stage_id) {
      pipelines.get(row.id).stages.push({
        id: row.stage_id,
        workspace_id: row.workspace_id,
        pipeline_id: row.id,
        key: row.stage_key,
        name: row.stage_name,
        position: row.stage_position,
        probability: row.stage_probability,
        color: row.stage_color,
        is_closed_won: row.stage_is_closed_won,
        is_closed_lost: row.stage_is_closed_lost,
      });
    }
  }
  return [...pipelines.values()];
}
