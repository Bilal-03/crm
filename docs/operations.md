# CRM Pro operations runbook

## Deployment order

1. Create a Neon restore point or branch from the current production branch.
2. Apply migrations in numeric order. For this release, apply `012_phase7_completion.sql`, `013_phase8_automation.sql`, then `014_phase8_security.sql`.
3. Keep the existing Clerk development keys and deployment-mode variables for this rollout. The Clerk development warning is expected and must not be treated as a failed deployment check.
4. Confirm the versions exist in `schema_migrations` and the transaction committed.
5. Add `RESEND_WEBHOOK_SECRET` and `CRON_SECRET` to Vercel. Keep the existing Clerk development variables unchanged for this deployment.
6. In Resend, create a webhook for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.suppressed`, and `email.complained` at `https://<app-domain>/api/webhooks/resend`.
7. Deploy, then run the smoke and manual checks below.

## Verification

```sql
SELECT version, applied_at FROM schema_migrations
WHERE version IN ('012_phase7_completion', '013_phase8_automation', '014_phase8_security')
ORDER BY version;

SELECT status, COUNT(*) FROM automation_jobs GROUP BY status ORDER BY status;
SELECT status, COUNT(*) FROM outbound_messages GROUP BY status ORDER BY status;
```

Run `npm run check`. For a deployed authenticated smoke test, set `E2E_BASE_URL`, `E2E_CLERK_TOKEN`, and optionally `E2E_WORKSPACE_ID`, then run `npm run test:e2e`.

Manual critical path:

1. Sign in and open Dashboard, Leads, My Day, Communications, Reports, and Automations.
2. Create a lead and confirm a matching active automation produces one job and only one set of actions.
3. Move a deal to a different stage and then Closed Won; confirm both trigger types appear.
4. Run automations manually and confirm overdue activity/invoice events are deduplicated.
5. Send an email and confirm the Resend webhook changes `sent` to `delivered`, or creates a recoverable failure notification.
6. Verify a member sees assigned records only and an owner/admin sees all workspace records.

## Failure and dead-letter recovery

- Inspect Automations → Recent jobs. Pending/retry jobs run automatically; exhausted jobs show as `dead_letter`.
- Correct the underlying owner, stage, template, provider, or record data, then select Retry. Successful action steps are not repeated.
- Vercel logs are structured JSON. Filter by `event`, `requestId`, or `automation_worker_failed`.
- Never delete automation events or action runs to force a retry; that removes the idempotency evidence.

## Backup and rollback

- Application rollback: deploy the previous Git commit. Keep additive Phase 7/8 tables intact so delivery, audit, and job history remain recoverable.
- Database rollback: restore the Neon branch/restore point only if the migration transaction itself failed or corrupted data. Do not manually drop individual new tables in production.
- Before restoring, export post-snapshot `outbound_messages`, `automation_events`, `automation_jobs`, `automation_action_runs`, and `audit_events` if they contain business activity that must be replayed.
- `INTEGRATION_TOKEN_ENCRYPTION_KEY` must be restored with the database. Losing or rotating it requires every Google Calendar account to reconnect.

## Retention

- Retain audit and financial history according to company policy and applicable law.
- Expired `api_rate_limit_counters` may be deleted safely after seven days.
- OAuth states may be deleted after their expiry plus seven days; active encrypted credentials must never be purged by a generic cleanup job.
