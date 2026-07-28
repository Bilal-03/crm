# Architecture review

## Executive assessment

The original project was a strong UI prototype but a weak production system: a single 4,000-line React module, inconsistent API response contracts, a schema/UI mismatch for invoices, unbounded collection reads, client-trusted financial values, and incomplete tenant checks on foreign IDs.

After this hardening pass, the overall architecture is **6.5/10**. The backend boundary, schema, and security model are now credible for an early production release. The frontend remains the largest maintainability constraint and keeps the score below production-mature territory.

| Area | Rating | Assessment |
|---|---:|---|
| API boundaries | 8/10 | Shared authentication, validation, errors, body limits, pagination, and consistent envelopes. |
| Data model | 7/10 | Constraints, indexes, tenant-safe foreign keys, consistent invoice fields, and a migration path. JSON arrays remain a scaling compromise. |
| Security | 7/10 | Tenant checks, strict tokens, safe errors, server-owned invoice math/email recipients, and defensive headers. Durable abuse controls remain. |
| Scalability | 6/10 | Bounded reads and indexes are present. Offset paging and browser-side analytics will degrade at high cardinality. |
| Reliability | 6/10 | Correct response mapping, rollback for key optimistic writes, server totals, and error boundaries. No queue or idempotency keys yet. |
| Testability | 5/10 | Core security/validation regression tests exist. Database integration and browser end-to-end coverage are still missing. |
| Frontend maintainability | 3/10 | The main JSX module is still far too large and mixes orchestration, UI, PDF generation, and domain logic. |
| Observability | 4/10 | Correlated structured API errors exist, but there is no tracing, metrics, error aggregation, or alerting integration. |

## Improvements implemented

- Added a shared server route boundary for Clerk authentication, request limits, method handling, safe errors, request IDs, pagination, and security headers.
- Rewrote all CRUD functions to validate and normalize input, scope every query by the authenticated tenant, return consistent envelopes, and distinguish missing records.
- Closed cross-tenant reference paths for meeting/activity lead IDs and invoice customer IDs.
- Rebuilt the PostgreSQL schema with constraints, composite tenant foreign keys, money/date types, uniqueness, and query indexes.
- Made the server authoritative for invoice numbers, line amounts, totals, payments, balances, and paid timestamps.
- Implemented the previously missing invoice email endpoint. It reads recipient data from the database and validates PDF type/size.
- Added a browser API client with timeouts and stable error handling, fixed initial data loading, and corrected Clerk user-field usage.
- Removed unused production dependencies, added lazy PDF loading and vendor chunking, and added hidden production source maps.
- Added an application error boundary, deployment headers, regression tests, and an explicit migration/runbook.

## Recommended next production work

### P0 — before a public/high-volume launch

1. Add a durable, per-user rate limiter to write and email endpoints. Keep quotas in Redis/Upstash or an API gateway, not function memory.
2. Add database integration tests that prove tenant A cannot reference/read/update tenant B records.
3. Add idempotency keys to invoice creation and email delivery to prevent duplicates during retries.
4. Integrate error reporting and metrics. Capture request ID, route, latency, status, database latency, and email-provider outcomes without logging CRM content.
5. Move invoice delivery to a queue with retry/backoff and a delivery-status table.

### P1 — maintainability and scale

1. Split `crm-system.jsx` by feature (`leads`, `pipeline`, `meetings`, `invoices`, `dashboard`) and extract domain hooks/services. Target modules below roughly 300 lines.
2. Migrate new modules to TypeScript and introduce generated request/response types shared between client and API.
3. Normalize notes, reminders, quote items, and invoice items into tables when concurrent editing, audit history, or large collections matter. Whole-array JSON updates can lose concurrent writes.
4. Replace offset pagination with keyset pagination for high-cardinality lists; move filtering/search and dashboard aggregates into server queries.
5. Add React Query/SWR for request cancellation, cache invalidation, retry policy, and mutation state rather than hand-maintained async state.
6. Lazy-load feature routes (especially analytics/charts) rather than only vendor chunks.

### P2 — engineering maturity

1. Add ESLint, Prettier, accessibility checks, and strict CI gates.
2. Add Playwright flows for authentication, lead CRUD, pipeline movement, invoice creation, and authorization failures.
3. Version APIs (`/api/v1`) before third-party consumers exist.
4. Add audit-log retention, data export/deletion workflows, and documented privacy/retention policies.
5. Automate forward-only migrations and production rollback/runbook drills.

## Intended target architecture

```text
Feature-split React application
  typed query/mutation layer
             |
             v
Versioned API/service layer
  auth + policy + validation + idempotency
             |
        +----+----------------+
        |                     |
        v                     v
PostgreSQL                 Durable queue
normalized domain          email/integrations
tables + audit log              |
        |                        v
        +--------------> Resend/provider

Telemetry across API, DB, queue, and provider
```

This target preserves the current stack while separating UI, domain policy, persistence, and side effects—the boundary needed for team development and predictable scaling.
