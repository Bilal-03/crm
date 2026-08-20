import { getDb } from '../server/db.js';
import {
  getPagination,
  getQueryEnum,
  getRequiredId,
  HttpError,
  json,
  withApiRoute,
} from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { materializeOverdueNotifications } from '../server/notifications.js';

export default withApiRoute({
  methods: ['GET', 'PUT'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      await materializeOverdueNotifications(sql, workspace.id, userId);
      const pagination = getPagination(req.query);
      const state = getQueryEnum(req.query, 'state', ['unread', 'read', 'all']) || 'all';
      const [rows, countRows] = await Promise.all([
        sql`
          SELECT id, type, title, body, entity_type, entity_id, action_url, metadata,
                 status, read_at, created_at
          FROM notifications
          WHERE workspace_id = ${workspace.id} AND recipient_user_id = ${userId}
            AND (${state} = 'all' OR status = ${state})
          ORDER BY created_at DESC, id DESC
          LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
        `,
        sql`
          SELECT COUNT(*)::int AS unread_count FROM notifications
          WHERE workspace_id = ${workspace.id} AND recipient_user_id = ${userId} AND status = 'unread'
        `,
      ]);
      return json(res, 200, { data: {
        items: rows,
        unreadCount: Number(countRows[0]?.unread_count || 0),
        pagination: { ...pagination, hasMore: rows.length === pagination.pageSize },
      } });
    }

    const action = req.body?.action;
    if (!['read', 'dismiss', 'read_all'].includes(action)) {
      throw new HttpError(400, 'validation_error', 'Notification action must be read, dismiss or read_all.');
    }
    if (action === 'read_all') {
      await sql`
        UPDATE notifications SET status = 'read', read_at = COALESCE(read_at, NOW())
        WHERE workspace_id = ${workspace.id} AND recipient_user_id = ${userId} AND status = 'unread'
      `;
      return json(res, 200, { data: { status: 'read' } });
    }
    const id = getRequiredId({ id: req.body?.id });
    const nextStatus = action === 'dismiss' ? 'dismissed' : 'read';
    const rows = await sql`
      UPDATE notifications SET status = ${nextStatus},
        read_at = CASE WHEN ${nextStatus} = 'read' THEN COALESCE(read_at, NOW()) ELSE read_at END
      WHERE id = ${id} AND workspace_id = ${workspace.id} AND recipient_user_id = ${userId}
      RETURNING id, type, title, body, entity_type, entity_id, action_url, metadata,
                status, read_at, created_at
    `;
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Notification not found.');
    return json(res, 200, { data: rows[0] });
  },
});
