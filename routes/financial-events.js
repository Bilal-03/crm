import { getDb } from '../server/db.js';
import { getPagination, getQueryEnum, getQueryUuid, json, paginated, stripTotalCount, withApiRoute } from '../server/http.js';
import { getActiveWorkspace } from '../server/workspaces.js';
import { requireFinancialManager } from '../server/financial-records.js';

export default withApiRoute({
  methods: ['GET'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    requireFinancialManager(workspace);
    const pagination = getPagination(req.query);
    const entityType = getQueryEnum(req.query, 'entity_type', ['quote', 'invoice', 'payment', 'credit_note', 'financial_settings']);
    const entityId = getQueryUuid(req.query, 'entity_id');
    const resultType = getQueryEnum(req.query, 'type', ['audit', 'delivery']) || 'audit';
    if (resultType === 'delivery') {
      const rows = await sql`
        SELECT id, invoice_id, quote_id, recipient, provider, provider_message_id,
               status, sent_at, delivered_at, failed_at, failure_reason, retry_of_id,
               attempted_by, request_id, created_at, COUNT(*) OVER() AS __total_count
        FROM invoice_deliveries
        WHERE workspace_id = ${workspace.id}
          AND (${entityId}::uuid IS NULL OR invoice_id = ${entityId} OR quote_id = ${entityId})
        ORDER BY created_at DESC, id DESC
        LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
      `;
      const result = stripTotalCount(rows);
      return json(res, 200, paginated(result.data, pagination, result.total));
    }
    const rows = await sql`
      SELECT id, actor_user_id, action, entity_type, entity_id, before_state,
             after_state, request_id, created_at, COUNT(*) OVER() AS __total_count
      FROM financial_audit_events
      WHERE workspace_id = ${workspace.id}
        AND (${entityType}::text IS NULL OR entity_type = ${entityType})
        AND (${entityId}::uuid IS NULL OR entity_id = ${entityId})
      ORDER BY created_at DESC, id DESC
      LIMIT ${pagination.pageSize} OFFSET ${pagination.offset}
    `;
    const result = stripTotalCount(rows);
    return json(res, 200, paginated(result.data, pagination, result.total));
  },
});
