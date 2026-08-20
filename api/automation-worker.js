import { getDb } from '../server/db.js';
import { materializeScheduledAutomationEvents, processAutomationJobs } from '../server/automations.js';

export default async function automationWorker(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  const expected = process.env.CRON_SECRET;
  const actual = typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer\s+/i, '') : '';
  if (!expected || actual !== expected) return send(res, 401, { error: { code: 'unauthorized', message: 'A valid cron secret is required.' } });
  try {
    const sql = getDb();
    await materializeScheduledAutomationEvents(sql);
    const results = await processAutomationJobs(sql, { limit: 25 });
    return send(res, 200, { data: { processed: results.length, results } });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'automation_worker_failed', error: error instanceof Error ? error.message : String(error) }));
    return send(res, 500, { error: { code: 'worker_failed', message: 'Automation worker could not complete.' } });
  }
}

function send(res, status, payload) { res.statusCode = status; return res.end(JSON.stringify(payload)); }
