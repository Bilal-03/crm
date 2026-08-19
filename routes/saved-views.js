import { getDb } from '../server/db.js';
import {
  getQueryEnum,
  getRequiredId,
  HttpError,
  json,
  noContent,
  withApiRoute,
} from '../server/http.js';
import { validateSavedView } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

const RESOURCES = ['leads', 'contacts', 'accounts', 'deals', 'activities', 'invoices'];

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const resource = getQueryEnum(req.query, 'resource', RESOURCES);
      const rows = await sql`
        SELECT id, workspace_id, owner_user_id, resource, name, filters, columns, sort,
               is_shared, is_pinned, created_at, updated_at
        FROM saved_views
        WHERE workspace_id = ${workspace.id}
          AND (${resource}::text IS NULL OR resource = ${resource})
          AND (owner_user_id = ${userId} OR is_shared = true)
        ORDER BY is_pinned DESC, updated_at DESC, id DESC
      `;
      return json(res, 200, { data: rows.map(row => mapView(row, userId)) });
    }

    if (req.method === 'POST') {
      const input = validateSavedView(req.body);
      if (input.is_shared) requireManager(workspace.role);
      const rows = await sql`
        INSERT INTO saved_views (
          workspace_id, owner_user_id, resource, name, filters, columns, sort, is_shared, is_pinned
        )
        VALUES (
          ${workspace.id}, ${userId}, ${input.resource}, ${input.name},
          ${JSON.stringify(input.filters)}::jsonb, ${JSON.stringify(input.columns)}::jsonb,
          ${JSON.stringify(input.sort)}::jsonb, ${input.is_shared}, ${input.is_pinned}
        )
        RETURNING id, workspace_id, owner_user_id, resource, name, filters, columns, sort,
                  is_shared, is_pinned, created_at, updated_at
      `;
      return json(res, 201, { data: mapView(rows[0], userId) });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`SELECT * FROM saved_views WHERE id = ${id} AND workspace_id = ${workspace.id}`;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Saved view not found.');
    assertCanManage(existing, workspace.role, userId);

    if (req.method === 'PUT') {
      const input = validateSavedView(req.body, { partial: true });
      const has = key => Object.prototype.hasOwnProperty.call(input, key);
      if (has('is_shared') && input.is_shared) requireManager(workspace.role);
      const rows = await sql`
        UPDATE saved_views
        SET
          resource = ${has('resource') ? input.resource : existing.resource},
          name = ${has('name') ? input.name : existing.name},
          filters = ${has('filters') ? JSON.stringify(input.filters) : JSON.stringify(existing.filters)}::jsonb,
          columns = ${has('columns') ? JSON.stringify(input.columns) : JSON.stringify(existing.columns)}::jsonb,
          sort = ${has('sort') ? JSON.stringify(input.sort) : JSON.stringify(existing.sort)}::jsonb,
          is_shared = ${has('is_shared') ? input.is_shared : existing.is_shared},
          is_pinned = ${has('is_pinned') ? input.is_pinned : existing.is_pinned},
          updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, workspace_id, owner_user_id, resource, name, filters, columns, sort,
                  is_shared, is_pinned, created_at, updated_at
      `;
      return json(res, 200, { data: mapView(rows[0], userId) });
    }

    await sql`DELETE FROM saved_views WHERE id = ${id} AND workspace_id = ${workspace.id}`;
    return noContent(res);
  },
});

function requireManager(role) {
  if (!['owner', 'admin'].includes(role)) {
    throw new HttpError(403, 'view_permission_denied', 'Only workspace owners and admins can share saved views.');
  }
}

function assertCanManage(view, role, userId) {
  if (view.owner_user_id !== userId && !['owner', 'admin'].includes(role)) {
    throw new HttpError(403, 'view_permission_denied', 'Only the view owner or a workspace manager can change this view.');
  }
}

function mapView(row, userId) {
  return { ...row, can_edit: row.owner_user_id === userId };
}
