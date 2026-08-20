import { getDb } from '../../server/db.js';
import { getRequiredId, HttpError, json, withApiRoute } from '../../server/http.js';
import { convertLeadToDeal } from '../../server/core-model.js';
import { validateLeadConversion } from '../../server/validation.js';
import { getActiveWorkspace } from '../../server/workspaces.js';
import { assertCrmTargetAccess, assertRecordAccess } from '../../server/authorization.js';

export default withApiRoute({
  methods: ['POST'],
  async handler({ req, res, userId }) {
    const sql = getDb();
    const workspace = await getActiveWorkspace(sql, userId, req.headers['x-workspace-id']);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const leadId = body.lead_id || (req.query?.id ? getRequiredId(req.query) : null);
    if (!leadId) throw new HttpError(400, 'invalid_id', 'A lead ID is required for conversion.');
    await assertRecordAccess(sql, workspace, userId, 'leads', 'user_id', leadId);
    const input = validateLeadConversion({ ...body, lead_id: leadId });
    await assertCrmTargetAccess(sql, workspace, userId, input);
    const result = await convertLeadToDeal(sql, workspace, userId, input);
    return json(res, result.converted ? 201 : 200, { data: result.deal, converted: result.converted });
  },
});
