# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Harbour Hair Salon — a Next.js 16 booking website for a hair salon. Features public pages (home, services, booking, offers, contact), auth (signin/register), customer appointment management (view/cancel/reschedule), and an admin panel (users, offers, discounts, schedule calendar). Deployed on Vercel (Pro plan).

## Commands

```bash
pnpm dev              # Start dev server (localhost:3000)
pnpm build            # Production build
pnpm lint             # ESLint (core-web-vitals + typescript configs)

# Database (dev - SQLite)
pnpm db:dev:migrate   # Run dev migrations
pnpm db:dev:push      # Push schema changes without migration
pnpm db:dev:studio    # Open Prisma Studio
pnpm db:dev:generate  # Regenerate Prisma client

# Database (Vercel - PostgreSQL via Neon)
pnpm db:vercel:push     # Push schema to Vercel Postgres
pnpm db:vercel:deploy   # Deploy migrations to Vercel Postgres
pnpm db:vercel:studio   # Open Prisma Studio for Vercel DB
pnpm db:vercel:generate # Regenerate Prisma client for Vercel

# Database (prod - MS SQL Server, legacy Docker deployment)
pnpm db:prod:migrate  # Create prod migrations
pnpm db:prod:deploy   # Deploy prod migrations

# Deployment — production is deployed ONLY by GitHub Actions after CI passes
git push origin main  # (or merge a PR) → .github/workflows/deploy.yml tests, then deploys
# `vercel --prod` locally is refused by scripts/production-build-guard.mjs, and
# Vercel's own git builds are off (`git.deploymentEnabled: false` in vercel.json).
```

## Architecture

- **Framework**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Package manager**: pnpm
- **Database**: Prisma ORM with triple schema setup:
  - `prisma/dev/schema.prisma` — SQLite for local development
  - `prisma/vercel/schema.prisma` — PostgreSQL for Vercel deployment (Neon)
  - `prisma/prod/schema.prisma` — MS SQL Server (legacy Docker)
  - **Always edit all three schema files** when changing the database schema
- **Auth**: JWT sessions via `jose`, passwords hashed with `bcryptjs`. Session helpers in `src/app/lib/session.ts`. Route protection in `middleware.ts`.
- **Email**: Resend SDK with React Email templates. Service in `src/app/services/email-service.ts`, templates in `src/components/emails/`.
- **Validation**: Zod
- **Deployment**: Vercel (Pro plan) with Neon Postgres (**PostgreSQL 18, `eu-west-2`/London** since 2026-09-16 — moved from `us-east-1` to stop every query crossing the Atlantic; CI must test against the same major version). Four crons live in `vercel.json`: reminders (daily 08:00 UTC), notifications (`*/30 8-19` UTC, daytime only), calendar-sync (`*/30`, but the route skips ticks outside saved staff hours ±15 min before touching the DB) and housekeeping (daily 03:15 UTC). See "Neon compute budget" below before adding another; `neon-compute-budget.test.ts` pins these.

### Environment Variables

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` — Vercel Postgres (auto-injected by Neon)
- `DATABASE_URL` — Local SQLite (in `.env`)
- `SESSION_SECRET` — JWT signing key (required, no fallback)
- `RESEND_API_KEY` — Email service
- `CRON_SECRET` — Vercel cron auth (auto-injected)
- `TREATWELL_SYNC_ENABLED` — kill-switch for `/api/cron/treatwell-sync`. Unset/anything but `"true"` makes the route return before touching the DB. Deliberately off (see below).

### Neon compute budget (read before scheduling anything)

Neon bills **compute time (CU-hours), not queries**, and its free tier suspends the
compute endpoint after **5 minutes idle**. The dominant cost driver is therefore
*how often something touches the database*, not how heavy the work is. One
trivial query every 5 minutes costs far more than a heavy query once an hour,
because it keeps the endpoint from ever suspending.

This bit us in August 2026: a `*/5` Treatwell sync cron sat exactly on the
suspend threshold and held the compute awake 24/7 — roughly the entire monthly
CU-hour allowance — while doing literally nothing, since no stylist has ever had
`treatwellIcalUrl` set and `ExternalBusyBlock` was empty. Fixed by removing the
cron and gating the route behind `TREATWELL_SYNC_ENABLED`.

Rules that follow from this:

- **Any new cron needs an interval over 5 minutes** (30+ preferred) and a
  business-hours window where possible. Vercel cron schedules are **UTC**; the
  salon runs on Europe/London, so a year-round window must cover both GMT and
  BST — `*/30 9-19 * * *` covers Mon–Fri 10:00–19:30 and Sat–Sun 10:30–18:00
  local in either season. Short `*/10` runs can allow suspension, but consume
  roughly 90 CU-hours per 30-day month at 0.25 CU with a five-minute idle tail;
  aligned `*/30` runs start around 30 CU-hours before execution time and traffic.
- **Put cost kill-switches above the first DB call**, never below. Entering a
  function that opens with a query already wakes the compute, so an early return
  that sits after the query has bought nothing. `treatwell-sync/route.ts` has a
  test locking this ordering.
- **Keep public pages on ISR** (`export const revalidate`). They currently serve
  from cache and stay off the database; making one `force-dynamic` puts bot and
  crawler traffic directly onto Neon compute.
- **`/api/health` runs `SELECT 1` and is `force-dynamic`.** Never point a
  frequent uptime monitor at it — that alone would pin the compute awake 24/7,
  independent of any cron.
- **A public endpoint that something external polls is a cron you do not
  control.** These rules used to police `vercel.json` only, and that is how the
  August 2026 failure came back in September: Fresha and Treatwell both
  subscribe to `/api/ical/[stylistId]`, which was `force-dynamic` + `no-store`,
  so three stylist feeds were fetched twice each every five minutes — twelve
  queries per five minutes, forever, pinning the compute exactly as the old
  cron had. It is now served from the Data Cache (`stylist-ical-cache.ts`) and
  invalidated by `invalidateStylistIcalFeed()` on every appointment mutation.
  **A cache's timed expiry is itself a poll.** Its 30-minute safety net was
  still the largest Neon cost in September 2026 (~45 wakes, ~1.7 CU-h a day —
  about half the free plan), because every expiry turned the next marketplace
  poll into a wake. When mutations already invalidate a tag, keep the timed
  expiry to a day or more. Measure with Neon's operations log
  (`start_compute`/`suspend_compute`), not guesses.
  Before shipping any public route that touches the database, ask who polls it
  and how often, and check the runtime logs for the real cadence — not just
  `vercel.json`.
- `infra/aws/treatwell-sync/` is a **dormant** EventBridge→Lambda fallback for
  the same endpoint. Do not deploy it; see its README.

### Source Layout

- `src/app/` — Next.js App Router pages and API routes
  - `actions/` — Server actions organized by domain (`auth.ts`, `booking.ts`, `admin.ts`)
  - `lib/` — Shared utilities (`prisma.ts`, `session.ts`, `password.ts`)
  - `services/` — Business logic (`booking-service.ts`, `email-service.ts`)
  - `api/cron/reminders/` — Daily reminder cron endpoint
  - `api/health/` — Health check endpoint
  - `appointments/` — Customer booking management page
- `src/components/` — React components organized by feature (`home/`, `booking/`, `layout/`, `admin/`, `services/`, `appointments/`, `emails/`)
- `middleware.ts` — Route protection (admin, appointments, booking require auth)
- `prisma/` — Schema files, migrations, and seed scripts
- `vercel.json` — Cron job configuration
- `readme/structure.md` — Function/component registry

## Key Conventions

- **Server actions over API routes** for data operations. Place in `src/app/actions/`, use `'use server'` directive.
- **Use Prisma generated types** from `@prisma/client` — never create manual interfaces for database models.
- **Never access env vars at module level** — wrap in async functions for runtime access.
- **Email service uses `import 'server-only'`** — not `'use server'` (internal functions, not client-callable).
- **Booking requires authentication** — middleware redirects to signin with `?redirect=/book`.
- **24-hour cancellation/reschedule policy** — enforced server-side in booking actions.
- **Reschedule uses `$transaction` with Serializable isolation** — prevents double-booking race conditions.
- **Use regular `<img>` for external/CDN images**, `next/image` only for local `public/` assets.
- **Tailwind CSS only** for styling. Primary brand color: `#174F7F`.
- **readme/structure.md**: Check before creating new functions/components to avoid duplication.
