# Production readiness implementation — 11 September 2026

Scope approved in the salon audit follow-up: repair booking correctness, implement supported calendar connections and durable email notifications, and prepare an owner handover. Website requests remain PENDING until the salon confirms them. No deployment, production migration, account purchase, or customer test email is part of this local implementation.

## Design and acceptance criteria

1. Persist the final discounted price and duration at booking time. Reuse these snapshots for changes, availability, exports and customer messages. Concurrent cancellation, rescheduling and approval must not revive or overlap appointments. Password reset tokens must be consumed atomically.
2. Represent active external calendars per stylist and provider. Use supported ICS busy-time import/export; preserve occupied periods after failed imports. Make connection health and setup gaps visible. Do not claim an unsupported booking-write API or immediate synchronization. Prevent online booking when configured external calendars are stale or incomplete.
3. Save booking notifications in the same database transaction as the appointment change. Deliver with durable retries, leases and stable Resend idempotency keys. Skip obsolete messages, bound background work, and expose failures to administrators. Do not store password reset tokens in this queue.
4. Keep new scheduled jobs disabled until explicitly configured. Publish authenticated cron routes, operational diagnostics and a migration/deployment checklist. Keep email sender verification, working shared rate limiting and real platform subscription tests as required launch checks.
5. Provide a Cantonese salon visit checklist covering business-owned accounts, invitations, DNS, MFA, staff/service mapping, opening hours and real end-to-end acceptance testing.

## Validation

- Regression tests execute the affected source with I/O replaced or isolated test data. Cover price persistence, conflicting transitions, single-use resets, ICS parsing/failed import preservation, queue concurrency/retries and stale notification suppression.
- Validate all three Prisma schemas and inspect generated PostgreSQL migration SQL. Do not apply it to production during implementation.
- Run the complete test suite, lint, TypeScript check and production build. Inspect the administrator setup screens and public maintenance path where the local environment permits.
- Record passing checks separately from live external acceptance checks that require the salon owner's accounts.

## Rollout order

Obtain owner access → verify sender DNS and replace the broken Redis connection → review backup/restore and migration → deploy with online booking and new cron flags off → configure and test each active staff calendar → enable scheduled workers and observe their health → run an owner-approved test booking/confirmation/change/cancellation → enable online requests only after all launch checks pass.
