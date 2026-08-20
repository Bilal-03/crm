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
  stripTotalCount,
  withApiRoute,
} from '../server/http.js';
import { validateRecordNote } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { notifyMentions } from '../server/notifications.js';
import { canAccessAllRecords } from '../server/authorization.js';

const TARGETS = [
  ['lead_id', 'leads', 'Lead', 'user_id'],
  ['account_id', 'accounts', 'Account', 'owner_user_id'],
  ['contact_id', 'contacts', 'Contact', 'owner_user_id'],
  ['deal_id', 'deals', 'Deal', 'owner_user_id'],
];

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const accessAll = canAccessAllRecords(workspace);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search', 160);
      const filters = TARGETS.map(([field]) => [field, getQueryUuid(req.query, field)]);
      const rows = await sql`
        SELECT n.id, n.workspace_id, n.lead_id, n.account_id, n.contact_id, n.deal_id,
               n.author_user_id, n.created_by, n.body, n.created_at, n.updated_at,
               l.name AS lead_name, a.name AS account_name, c.name AS contact_name,
               d.name AS deal_name, COUNT(*) OVER() AS __total_count
        FROM record_notes n
        LEFT JOIN leads l ON l.id = n.lead_id AND l.workspace_id = n.workspace_id
        LEFT JOIN accounts a ON a.id = n.account_id AND a.workspace_id = n.workspace_id
        LEFT JOIN contacts c ON c.id = n.contact_id AND c.workspace_id = n.workspace_id
        LEFT JOIN deals d ON d.id = n.deal_id AND d.workspace_id = n.workspace_id
        WHERE n.workspace_id = ${workspace.id}
          AND (${accessAll} OR l.user_id = ${userId} OR a.owner_user_id = ${userId}
            OR c.owner_user_id = ${userId} OR d.owner_user_id = ${userId})
          AND (${search}::text IS NULL OR n.body ILIKE ${search ? `%${search}%` : null})
          AND (${filters[0][1]}::uuid IS NULL OR n.lead_id = ${filters[0][1]})
          AND (${filters[1][1]}::uuid IS NULL OR n.account_id = ${filters[1][1]})
          AND (${filters[2][1]}::uuid IS NULL OR n.contact_id = ${filters[2][1]})
          AND (${filters[3][1]}::uuid IS NULL OR n.deal_id = ${filters[3][1]})
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data.map(mapNoteRow), pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateRecordNote(req.body);
      await assertSingleTarget(sql, workspace.id, input, userId, accessAll);
      const rows = await sql`
        INSERT INTO record_notes (
          workspace_id, lead_id, account_id, contact_id, deal_id,
          author_user_id, created_by, body
        )
        VALUES (
          ${workspace.id}, ${input.lead_id ?? null}, ${input.account_id ?? null},
          ${input.contact_id ?? null}, ${input.deal_id ?? null},
          ${userId}, ${userId}, ${input.body}
        )
        RETURNING *
      `;
      await notifyMentions(sql, {
        workspaceId: workspace.id,
        actorUserId: userId,
        text: input.body,
        entityType: 'note',
        entityId: rows[0].id,
        actionUrl: targetUrl(input),
      });
      return json(res, 201, { data: mapNoteRow(rows[0]) });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`
      SELECT * FROM record_notes WHERE id = ${id} AND workspace_id = ${workspace.id}
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Note not found.');
    await assertSingleTarget(sql, workspace.id, existing, userId, accessAll);
    assertCanEdit(existing, workspace.role, userId);

    if (req.method === 'PUT') {
      const input = validateRecordNote(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      const targetFields = TARGETS.map(([field]) => field);
      const hasTarget = targetFields.some(has);
      if (hasTarget) {
        const target = targetFields.filter(field => input[field]);
        if (target.length !== 1) throw new HttpError(400, 'validation_error', 'Exactly one record target is required.');
        await assertSingleTarget(sql, workspace.id, input, userId, accessAll);
      }
      const rows = await sql`
        UPDATE record_notes
        SET
          lead_id = ${hasTarget ? input.lead_id ?? null : existing.lead_id},
          account_id = ${hasTarget ? input.account_id ?? null : existing.account_id},
          contact_id = ${hasTarget ? input.contact_id ?? null : existing.contact_id},
          deal_id = ${hasTarget ? input.deal_id ?? null : existing.deal_id},
          body = ${has('body') ? input.body : existing.body},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING *
      `;
      if (has('body')) {
        await notifyMentions(sql, {
          workspaceId: workspace.id,
          actorUserId: userId,
          text: input.body,
          entityType: 'note',
          entityId: rows[0].id,
          actionUrl: targetUrl(rows[0]),
        });
      }
      return json(res, 200, { data: mapNoteRow(rows[0]) });
    }

    await sql`DELETE FROM record_notes WHERE id = ${id} AND workspace_id = ${workspace.id}`;
    return noContent(res);
  },
});

async function assertSingleTarget(sql, workspaceId, input, userId, accessAll) {
  const target = TARGETS.find(([field]) => input[field]);
  if (!target) throw new HttpError(400, 'validation_error', 'Exactly one record target is required.');
  const [, table, label, ownerColumn] = target;
  const rows = await sql`
    SELECT id FROM ${sql.unsafe(table)}
    WHERE id = ${input[target[0]]} AND workspace_id = ${workspaceId}
      AND (${accessAll} OR ${sql.unsafe(ownerColumn)} = ${userId})
  `;
  if (!rows[0]) throw new HttpError(403, 'record_access_denied', `${label} is not available to your role.`);
}

function assertCanEdit(note, role, userId) {
  if (note.author_user_id !== userId && !['owner', 'admin'].includes(role)) {
    throw new HttpError(403, 'note_permission_denied', 'Only the note author or a workspace manager can change this note.');
  }
}

function targetUrl(note) {
  if (note.lead_id) return '/leads';
  if (note.contact_id) return '/contacts';
  if (note.account_id) return '/accounts';
  return '/deals';
}

function mapNoteRow(row) {
  if (!row) return row;
  const {
    lead_name: leadName,
    account_name: accountName,
    contact_name: contactName,
    deal_name: dealName,
    __total_count: _totalCount,
    ...note
  } = row;
  const target = note.lead_id
    ? { resource: 'lead', id: note.lead_id, name: leadName }
    : note.account_id
      ? { resource: 'account', id: note.account_id, name: accountName }
      : note.contact_id
        ? { resource: 'contact', id: note.contact_id, name: contactName }
        : { resource: 'deal', id: note.deal_id, name: dealName };
  return { ...note, target };
}
