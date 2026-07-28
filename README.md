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
| Invoices | Draft, send, edit, download PDF, track payment status, and identify overdue balances |
| Authentication | Clerk sign-in with tenant-scoped data access |
| Notifications | In-app success and error feedback for important actions |

## Technology

- React 18 and Vite
- Tailwind CSS and Framer Motion
- Recharts for dashboard visualizations
- Clerk for authentication and session tokens
- Vercel Functions for the API layer
- Neon PostgreSQL for persistent data
- Resend for optional invoice email delivery
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
│ Tenant-scoped leads, meetings, customers,    │
│ activities, invoices, and relationships      │
└──────────────────────────────────────────────┘

Invoice email: API → Resend
```

The API derives the authenticated user from the verified Clerk token. The browser never supplies its own `user_id`, and all database queries are tenant-scoped. Relationship writes verify ownership before creating meetings or invoices.

## Repository layout

```text
.
├── api/                    # Vercel API entrypoints
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

For an existing database created from the original prototype schema, create a backup and apply the reviewed migration:

```bash
psql "$NEON_DATABASE_URL" -f migrations/002_production_hardening.sql
```

### 4. Start the application

```bash
npm run dev
```

Open the local Vite URL shown in the terminal, normally `http://localhost:5173`.

## Environment variables

| Variable | Required | Purpose |
| --- | ---: | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Yes | Safe Clerk browser publishable key |
| `CLERK_SECRET_KEY` | Yes | Server-side Clerk token verification |
| `CLERK_JWT_KEY` | No | Optional PEM key for networkless verification |
| `CLERK_AUTHORIZED_PARTIES` | Yes in production | Exact allowed frontend origin(s) |
| `NEON_DATABASE_URL` | Yes | PostgreSQL connection string |
| `RESEND_API_KEY` | Optional | Enables invoice email delivery |
| `INVOICE_FROM_EMAIL` | Optional | Verified sender for invoice emails |

Use `.env.example` as the canonical variable list. Keep `.env`, `.env.local`, and production secret values out of Git.

## Available commands

```bash
npm run dev       # Start the local Vite development server
npm run build     # Create the optimized production bundle
npm run preview   # Preview the production bundle locally
npm run check     # Run the production build verification
```

## API resources

| Endpoint | Operations | Purpose |
| --- | --- | --- |
| `/api/leads` | GET, POST, PUT, DELETE | Lead records, stages, notes, reminders, and quote items |
| `/api/customers` | GET, POST | Customer records and lead-to-customer promotion |
| `/api/meetings` | GET, POST, PUT, DELETE | Meeting scheduling and relationship ownership checks |
| `/api/activities` | GET, POST | Activity timeline records |
| `/api/invoices` | GET, POST, PUT, DELETE | Invoice lifecycle, totals, balances, and payment status |
| `/api/send-invoice-email` | POST | Generates and sends an invoice email through Resend |

Collection responses use a consistent envelope:

```json
{
  "data": [],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false,
    "nextOffset": null
  }
}
```

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
5. Apply `schema.sql` or the appropriate migration before the first production request.
6. Configure a verified Resend sender if invoice email is enabled.
7. Deploy and verify sign-in, one CRUD flow per resource, tenant isolation, PDF generation, and invoice delivery.

Every push to the configured production branch can trigger a new deployment. Vercel also creates preview deployments for non-production branches when enabled.

## Security posture

- Clerk tokens are verified server-side.
- User identity is derived from the authenticated session.
- Queries are tenant-scoped and use parameterized SQL.
- Cross-entity ownership is checked before writes.
- Invoice totals and balances are calculated server-side.
- CSV exports neutralize spreadsheet formulas.
- API responses include defensive security headers through `vercel.json`.
- Secrets and local environment files are excluded by `.gitignore`.
- Database and server errors are normalized before reaching the browser.

Before increasing traffic, add durable rate limiting for expensive operations and configure database backups, point-in-time recovery, monitoring, and alerting.

## Operational checklist

- [ ] Production Clerk keys are configured.
- [ ] Production origin is listed exactly in `CLERK_AUTHORIZED_PARTIES`.
- [ ] Database schema or migration has been applied.
- [ ] Neon backups or point-in-time recovery are enabled.
- [ ] Resend sender identity is verified if invoice email is used.
- [ ] Vercel environment variables are configured for the correct environments.
- [ ] Sign-in, CRUD, tenant isolation, invoice PDF, and email delivery have been smoke-tested.
- [ ] Monitoring and deployment notifications are enabled.

## License

No license has been declared yet. Add a `LICENSE` file before distributing this project outside its owning organization.
