import { getDb } from '../server/db.js';
import {
  getPagination,
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
import { resolveOwnerUser } from '../server/core-model.js';
import { validateActivity } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { notifyAssignment, notifyMentions } from '../server/notifications.js';
import { assertAssignableOwner, assertCrmTargetAccess, canAccessAllRecords } from '../server/authorization.js';

const ACTIVITY_BUCKETS = ['today', 'overdue', 'upcoming', 'completed', 'all'];

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const accessAll = canAccessAllRecords(workspace);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search', 160);
      const type = getQueryString(req.query, 'type', 80);
      const bucket = getQueryEnum(req.query, 'bucket', ACTIVITY_BUCKETS);
      const owner = getQueryString(req.query, 'owner', 256);
      const ownerUserId = owner === 'me' ? userId : owner;
      const leadId = getQueryUuid(req.query, 'lead_id');
      const accountId = getQueryUuid(req.query, 'account_id');
      const contactId = getQueryUuid(req.query, 'contact_id');
      const dealId = getQueryUuid(req.query, 'deal_id');
      const orderBy = getSort(req.query, {
        due: 'a.due_at',
        created: 'a.created_at',
        priority: 'a.priority',
        type: 'a.type',
      }, 'due', 'asc', 'a.id');
      const rows = await sql`
        SELECT a.id, a.workspace_id, a.user_id, a.lead_id, a.account_id, a.contact_id, a.deal_id,
               a.type, a.subject, a.description, a.message, a.due_at, a.completed_at,
               a.priority, a.owner_user_id, a.outcome, a.created_by, a.timestamp,
               a.created_at, a.updated_at,
               l.name AS lead_name, ac.name AS account_name, c.name AS contact_name,
               d.name AS deal_name, COUNT(*) OVER() AS __total_count
        FROM activities a
        LEFT JOIN leads l ON l.id = a.lead_id AND l.workspace_id = a.workspace_id
        LEFT JOIN accounts ac ON ac.id = a.account_id AND ac.workspace_id = a.workspace_id
        LEFT JOIN contacts c ON c.id = a.contact_id AND c.workspace_id = a.workspace_id
        LEFT JOIN deals d ON d.id = a.deal_id AND d.workspace_id = a.workspace_id
        WHERE a.workspace_id = ${workspace.id}
          AND (${accessAll} OR a.owner_user_id = ${userId})
          AND (${search}::text IS NULL OR a.subject ILIKE ${search ? `%${search}%` : null}
            OR a.description ILIKE ${search ? `%${search}%` : null}
            OR a.message ILIKE ${search ? `%${search}%` : null}
            OR l.name ILIKE ${search ? `%${search}%` : null}
            OR ac.name ILIKE ${search ? `%${search}%` : null}
            OR c.name ILIKE ${search ? `%${search}%` : null}
            OR d.name ILIKE ${search ? `%${search}%` : null})
          AND (${type}::text IS NULL OR a.type = ${type})
          AND (${ownerUserId}::text IS NULL OR a.owner_user_id = ${ownerUserId})
          AND (${leadId}::uuid IS NULL OR a.lead_id = ${leadId})
          AND (${accountId}::uuid IS NULL OR a.account_id = ${accountId})
          AND (${contactId}::uuid IS NULL OR a.contact_id = ${contactId})
          AND (${dealId}::uuid IS NULL OR a.deal_id = ${dealId})
          AND (
            ${bucket}::text IS NULL OR ${bucket} = 'all'
            OR (${bucket} = 'today' AND (timezone(${workspace.timezone}, COALESCE(a.due_at, a.created_at)))::date = (CURRENT_TIMESTAMP AT TIME ZONE ${workspace.timezone})::date)
            OR (${bucket} = 'overdue' AND a.completed_at IS NULL AND a.due_at < CURRENT_TIMESTAMP)
            OR (${bucket} = 'upcoming' AND a.completed_at IS NULL AND a.due_at >= CURRENT_TIMESTAMP)
            OR (${bucket} = 'completed' AND a.completed_at IS NOT NULL)
          )
        ORDER BY ${sql.unsafe(orderBy)}
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data.map(mapActivityRow), pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateActivity(req.body);
      await assertCrmTargetAccess(sql, workspace, userId, input);
      assertAssignableOwner(workspace, userId, input.owner_user_id);
      await assertActivityReferences(sql, workspace.id, input);
      const ownerUserId = await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id);
      const subject = input.subject || input.message || input.type;
      const description = input.description ?? input.message ?? subject;
      const message = (input.message || description || subject).slice(0, 2_000);
      const completedAt = input.completed_at ?? (input.completed ? new Date().toISOString() : null);
      const rows = await sql`
        INSERT INTO activities (
          workspace_id, user_id, lead_id, account_id, contact_id, deal_id, type,
          subject, description, message, due_at, completed_at, priority,
          owner_user_id, outcome, created_by, timestamp, created_at, updated_at
        )
        VALUES (
          ${workspace.id}, ${userId}, ${input.lead_id ?? null}, ${input.account_id ?? null},
          ${input.contact_id ?? null}, ${input.deal_id ?? null}, ${input.type},
          ${subject}, ${description}, ${message}, ${input.due_at ?? null}, ${completedAt},
          ${input.priority || 'normal'}, ${ownerUserId}, ${input.outcome ?? null}, ${userId},
          NOW(), NOW(), NOW()
        )
        RETURNING *
      `;
      await Promise.all([
        notifyAssignment(sql, {
          workspaceId: workspace.id, actorUserId: userId, recipientUserId: ownerUserId,
          resource: 'activities', entityId: rows[0].id,
          title: `Activity assigned: ${subject}`,
        }),
        notifyMentions(sql, {
          workspaceId: workspace.id, actorUserId: userId,
          text: `${description || ''}\n${message || ''}`,
          entityType: 'activity', entityId: rows[0].id, actionUrl: '/my-day',
        }),
      ]);
      return json(res, 201, { data: mapActivityRow(rows[0]) });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`
      SELECT * FROM activities WHERE id = ${id} AND workspace_id = ${workspace.id}
        AND (${accessAll} OR owner_user_id = ${userId})
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Activity not found.');

    if (req.method === 'PUT') {
      const input = validateActivity(req.body, { partial: true });
      await assertCrmTargetAccess(sql, workspace, userId, input);
      assertAssignableOwner(workspace, userId, input.owner_user_id);
      await assertActivityReferences(sql, workspace.id, input);
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      const ownerUserId = has('owner_user_id')
        ? await resolveOwnerUser(sql, workspace.id, userId, input.owner_user_id)
        : existing.owner_user_id;
      const completedAt = has('completed')
        ? (input.completed ? new Date().toISOString() : null)
        : has('completed_at') ? input.completed_at : existing.completed_at;
      const subject = has('subject')
        ? input.subject || input.message || existing.subject
        : existing.subject;
      const description = has('description')
        ? input.description
        : existing.description;
      const message = has('message')
        ? input.message || description || subject
        : has('description') ? (description || subject).slice(0, 2_000) : existing.message;
      const rows = await sql`
        UPDATE activities
        SET
          lead_id = ${has('lead_id') ? input.lead_id : existing.lead_id},
          account_id = ${has('account_id') ? input.account_id : existing.account_id},
          contact_id = ${has('contact_id') ? input.contact_id : existing.contact_id},
          deal_id = ${has('deal_id') ? input.deal_id : existing.deal_id},
          type = ${has('type') ? input.type : existing.type},
          subject = ${subject},
          description = ${description},
          message = ${message},
          due_at = ${has('due_at') ? input.due_at : existing.due_at},
          completed_at = ${completedAt},
          priority = ${has('priority') ? input.priority : existing.priority},
          owner_user_id = ${ownerUserId},
          outcome = ${has('outcome') ? input.outcome : existing.outcome},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING *
      `;
      await Promise.all([
        ownerUserId !== existing.owner_user_id
          ? notifyAssignment(sql, {
              workspaceId: workspace.id, actorUserId: userId, recipientUserId: ownerUserId,
              resource: 'activities', entityId: rows[0].id,
              title: `Activity assigned: ${subject}`,
            })
          : null,
        (has('description') || has('message'))
          ? notifyMentions(sql, {
              workspaceId: workspace.id, actorUserId: userId,
              text: `${description || ''}\n${message || ''}`,
              entityType: 'activity', entityId: rows[0].id, actionUrl: '/my-day',
            })
          : null,
      ]);
      return json(res, 200, { data: mapActivityRow(rows[0]) });
    }

    await sql`DELETE FROM activities WHERE id = ${id} AND workspace_id = ${workspace.id}`;
    return noContent(res);
  },
});

async function assertActivityReferences(sql, workspaceId, input) {
  const references = [
    ['lead_id', 'leads', 'Lead'],
    ['account_id', 'accounts', 'Account'],
    ['contact_id', 'contacts', 'Contact'],
    ['deal_id', 'deals', 'Deal'],
  ];
  for (const [field, table, label] of references) {
    if (!input[field]) continue;
    const rows = await sql`SELECT id FROM ${sql.unsafe(table)} WHERE id = ${input[field]} AND workspace_id = ${workspaceId}`;
    if (!rows[0]) throw new HttpError(400, 'invalid_reference', `${label} does not exist in this workspace.`);
  }
}

function mapActivityRow(row) {
  if (!row) return row;
  const {
    lead_name: leadName,
    account_name: accountName,
    contact_name: contactName,
    deal_name: dealName,
    __total_count: _totalCount,
    ...activity
  } = row;
  return {
    ...activity,
    completed: Boolean(activity.completed_at),
    lead: activity.lead_id ? { id: activity.lead_id, name: leadName } : null,
    account: activity.account_id ? { id: activity.account_id, name: accountName } : null,
    contact: activity.contact_id ? { id: activity.contact_id, name: contactName } : null,
    deal: activity.deal_id ? { id: activity.deal_id, name: dealName } : null,
  };
}
