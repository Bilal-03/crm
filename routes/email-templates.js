import { getDb } from '../server/db.js';
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
import { validateEmailTemplate } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);

    if (req.method === 'GET') {
      const pagination = getPagination(req.query);
      const search = getQueryString(req.query, 'search', 120);
      const state = getQueryEnum(req.query, 'state', ['active', 'inactive', 'all']) || 'active';
      const rows = await sql`
        SELECT id, name, subject, body_text, body_html, is_active,
               created_by, updated_by, created_at, updated_at,
               COUNT(*) OVER() AS __total_count
        FROM email_templates
        WHERE workspace_id = ${workspace.id}
          AND (${state} = 'all' OR is_active = (${state} = 'active'))
          AND (${search}::text IS NULL OR name ILIKE ${search ? `%${search}%` : null}
            OR subject ILIKE ${search ? `%${search}%` : null})
        ORDER BY updated_at DESC, id DESC
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }

    if (req.method === 'POST') {
      const input = validateEmailTemplate(req.body);
      const rows = await sql`
        INSERT INTO email_templates (
          workspace_id, name, subject, body_text, body_html, is_active, created_by, updated_by
        ) VALUES (
          ${workspace.id}, ${input.name}, ${input.subject}, ${input.body_text},
          ${input.body_html ?? null}, ${input.is_active ?? true}, ${userId}, ${userId}
        )
        RETURNING id, name, subject, body_text, body_html, is_active,
                  created_by, updated_by, created_at, updated_at
      `;
      return json(res, 201, { data: rows[0] });
    }

    const id = getRequiredId(req.query);
    const existingRows = await sql`
      SELECT * FROM email_templates WHERE id = ${id} AND workspace_id = ${workspace.id}
    `;
    const existing = existingRows[0];
    if (!existing) throw new HttpError(404, 'not_found', 'Email template not found.');

    if (req.method === 'DELETE') {
      const rows = await sql`
        UPDATE email_templates SET is_active = false, updated_by = ${userId}, updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspace.id}
        RETURNING id, name, subject, body_text, body_html, is_active,
                  created_by, updated_by, created_at, updated_at
      `;
      return json(res, 200, { data: rows[0] });
    }

    const input = validateEmailTemplate(req.body, { partial: true });
    const has = field => Object.prototype.hasOwnProperty.call(input, field);
    const rows = await sql`
      UPDATE email_templates SET
        name = ${has('name') ? input.name : existing.name},
        subject = ${has('subject') ? input.subject : existing.subject},
        body_text = ${has('body_text') ? input.body_text : existing.body_text},
        body_html = ${has('body_html') ? input.body_html : existing.body_html},
        is_active = ${has('is_active') ? input.is_active : existing.is_active},
        updated_by = ${userId}, updated_at = NOW()
      WHERE id = ${id} AND workspace_id = ${workspace.id}
      RETURNING id, name, subject, body_text, body_html, is_active,
                created_by, updated_by, created_at, updated_at
    `;
    return json(res, 200, { data: rows[0] });
  },
});
