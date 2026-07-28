# CRM Pro

CRM Pro is a tenant-isolated CRM for leads, pipeline management, meetings, customers, activities, quotes, and invoices. It uses React/Vite in the browser, Clerk for authentication, Vercel functions for the API, and PostgreSQL on Neon.

## Requirements

- Node.js 20 or newer
- A Clerk application
- A PostgreSQL/Neon database
- A Resend account only if invoice email is enabled

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill in `.env.local` before starting the app. Never expose `CLERK_SECRET_KEY`, `NEON_DATABASE_URL`, or `RESEND_API_KEY` through a `VITE_` variable; Vite variables are shipped to the browser.

For a fresh database, run [`schema.sql`](./schema.sql). For a database created with the original prototype schema, take a snapshot and apply [`migrations/002_production_hardening.sql`](./migrations/002_production_hardening.sql) once.

## Commands

```bash
npm run dev       # local development
npm test          # validation/security regression tests
npm run build     # optimized production build
npm run check     # tests followed by production build
npm run preview   # preview the built frontend
```

## Architecture

```text
Browser
  React + Clerk session
          |
          | Bearer session token
          v
Vercel API functions
  shared auth / validation / errors / pagination
          |
          | parameterized SQL + tenant predicates
          v
PostgreSQL / Neon
  tenant-safe foreign keys, constraints, indexes

Invoice email: API -> Resend
```

The browser never chooses `user_id`; API routes derive it from the verified Clerk token. Every query is tenant-scoped. Cross-entity writes additionally verify that the referenced lead/customer belongs to the same tenant, and the database enforces tenant-safe foreign keys for meetings and invoices.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the engineering review, ratings, decisions, and remaining production work.

## API contract

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

Single-resource responses use `{ "data": { ... } }`. Errors use an opaque request identifier that can be matched to server logs:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "requestId": "..."
  }
}
```

API inputs are bounded and validated. Invoice line totals and balances are calculated on the server rather than trusted from the browser.

## Production deployment

1. Provision a production Clerk instance and use production keys.
2. Apply the database schema or reviewed migration before deploying the API.
3. Set all variables from `.env.example` in the deployment environment. Set `CLERK_AUTHORIZED_PARTIES` to the exact production origin(s).
4. Configure a verified Resend sender in `INVOICE_FROM_EMAIL`, or leave invoice email disabled.
5. Run `npm run check` in CI and require it before merge.
6. Deploy to Vercel and verify sign-in, one CRUD path per resource, tenant isolation, and invoice delivery.
7. Configure database backups/PITR, log retention, uptime monitoring, and alerts.

## Security notes

- Secrets and local environment files are gitignored.
- Clerk tokens are strictly parsed and verified; authorized-party enforcement is available through configuration.
- API responses disable caching and include defensive response headers.
- Database errors and stack traces are not returned to clients.
- Relationship ownership checks prevent cross-tenant ID references.
- CSV export neutralizes spreadsheet formulas.
- Invoice email uses database-owned recipient/invoice data and validates the attached PDF.
- `npm audit --omit=dev` currently reports zero known production dependency vulnerabilities.

The API intentionally does not use an in-memory rate limiter because serverless instances cannot enforce a global quota. Add a durable limiter (for example, Redis-backed) before exposing costly operations at high volume.
