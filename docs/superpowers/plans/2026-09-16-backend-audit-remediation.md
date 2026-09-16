# Backend audit remediation implementation plan

**Goal:** Implement the repository changes in the approved backend/database audit directly on `main`.
**Architecture:** Keep Next.js server actions and Prisma/PostgreSQL. Authorize every sensitive read, preserve transactional invariants, batch reads, bound growing lists and housekeeping, and retain portable schemas/migrations.
**Spec:** `readme/backend-database-audit-2026-09-16-cantonese.md` (user approved all remediation on main).

## Constraints

- Work in the existing main checkout; preserve concurrent/user changes. No production DB access, deployment or real customer emails.
- Read bundled Next.js docs before code changes; use Prisma-generated model types; update all three schemas for database changes.
- Write meaningful regression tests for security, transactions, recurrence, pagination/query bounds and retention. Use disposable PostgreSQL for concurrency and migration verification.
- Cloud-account MFA configuration, provider setup, access reviews, backup/restore and SOC 2 attestation require explicit operational evidence; do not mark them verified from code.

## Work and verification

- [x] Security: remove unverified guest claims; recover via existing single-use email reset proof. Add request-local auth dedupe, `requireAdmin`, fixed privileged expiry, revocable kiosk records and remote controls. Test rejected claims, revoked JWT/device, non-admin reads and legitimate recovery.
- [x] Booking/payroll: protect active-stylist/cap invariants inside booking transactions; batch payroll reads; serialize all period mutations and snapshot updates. Test retired staff, concurrent cap requests, finalize/adjust/recompute interleavings and rollback.
- [x] Calendar/workers: preserve recurrence timezone and exact EXDATE semantics; bulk atomic calendar reconciliation; independent bounded housekeeping; fail closed on unsupported Treatwell API path. Test UTC/TZID/DST/hourly/exclusions, rollback, caps, lease and expiry behavior.
- [x] Read paths: add fresh admin guards to every admin page/data entry; use primitive calendar DTOs, year aggregates, month summaries/day detail and cursor-paged global pending queue. Paginate customer history, admin customers/reviews/shifts/blog; keep links and search usable.
- [x] Public data: split list/detail/sitemap selects; cache repeated request lookups; correct sitemap failures/lastModified; narrow employee/review/category/slot projections and remove duplicated reads.
- [x] Database/operations: add supporting indexes, kiosk and audit models; repair provider migration replay; guard destructive seeds; add migration/diff/real-PG checks and dependency audit to CI. Provide audit events for sensitive admin changes and operational runbook.
- [x] Integrate: run all tests, lint, typecheck, three schema validations, PG migrations+diff, real-PG integration, production build and backend HTTP checks using synthetic local data only.
- [x] Record outcome: update structure registry and Cantonese remediation report mapping every audit item to code/tests or clearly stated external evidence still needed.

## Completion evidence

542/542 unit tests, full lint/typecheck/build, three schema validations, fresh PostgreSQL replay/diff, SQLite replay/diff, real PostgreSQL concurrency/rollback and production HTTP MFA/authorization/pagination checks passed. Dependency advisory audit reports zero. Calendar raw parameters explicitly normalize UTC for PostgreSQL timestamp columns, verified under three DB session timezones. SQL Server migration was generated/reviewed but not executed; cloud controls, operational restore evidence and formal SOC2 attestation remain explicitly outside code verification. All work stays in the main checkout; no production data or deployment was used.
