import { getDb } from '../server/db.js';
import { financialAuditQuery, requireFinancialManager } from '../server/financial-records.js';
import { json, withApiRoute } from '../server/http.js';
import { validateFinancialSettings } from '../server/validation.js';
import { getActiveWorkspace } from '../server/workspaces.js';

export default withApiRoute({
  methods: ['GET', 'PUT'],
  async handler({ req, res, userId, requestId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const current = await getSettings(sql, workspace.id);
    if (req.method === 'GET') return json(res, 200, { data: { ...current, role: workspace.role } });

    requireFinancialManager(workspace);
    const input = validateFinancialSettings(req.body);
    const has = key => Object.prototype.hasOwnProperty.call(input, key);
    await sql.transaction([
      sql`
        UPDATE workspaces SET
          legal_name = CASE WHEN ${has('legal_name')} THEN ${input.legal_name ?? null} ELSE legal_name END,
          billing_email = CASE WHEN ${has('billing_email')} THEN ${input.billing_email ?? null} ELSE billing_email END,
          billing_phone = CASE WHEN ${has('billing_phone')} THEN ${input.billing_phone ?? null} ELSE billing_phone END,
          billing_address = CASE WHEN ${has('billing_address')} THEN ${JSON.stringify(input.billing_address ?? {})}::jsonb ELSE billing_address END,
          tax_registration_id = CASE WHEN ${has('tax_registration_id')} THEN ${input.tax_registration_id ?? null} ELSE tax_registration_id END,
          base_currency = CASE WHEN ${has('base_currency')} THEN ${input.base_currency ?? current.base_currency} ELSE base_currency END,
          quote_prefix = CASE WHEN ${has('quote_prefix')} THEN ${input.quote_prefix ?? current.quote_prefix} ELSE quote_prefix END,
          invoice_prefix = CASE WHEN ${has('invoice_prefix')} THEN ${input.invoice_prefix ?? current.invoice_prefix} ELSE invoice_prefix END,
          credit_note_prefix = CASE WHEN ${has('credit_note_prefix')} THEN ${input.credit_note_prefix ?? current.credit_note_prefix} ELSE credit_note_prefix END,
          default_quote_terms = CASE WHEN ${has('default_quote_terms')} THEN ${input.default_quote_terms ?? null} ELSE default_quote_terms END,
          default_invoice_terms = CASE WHEN ${has('default_invoice_terms')} THEN ${input.default_invoice_terms ?? null} ELSE default_invoice_terms END,
          updated_at = NOW()
        WHERE id = ${workspace.id}
        RETURNING id
      `,
      financialAuditQuery(sql, {
        workspaceId: workspace.id,
        actorUserId: userId,
        action: 'financial_settings.updated',
        entityType: 'financial_settings',
        beforeState: current,
        afterState: { ...current, ...input },
        requestId,
      }),
    ]);
    return json(res, 200, { data: { ...(await getSettings(sql, workspace.id)), role: workspace.role } });
  },
});

async function getSettings(sql, workspaceId) {
  const rows = await sql`
    SELECT id, name, legal_name, billing_email, billing_phone, billing_address,
           tax_registration_id, base_currency, timezone, quote_prefix,
           invoice_prefix, credit_note_prefix, default_quote_terms,
           default_invoice_terms, updated_at
    FROM workspaces WHERE id = ${workspaceId}
  `;
  return rows[0];
}
