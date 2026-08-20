import { HttpError } from './http.js';
import { normalizeEmail, normalizeName, normalizePhone } from './normalization.js';

export async function resolveOwnerUser(sql, workspaceId, actorUserId, requestedOwnerUserId) {
  const ownerUserId = requestedOwnerUserId || actorUserId;
  const rows = await sql`
    SELECT user_id
    FROM workspace_members
    WHERE workspace_id = ${workspaceId} AND user_id = ${ownerUserId}
  `;
  if (!rows[0]) throw new HttpError(400, 'invalid_owner', 'The owner must be a member of this workspace.');
  return ownerUserId;
}

export async function getAccountInWorkspace(sql, workspaceId, accountId) {
  if (!accountId) return null;
  const rows = await sql`
    SELECT id, workspace_id, owner_user_id, name, normalized_name, domain, normalized_domain,
           phone, normalized_phone, website, industry, created_at, updated_at
    FROM accounts
    WHERE id = ${accountId} AND workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Account does not exist in this workspace.');
  return rows[0];
}

export async function getContactInWorkspace(sql, workspaceId, contactId) {
  if (!contactId) return null;
  const rows = await sql`
    SELECT id, workspace_id, account_id, owner_user_id, name, title, email, normalized_email,
           phone, normalized_phone, created_at, updated_at
    FROM contacts
    WHERE id = ${contactId} AND workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new HttpError(400, 'invalid_reference', 'Contact does not exist in this workspace.');
  return rows[0];
}

export async function assertDealReferences(sql, workspaceId, accountId, contactId, updatedBy) {
  const account = await getAccountInWorkspace(sql, workspaceId, accountId);
  const contact = await getContactInWorkspace(sql, workspaceId, contactId);
  if (account && contact?.account_id && account.id !== contact.account_id) {
    throw new HttpError(400, 'invalid_reference', 'The contact belongs to a different account.');
  }
  if (account && contact && !contact.account_id) {
    await sql`
      UPDATE contacts
      SET account_id = ${account.id}, updated_by = ${updatedBy}, updated_at = NOW()
      WHERE id = ${contact.id} AND workspace_id = ${workspaceId}
    `;
    contact.account_id = account.id;
  }
  return { account, contact };
}

export async function resolvePipelineStage(sql, workspaceId, pipelineId, stageId, stageKey) {
  const pipelineRows = pipelineId
    ? await sql`
      SELECT id, workspace_id, name, is_default
      FROM pipelines
      WHERE id = ${pipelineId} AND workspace_id = ${workspaceId}
    `
    : await sql`
      SELECT id, workspace_id, name, is_default
      FROM pipelines
      WHERE workspace_id = ${workspaceId} AND is_default
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `;
  const pipeline = pipelineRows[0];
  if (!pipeline) throw new HttpError(400, 'invalid_reference', 'Pipeline does not exist in this workspace.');

  const stageRows = stageId
    ? await sql`
      SELECT id, workspace_id, pipeline_id, key, name, position, probability, color,
             is_closed_won, is_closed_lost
      FROM pipeline_stages
      WHERE id = ${stageId} AND pipeline_id = ${pipeline.id} AND workspace_id = ${workspaceId}
    `
    : stageKey
      ? await sql`
        SELECT id, workspace_id, pipeline_id, key, name, position, probability, color,
               is_closed_won, is_closed_lost
        FROM pipeline_stages
        WHERE pipeline_id = ${pipeline.id} AND workspace_id = ${workspaceId} AND key = ${stageKey}
      `
      : await sql`
        SELECT id, workspace_id, pipeline_id, key, name, position, probability, color,
               is_closed_won, is_closed_lost
        FROM pipeline_stages
        WHERE pipeline_id = ${pipeline.id} AND workspace_id = ${workspaceId}
        ORDER BY position ASC, id ASC
        LIMIT 1
      `;
  const stage = stageRows[0];
  if (!stage) throw new HttpError(400, 'invalid_reference', 'Pipeline stage does not exist in this pipeline.');
  return { pipeline, stage };
}

export function dealStatusForStage(stage, explicitStatus) {
  if (explicitStatus) return explicitStatus;
  if (stage.is_closed_won) return 'won';
  if (stage.is_closed_lost) return 'lost';
  return 'open';
}

export function forecastCategoryForDeal({ status, stageKey, forecastCategory }) {
  if (forecastCategory) return forecastCategory;
  if (status === 'won') return 'closed';
  if (status === 'lost') return 'omitted';
  if (stageKey === 'proposal') return 'best_case';
  return 'pipeline';
}

export function closeDateForDeal(status, suppliedDate, fallbackDate = new Date().toISOString().slice(0, 10)) {
  if (status === 'open') return suppliedDate ?? null;
  return suppliedDate || fallbackDate;
}

export function legacyLeadAmount(quoteItems) {
  if (!Array.isArray(quoteItems)) return 0;
  const cents = quoteItems.reduce((sum, item) => {
    const quantity = Number(item?.quantity);
    const price = Number(item?.price);
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity < 0 || price < 0) return sum;
    return sum + Math.round(quantity * price * 100);
  }, 0);
  return cents / 100;
}

export async function getDealById(sql, workspaceId, dealId) {
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
           c.name AS primary_contact_name, c.email AS primary_contact_email
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id AND p.workspace_id = d.workspace_id
    JOIN pipeline_stages s ON s.id = d.stage_id AND s.pipeline_id = d.pipeline_id AND s.workspace_id = d.workspace_id
    LEFT JOIN accounts a ON a.id = d.account_id AND a.workspace_id = d.workspace_id
    LEFT JOIN contacts c ON c.id = d.primary_contact_id AND c.workspace_id = d.workspace_id
    WHERE d.id = ${dealId} AND d.workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Deal not found.');
  const historyRows = await sql`
    SELECT h.id, h.from_stage_id, h.to_stage_id, h.changed_by, h.changed_at,
           from_stage.name AS from_stage_name, to_stage.name AS to_stage_name
    FROM deal_stage_history h
    LEFT JOIN pipeline_stages from_stage
      ON from_stage.id = h.from_stage_id
     AND from_stage.pipeline_id = h.pipeline_id
     AND from_stage.workspace_id = h.workspace_id
    JOIN pipeline_stages to_stage
      ON to_stage.id = h.to_stage_id
     AND to_stage.pipeline_id = h.pipeline_id
     AND to_stage.workspace_id = h.workspace_id
    WHERE h.deal_id = ${dealId} AND h.workspace_id = ${workspaceId}
    ORDER BY h.changed_at DESC, h.id DESC
  `;
  return {
    ...mapDealRow(rows[0]),
    stage_history: historyRows.map(history => ({
      id: history.id,
      from_stage_id: history.from_stage_id,
      to_stage_id: history.to_stage_id,
      from_stage_name: history.from_stage_name,
      to_stage_name: history.to_stage_name,
      changed_by: history.changed_by,
      changed_at: history.changed_at,
    })),
  };
}

export function mapDealRow(row) {
  const {
    pipeline_name: pipelineName,
    stage_key: stageKey,
    stage_name: stageName,
    stage_position: stagePosition,
    stage_color: stageColor,
    stage_is_closed_won: stageIsClosedWon,
    stage_is_closed_lost: stageIsClosedLost,
    account_name: accountName,
    primary_contact_name: primaryContactName,
    primary_contact_email: primaryContactEmail,
    ...deal
  } = row;
  return {
    ...deal,
    pipeline: { id: deal.pipeline_id, name: pipelineName },
    stage: {
      id: deal.stage_id,
      key: stageKey,
      name: stageName,
      position: stagePosition,
      probability: deal.probability,
      color: stageColor,
      is_closed_won: stageIsClosedWon,
      is_closed_lost: stageIsClosedLost,
    },
    account: deal.account_id ? { id: deal.account_id, name: accountName } : null,
    primary_contact: deal.primary_contact_id
      ? { id: deal.primary_contact_id, name: primaryContactName, email: primaryContactEmail }
      : null,
  };
}

export async function convertLeadToDeal(sql, workspace, userId, input) {
  const accessAll = ['owner', 'admin'].includes(workspace.role);
  const leadRows = await sql`
    SELECT id, workspace_id, user_id, name, company, email, phone, source, stage,
           quote_items, won_at, lost_at, created_at, updated_at
    FROM leads
    WHERE id = ${input.lead_id} AND workspace_id = ${workspace.id}
  `;
  const lead = leadRows[0];
  if (!lead) throw new HttpError(404, 'not_found', 'Lead not found.');

  const existingRows = await sql`
    SELECT id, workspace_id, pipeline_id, stage_id, owner_user_id, source_lead_id
    FROM deals
    WHERE workspace_id = ${workspace.id} AND source_lead_id = ${lead.id}
  `;
  if (existingRows[0]) {
    if (!accessAll && existingRows[0].owner_user_id !== userId) {
      throw new HttpError(403, 'record_access_denied', 'The converted deal is assigned to another team member.');
    }
    await sql`
      INSERT INTO deal_stage_history (
        workspace_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by, source_lead_id
      )
      VALUES (
        ${workspace.id}, ${existingRows[0].id}, ${existingRows[0].pipeline_id}, NULL,
        ${existingRows[0].stage_id}, ${existingRows[0].owner_user_id}, ${lead.id}
      )
      ON CONFLICT (workspace_id, source_lead_id) WHERE source_lead_id IS NOT NULL DO NOTHING
    `;
    return { deal: await getDealById(sql, workspace.id, existingRows[0].id), converted: false };
  }

  const pipelineStage = await resolvePipelineStage(
    sql,
    workspace.id,
    input.pipeline_id,
    input.stage_id,
    input.stage_id ? undefined : lead.stage,
  );
  const normalizedLeadEmail = normalizeEmail(lead.email);
  const normalizedLeadPhone = normalizePhone(lead.phone);
  const fallbackAccountName = lead.company?.trim() || lead.name.trim();
  let account;
  let contact;

  if (input.primary_contact_id) {
    contact = await getContactInWorkspace(sql, workspace.id, input.primary_contact_id);
    account = input.account_id
      ? await getAccountInWorkspace(sql, workspace.id, input.account_id)
      : contact.account_id
        ? await getAccountInWorkspace(sql, workspace.id, contact.account_id)
        : await createOrGetAccount(sql, workspace, userId, fallbackAccountName);
  } else {
    account = input.account_id
      ? await getAccountInWorkspace(sql, workspace.id, input.account_id)
      : await createOrGetAccount(sql, workspace, userId, fallbackAccountName);
    const contactRows = await sql`
      INSERT INTO contacts (
        workspace_id, account_id, owner_user_id, created_by, updated_by,
        name, email, normalized_email, phone, normalized_phone, source_lead_id
      )
      VALUES (
        ${workspace.id}, ${account?.id ?? null}, ${userId}, ${userId}, ${userId},
        ${lead.name}, ${lead.email}, ${normalizedLeadEmail}, ${lead.phone ?? null}, ${normalizedLeadPhone}, ${lead.id}
      )
      ON CONFLICT (workspace_id, normalized_email) WHERE normalized_email IS NOT NULL DO UPDATE SET
        account_id = COALESCE(contacts.account_id, EXCLUDED.account_id),
        source_lead_id = COALESCE(contacts.source_lead_id, EXCLUDED.source_lead_id),
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      WHERE ${accessAll} OR contacts.owner_user_id = ${userId}
      RETURNING id, account_id, name, email, phone
    `;
    if (!contactRows[0]) throw new HttpError(409, 'record_access_denied', 'A matching contact belongs to another team member.');
    contact = contactRows[0];
  }

  if (account && contact?.account_id && account.id !== contact.account_id) {
    throw new HttpError(400, 'invalid_reference', 'The contact belongs to a different account.');
  }

  const status = dealStatusForStage(pipelineStage.stage);
  const amount = input.amount ?? legacyLeadAmount(lead.quote_items);
  const currency = input.currency ?? workspace.base_currency ?? 'USD';
  const rows = await sql`
    INSERT INTO deals (
      workspace_id, account_id, primary_contact_id, owner_user_id, created_by, updated_by,
      pipeline_id, stage_id, source_lead_id, name, amount, currency, probability,
      expected_close_date, actual_close_date, forecast_category, lead_source, status,
      lost_reason, next_activity_date
    )
    VALUES (
      ${workspace.id}, ${account?.id ?? null}, ${contact?.id ?? null}, ${userId}, ${userId}, ${userId},
      ${pipelineStage.pipeline.id}, ${pipelineStage.stage.id}, ${lead.id}, ${input.name ?? lead.name},
      ${amount}, ${currency}, ${input.probability ?? pipelineStage.stage.probability},
      ${input.expected_close_date ?? null},
      ${closeDateForDeal(status, lead.stage === 'closed-won' ? dateOnly(lead.won_at) : dateOnly(lead.lost_at))},
      ${forecastCategoryForDeal({ status, stageKey: pipelineStage.stage.key, forecastCategory: input.forecast_category })},
      ${lead.source ?? null}, ${status}, ${input.lost_reason ?? null}, ${input.next_activity_date ?? null}
    )
    ON CONFLICT (workspace_id, source_lead_id) WHERE source_lead_id IS NOT NULL DO NOTHING
    RETURNING id, pipeline_id, stage_id, owner_user_id
  `;
  const inserted = rows[0];
  const deal = inserted
    ? inserted
    : (await sql`
      SELECT id, pipeline_id, stage_id, owner_user_id
      FROM deals
      WHERE workspace_id = ${workspace.id} AND source_lead_id = ${lead.id}
    `)[0];
  if (!deal) throw new HttpError(500, 'conversion_failed', 'The lead could not be converted.');

  await sql`
    INSERT INTO deal_stage_history (
      workspace_id, deal_id, pipeline_id, from_stage_id, to_stage_id, changed_by, source_lead_id
    )
    VALUES (${workspace.id}, ${deal.id}, ${deal.pipeline_id}, NULL, ${deal.stage_id}, ${userId}, ${lead.id})
    ON CONFLICT (workspace_id, source_lead_id) WHERE source_lead_id IS NOT NULL DO NOTHING
  `;
  return { deal: await getDealById(sql, workspace.id, deal.id), converted: Boolean(inserted) };
}

async function createOrGetAccount(sql, workspace, userId, name) {
  const accessAll = ['owner', 'admin'].includes(workspace.role);
  const normalizedName = normalizeName(name);
  const rows = await sql`
    INSERT INTO accounts (
      workspace_id, owner_user_id, created_by, updated_by, name, normalized_name
    )
    VALUES (
      ${workspace.id}, ${userId}, ${userId}, ${userId}, ${name}, ${normalizedName}
    )
    ON CONFLICT (workspace_id, normalized_name) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = NOW()
    WHERE ${accessAll} OR accounts.owner_user_id = ${userId}
    RETURNING id, workspace_id, owner_user_id, name
  `;
  if (!rows[0]) throw new HttpError(409, 'record_access_denied', 'A matching account belongs to another team member.');
  return rows[0];
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
