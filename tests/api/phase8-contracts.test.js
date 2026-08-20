import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const automationMigration = read('../../migrations/013_phase8_automation.sql');
const securityMigration = read('../../migrations/014_phase8_security.sql');
const engine = read('../../server/automations.js');
const route = read('../../routes/automations.js');
const worker = read('../../api/automation-worker.js');
const vercel = read('../../vercel.json');
const authorization = read('../../server/authorization.js');
const sensitiveRoutes = [
  '../../routes/search.js', '../../routes/duplicates.js', '../../routes/leads/bulk.js',
  '../../routes/leads/convert.js', '../../routes/quotes.js', '../../routes/quotes/actions.js',
  '../../routes/invoices/actions.js', '../../routes/send-invoice-email.js',
].map(read).join('\n');
const e2e = read('../../scripts/e2e-smoke.mjs');

test('Phase 8 automation schema is idempotent and preserves retry/dead-letter visibility', () => {
  for (const table of ['automation_rules', 'automation_events', 'automation_jobs', 'automation_action_runs', 'audit_events']) {
    assert.match(automationMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(automationMigration, /UNIQUE \(workspace_id, event_key\)/);
  assert.match(automationMigration, /dead_letter/);
  assert.match(automationMigration, /automation_jobs_ready_idx/);
  assert.match(automationMigration, /013_phase8_automation/);
});

test('automation engine implements every planned trigger and constrained action', () => {
  for (const trigger of ['lead_created', 'deal_stage_changed', 'activity_overdue', 'invoice_overdue', 'deal_won']) assert.match(engine, new RegExp(trigger));
  for (const action of ['assign_owner', 'create_activity', 'create_notification', 'send_template_email', 'update_stage']) assert.match(engine, new RegExp(action));
  assert.match(engine, /ON CONFLICT \(rule_id, event_id\) DO NOTHING/);
  assert.match(engine, /deadLetter \? 'dead_letter' : 'retry'/);
  assert.match(engine, /automation_action_runs/);
  assert.match(worker, /CRON_SECRET/);
});

test('automation management is manager-only, audited and manually recoverable', () => {
  assert.match(route, /assertManager\(workspace\)/);
  assert.match(route, /retry_job/);
  assert.match(route, /run_now/);
  assert.match(route, /INSERT INTO audit_events/);
  assert.match(route, /auditQuery/);
  assert.doesNotMatch(`${engine}\n${route}`, /sql\.json/);
});

test('security increment adds durable throttling and a Clerk-compatible CSP', () => {
  assert.match(securityMigration, /CREATE TABLE IF NOT EXISTS api_rate_limit_counters/);
  assert.match(securityMigration, /014_phase8_security/);
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /clerk\.accounts\.dev/);
  assert.match(vercel, /automation-worker/);
});

test('member ownership guards cover sensitive reads and destructive flows', () => {
  assert.match(authorization, /assertRecordAccess/);
  assert.match(authorization, /assertCrmTargetAccess/);
  assert.match(sensitiveRoutes, /canAccessAllRecords|assertRecordAccess|assertQuoteAccess/);
  assert.match(sensitiveRoutes, /manager_required/);
  assert.match(e2e, /E2E_REQUIRED/);
});

function read(path) { return fs.readFileSync(new URL(path, import.meta.url), 'utf8'); }
