# CRM Pro

> A focused, production-ready CRM for managing leads, customers, sales pipelines, meetings, quotes, and invoices.

CRM Pro is a full-stack React application designed for small teams that need one place to manage customer relationships and revenue operations. The browser runs a Vite-powered React interface, authentication is handled by Clerk, serverless APIs run on Vercel, and application data is stored in PostgreSQL through Neon.

## What it includes

| Area | Capabilities |
| --- | --- |
| Dashboard | Revenue, pipeline, invoice, meeting, and priority-work summaries |
| Leads | Search, filtering, priority scoring, bulk actions, notes, reminders, quotes, and exports |
| Pipeline | Kanban and table views with drag-and-drop stage updates |
| Customers | Closed-won customer profiles and contact details |
| Meetings | Upcoming and past meetings, Google Calendar links, and Google Meet links |
| Revenue | Versioned quotes, protected invoice lifecycle, payments, credit notes, multi-currency PDFs, delivery history, and audit events |
| Reporting | Currency-safe forecasts, goals/quotas, pacing, forecast-versus-target, deal outcomes, stage conversion/aging, owner/source performance, and filtered CSV exports |
| Communications | Internal email compose, reusable templates, idempotent delivery/retry history, CRM timeline logging, and failure notifications |
| Automations | Trigger-condition-action workflows, idempotent jobs, retry backoff, dead-letter recovery, and audited manager controls |
| Authentication | Clerk sign-in with tenant-scoped data access |
| Notifications | In-app success and error feedback for important actions |

## Technology

- React 18 and Vite
- Tailwind CSS and Framer Motion
- Recharts for dashboard visualizations
- Clerk for authentication and session tokens
- Vercel Functions for the API layer
- Neon PostgreSQL for persistent data
- Resend through a provider-neutral adapter for optional CRM and invoice email delivery
- jsPDF and AutoTable for PDF quotes and invoices

## Architecture

```text
┌──────────────────────────────────────────────┐
│ Browser                                      │
│ React + Clerk + Tailwind + Recharts          │
└──────────────────────┬───────────────────────┘
                       │ Bearer session token
                       ▼
┌──────────────────────────────────────────────┐
│ Vercel serverless API                        │
│ Auth • validation • pagination • errors      │
└──────────────────────┬───────────────────────┘
                       │ Parameterized SQL
                       ▼
┌──────────────────────────────────────────────┐
│ Neon PostgreSQL                              │
│ Workspace-scoped leads, meetings, customers, │
│ activities, invoices, and relationships      │
└──────────────────────────────────────────────┘

Invoice email: API → Resend
```

The API derives the authenticated user from the verified Clerk token. The browser never supplies its own `user_id`, and all database queries are scoped to the active workspace. Owners and admins can access workspace-wide records; members are restricted to records assigned to them. Relationship writes verify both workspace membership and record access before creating linked data.

## Repository layout

```text
.
├── api/                    # Single catch-all Vercel API function
├── routes/                 # Workspace-scoped API endpoint handlers
├── server/                 # Shared API, auth, database, and validation logic
├── src/                    # React entrypoint, styles, and error boundary
├── crm-system.jsx          # Main CRM interface and feature components
├── schema.sql              # Fresh PostgreSQL schema
├── migrations/             # Safe updates for existing databases
├── index.html              # Vite document shell
├── package.json            # Scripts and dependencies
├── package-lock.json       # Locked dependency graph
├── vite.config.js          # Vite build configuration
├── tailwind.config.js      # Tailwind configuration
├── postcss.config.js       # PostCSS configuration
└── vercel.json             # Deployment security headers
```

## Requirements

- Node.js 20 or newer
- npm
- A Clerk application
- A PostgreSQL database, preferably Neon
- A Resend account if invoice email is enabled

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local` with the values for your environment. Never expose server secrets through variables prefixed with `VITE_`; Vite ships those values to the browser.

### 3. Prepare the database

For a new database:

```bash
psql "$NEON_DATABASE_URL" -f schema.sql
```

For an existing database created from the original prototype schema, create a backup and apply the reviewed migrations in order:

```bash
psql "$NEON_DATABASE_URL" -f migrations/002_production_hardening.sql
psql "$NEON_DATABASE_URL" -f migrations/003_workspace_foundation.sql
psql "$NEON_DATABASE_URL" -f migrations/004_team_settings.sql
psql "$NEON_DATABASE_URL" -f migrations/005_phase0_data_correctness.sql
psql "$NEON_DATABASE_URL" -f migrations/006_phase2_core_model.sql
psql "$NEON_DATABASE_URL" -f migrations/007_phase4_productivity.sql
psql "$NEON_DATABASE_URL" -f migrations/008_phase5_quote_to_cash.sql
psql "$NEON_DATABASE_URL" -f migrations/009_phase7_communications.sql
psql "$NEON_DATABASE_URL" -f migrations/010_phase6_goals_quotas.sql
psql "$NEON_DATABASE_URL" -f migrations/011_phase7_google_calendar.sql
psql "$NEON_DATABASE_URL" -f migrations/012_phase7_completion.sql
psql "$NEON_DATABASE_URL" -f migrations/013_phase8_automation.sql
psql "$NEON_DATABASE_URL" -f migrations/014_phase8_security.sql
```

`schema.sql` is the canonical fresh-database schema and includes the latest team-invitation, reporting, CRM core, productivity, quote-to-cash, and Phase 7 communication structures. The `schema_migrations` table records the reviewed migration versions. Never skip a migration on an existing database.

After migration, validate the Phase 0 backfill with:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;
SELECT COUNT(*) FILTER (WHERE stage = 'closed-won' AND won_at IS NULL) AS missing_won_dates,
       COUNT(*) FILTER (WHERE stage = 'closed-lost' AND lost_at IS NULL) AS missing_lost_dates
FROM leads;
```

For the Phase 2 backfill, verify that every legacy lead has a deal, stage-history row, contact and account before deploying the new CRM APIs:

```sql
SELECT COUNT(*) AS legacy_leads,
       COUNT(DISTINCT d.id) AS migrated_deals,
       COUNT(DISTINCT h.id) AS migrated_stage_history
FROM leads l
LEFT JOIN deals d ON d.workspace_id = l.workspace_id AND d.source_lead_id = l.id
LEFT JOIN deal_stage_history h ON h.workspace_id = l.workspace_id AND h.source_lead_id = l.id;
```

Phase 2 adds normalized fields and new core CRM tables without dropping legacy records. If validation fails, stop deployment and restore the pre-migration snapshot; do not manually delete the new columns or tables from a live database.

After applying Phase 7, verify the migration and delivery constraints before enabling internal email:

```sql
SELECT version, applied_at FROM schema_migrations WHERE version = '009_phase7_communications';
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('communication_integrations', 'email_templates', 'outbound_messages', 'notifications');
SELECT conname FROM pg_constraint
WHERE conname IN ('outbound_messages_target_check', 'meetings_workspace_integration_fk');
```

After migration 010, confirm the quota table and version are present:

```sql
SELECT version, applied_at FROM schema_migrations WHERE version = '010_phase6_goals_quotas';
SELECT conname FROM pg_constraint WHERE conrelid = 'sales_goals'::regclass;
```

After migration 011, confirm the encrypted credential/state tables and meeting duration field are present:

```sql
SELECT version, applied_at FROM schema_migrations WHERE version = '011_phase7_google_calendar';
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('integration_credentials', 'integration_oauth_states');
SELECT column_name FROM information_schema.columns
WHERE table_name = 'meetings' AND column_name = 'end_time';
```

The Phase 7 migrations are additive. If application rollback is required, deploy the previous application version and retain the new tables so message and sync history is not destroyed. OAuth tokens are encrypted at rest with `INTEGRATION_TOKEN_ENCRYPTION_KEY`; never rotate that key without first planning to reconnect every Google account.

### 4. Start the application

```bash
npm run dev
```

Open the local Vite URL shown in the terminal, normally `http://localhost:5173`.

## Environment variables

| Variable | Required | Purpose |
| --- | ---: | --- |
| `VITE_CLERK_DEPLOYMENT_MODE` | No | Set to `development` only for a deliberate non-production deployment |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Safe Clerk browser publishable key |
| `CLERK_DEPLOYMENT_MODE` | No | Server-side deployment mode; defaults safely to production when deployed |
| `CLERK_SECRET_KEY` | Yes | Server-side Clerk token verification |
| `CLERK_JWT_KEY` | No | Optional PEM key for networkless verification |
| `CLERK_AUTHORIZED_PARTIES` | Yes in production | Exact allowed frontend origin(s) |
| `NEON_DATABASE_URL` | Yes | PostgreSQL connection string |
| `RESEND_API_KEY` | Optional | Enables Resend-backed CRM and invoice email delivery |
| `RESEND_WEBHOOK_SECRET` | Required for delivery tracking | Verifies Resend delivery/bounce webhook signatures |
| `INVOICE_FROM_EMAIL` | Optional | Verified sender for invoice emails |
| `CRM_EMAIL_PROVIDER` | Optional | Provider-neutral CRM email adapter selection; currently `resend` |
| `CRM_FROM_EMAIL` | Required for CRM email | Verified sender for internal CRM compose; falls back to `INVOICE_FROM_EMAIL` |
| `APP_BASE_URL` | Required for Calendar | Exact public CRM origin used after the OAuth callback |
| `GOOGLE_CLIENT_ID` | Required for Calendar | Google OAuth web application client ID |
| `GOOGLE_CLIENT_SECRET` | Required for Calendar | Server-only Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Required for Calendar | Exact callback registered in Google Cloud, ending in `/api/integrations/google-calendar/callback` |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | Required for Calendar | Base64-encoded 32-byte key used for authenticated token encryption |
| `CRON_SECRET` | Required for automations | Bearer secret used by the Vercel automation cron |

Use `.env.example` as the canonical variable list. Keep `.env`, `.env.local`, and production secret values out of Git.

For local development or a deliberately non-production personal deployment, set both deployment-mode variables to `development` and use test Clerk keys (`pk_test_…` and `sk_test_…`). This mode is not suitable for sensitive data or a production release. For a real production deployment, leave the mode variables unset or set them to `production`, use `pk_live_…` and `sk_live_…`, configure a verified Clerk production domain, and set `CLERK_AUTHORIZED_PARTIES` to the exact HTTPS origin. Do not commit either key.

## Available commands

```bash
npm run dev       # Start the local Vite development server
npm run build     # Create the optimized production bundle
npm run preview   # Preview the production bundle locally
npm run lint      # Parse-check server, API, test, and utility JavaScript files
npm run test      # Run unit and API contract tests
npm run test:e2e  # Run deployed authenticated smoke checks when E2E variables are set
npm run check     # Run lint, tests, and the production build verification
npm run smoke:fresh-db # Verify the required Phase 2 schema on an isolated database
```

## API resources

| Endpoint | Operations | Purpose |
| --- | --- | --- |
| `/api/leads` | GET, POST, PUT, DELETE | Lead records, stages, notes, reminders, and quote items |
| `/api/customers` | GET, POST | Customer records and lead-to-customer promotion |
| `/api/accounts` | GET, POST, PUT, DELETE | Workspace-scoped account records and matching fields |
| `/api/contacts` | GET, POST, PUT, DELETE | Workspace-scoped contacts and account relationships |
| `/api/pipelines` | GET, POST, PUT, DELETE | Configurable pipelines and stage metadata |
| `/api/deals` | GET, POST, PUT, DELETE | Deal records, real amounts, weighted values, and stage history |
| `/api/deals/summary` | GET | Pipeline, weighted, forecast, and closed totals by currency |
| `/api/leads/convert` | POST | Idempotent lead-to-account/contact/deal conversion |
| `/api/meetings` | GET, POST, PUT, DELETE | Meeting scheduling and relationship ownership checks |
| `/api/activities` | GET, POST, PUT, DELETE | First-class activities with My Day, overdue, upcoming, completed, owner and related-record filters |
| `/api/notes` | GET, POST, PUT, DELETE | Attributed notes for leads, accounts, contacts and deals |
| `/api/saved-views` | GET, POST, PUT, DELETE | Private and shared saved resource views |
| `/api/search` | GET | Authorized global search across CRM records, activities, quotes and invoices |
| `/api/assign` | POST | Workspace-checked bulk record assignment |
| `/api/imports` | POST | CSV/XLSX row preview, dry run, validation and transactional import |
| `/api/duplicates` | GET, POST | Duplicate review and transactional merge with linked-record preservation |
| `/api/invoices` | GET, POST, PUT, DELETE | Invoice lifecycle, totals, balances, and payment status |
| `/api/invoices/actions` | POST | Cancel or void invoices and issue credit notes through protected lifecycle actions |
| `/api/quotes` | GET, POST, PUT, DELETE | Versioned, deal-linked quotes and calculated tax components |
| `/api/quotes/actions` | POST | Quote transitions, revisions, and accepted quote-to-invoice conversion |
| `/api/payments` | GET, POST | Payment ledger and derived invoice reconciliation |
| `/api/payments/actions` | POST | Permission-controlled payment voiding |
| `/api/financial-settings` | GET, PUT | Company identity, currency, numbering prefixes, and document terms |
| `/api/financial-events` | GET | Immutable audit events and invoice delivery history |
| `/api/leads/bulk` | POST | Transactional bulk lead update/delete |
| `/api/dashboard` | GET | Tenant-scoped dashboard aggregates and trends |
| `/api/reports` | GET | Tenant-scoped Deal, Stage History, Activity, Invoice and Payment aggregates with server-side date, currency, owner, pipeline and source filters |
| `/api/reports/export` | GET | Bounded, filtered export rows for management-report CSV downloads |
| `/api/goals` | GET, POST, PUT, DELETE | Manager-controlled team/owner quotas with event-based attainment, pacing and forecast-versus-target calculations |
| `/api/messages` | GET, POST | Tenant-scoped outbound email history, idempotent sending, retries, failures, and timeline logging |
| `/api/email-templates` | GET, POST, PUT, DELETE | Shared workspace email templates with archive-safe lifecycle |
| `/api/communication-status` | GET | Non-secret provider configuration and connection health |
| `/api/notifications` | GET, PUT | Current-user notification feed and read/dismiss actions |
| `/api/automations` | GET, POST, PUT, DELETE | Manager-controlled workflow rules, job visibility, manual runs, and dead-letter retry |
| `/api/automation-worker` | GET, POST | Cron-secret protected scheduled-event scan and job worker |
| `/api/webhooks/resend` | POST | Signature-verified provider delivery-state callbacks |
| `/api/integrations/google-calendar/connect` | POST | Starts state-bound Google OAuth authorization |
| `/api/integrations/google-calendar/callback` | GET | Consumes the one-time OAuth callback and stores encrypted credentials |
| `/api/integrations/google-calendar/disconnect` | POST | Revokes access and removes local credentials |
| `/api/calendar-events` | POST | Idempotently syncs or deletes a CRM meeting in Google Calendar |
| `/api/send-invoice-email` | POST | Generates and sends an invoice email through Resend |

Collection responses use a consistent envelope:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 500,
    "totalPages": 20,
    "hasMore": true,
    "nextPage": 2,
    "limit": 25,
    "offset": 0,
    "nextOffset": 25
  }
}
```

Collection endpoints accept `page`, `pageSize`, `search`, resource-specific filters, `sort`, and `direction`. Legacy `limit`/`offset` parameters remain accepted during the Phase 0 compatibility window. The browser client retains pagination metadata and requests additional pages rather than silently treating the first page as the complete dataset.

Errors use a safe message and request ID for server-log correlation:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "requestId": "..."
  }
}
```

## Deployment

The project is configured for Vercel deployment.

1. Connect the GitHub repository to Vercel.
2. Select the `main` branch for production deployments.
3. Add every variable from `.env.example` to the Vercel project settings.
4. Set `CLERK_AUTHORIZED_PARTIES` to the exact production origin.
5. Apply `schema.sql` for a new database, or apply every reviewed migration in order before deploying API changes.
6. Configure Clerk for the intended deployment mode. This project is deliberately remaining in development mode for the current rollout, so retain the existing test keys and `development` mode variables; the browser warning is expected. Before handling production customer data, replace them with live keys and complete the production-domain setup.
7. Configure a verified Resend sender if invoice email is enabled.
8. Run `npm run smoke:fresh-db` against a dedicated database and verify sign-in, one CRUD flow per resource, tenant isolation, PDF generation, dashboard totals, report totals, and invoice delivery.

Every push to the configured production branch can trigger a new deployment. Vercel also creates preview deployments for non-production branches when enabled.
