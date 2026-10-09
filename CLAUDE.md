# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Harbour Hair Salon — a Next.js 16 booking website for a hair salon. Features public pages (home, services, booking, offers, contact), auth (signin/register), customer appointment management (view/cancel/request a reschedule), and an admin panel (users, offers, discounts, schedule calendar). Deployed on Vercel (Pro plan).

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
- **A page that reads `searchParams` is dynamic, whatever its `revalidate` says.**
  `/blog` (`?page=`) ran two Neon queries on every visit until 2026-09-29; its
  cards now come from one Data Cache entry per language (`BLOG_POSTS_TAG` in
  `blog-service.ts`, dropped by every blog/translation publish and by Admin →
  Settings → Save). A direct write (translation import, seed script, SQL) is
  NOT seen for up to 24 h — press Settings → Save or run
  `npx vercel cache invalidate --tag blog-posts --yes`. Any new dynamic public
  page must do the same or stay off the database.
- **Never return a fallback from inside a cached function.** `unstable_cache`
  stores whatever the callback returns, so a `catch { return DEFAULTS }` inside it
  caches the fallback for the whole revalidate period. Site settings did exactly
  that on every Neon cold-start hiccup (up to an hour of default content, fixed
  in PR #57). Let the read throw out of the cache and fall back outside it.
- **Preview deployments have their own London database** since 2026-09-30:
  Neon project `harbour-hair-preview-lhr` (`aged-glitter-18950253`, PG 18,
  eu-west-2), provisioned through the Vercel Marketplace (`PREVIEWDB_*` vars) with
  its own password and its own free CU-hours — preview code cannot reach
  production. It holds an **exact copy of production taken 2026-09-30, including
  real customer data**: treat it like production. Previews never migrate, so
  apply every new migration to it too (`prisma migrate deploy` with the preview
  env) or every PR's "Deploy Preview" fails. Refresh the copy with a PostgreSQL 18
  `pg_dump` of production restored into it. The old us-east-1 project
  (`neon-beige-river`) is kept, unused, by owner decision.
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
- **Online booking is LOCKED closed in production until Square deposits are wired.** The Square code (`lib/square-config.ts`, `lib/square-webhook.ts`, `services/square-gateway.ts`, `services/deposit-policy.ts`) is foundation only — nothing in the booking flow calls it. `SQUARE_DEPOSITS_WIRED = false` in `lib/online-booking-lock.ts` makes `assertOnlineBookingReady` / `isBookingEnabled` answer "closed" in every production build (fails closed; only an explicit Vercel preview is exempt) before any DB read, and Admin → Settings refuses to switch booking on. Flip it to `true` only in the change that takes the deposit in `submitBooking`. Dev, unit tests and CI integration scripts are not locked; a local `pnpm build && pnpm start` rehearsal IS.
- **24-hour cancellation/reschedule policy** — enforced server-side in booking actions; a reschedule request's new time must also be ≥ 24 h away.
- **Customer reschedules are staff-approved requests** (`requestReschedule` → `decideRescheduleRequest`); the booking stays CONFIRMED at its original time until approval, which refreshes the stylist's Fresha feeds and re-checks the slot in a Serializable transaction. Unanswered requests lapse 24 h before the requested time (notifications cron).
- **Use regular `<img>` for external/CDN images**, `next/image` only for local `public/` assets.
- **Tailwind CSS only** for styling. The brand is **monochrome black/white/grey** (client requirement) — never reintroduce the old blue `#174F7F` or gold.
- **readme/structure.md**: Check before creating new functions/components to avoid duplication.

### Security guardrails (2026-09-29 audit, PRs #48–#55 — keep them)

- **Google sign-in:** a *first* Google sign-in may create or link an account only when Google is authoritative for the address (gmail/googlemail, or a Workspace `hd` claim), and never auto-links an administrator — `decideGoogleLink` in `lib/google-oauth.ts`. Already-linked identities sign in by Google id.
- **Any code that sets a password** (admin reset, bootstrap, Google takeover defence, reset redemption) revokes that account's unused `PasswordResetToken`s in the same transaction. New passwords are capped at **72 UTF-8 bytes** (`fitsBcryptLimit`) — bcrypt ignores the rest.
- **Rate limits** go through `lib/rate-limit.ts` and never fail open. Login and reset requests have per-IP *and* per-account buckets (keyed by `accountRateLimitKey`, a hash); a signed `login_device` cookie (`lib/login-device.ts`) lets a browser that signed in before skip the account bucket so strangers cannot lock the owner out.
- **Self-service booking requires a confirmed email** (`hasVerifiedEmail`: `User.emailVerifiedAt` or a linked Google account).
- **Public availability actions** refuse any date outside `isBookableDateWindow` *before* touching the database, and have a per-IP limiter. Requesting the booking's current (or already-requested) time is a no-op; real requests are limited per customer and per appointment.
- **Marketing unsubscribe** needs the signed emailed link (`lib/unsubscribe-token.ts`); the form never changes the list.
- **Vercel Firewall:** the scanner-probe deny rule lives in the **project firewall**, versioned in `infra/vercel-firewall/` (apply with the CLI, see its README). **Never** put `routes` + `mitigate` in `vercel.json`: that deployment challenged *every* request, which Fresha's and Treatwell's iCal pollers cannot pass. Rate-limit rules are usage-billed — none are used.
- **Spend Management:** intended as a US$10 on-demand budget with **email alerts only** (never pause production — the site would go offline). Set in the dashboard (Team → Settings → Billing).
- **Planned, not built:** slot holds with a live Fresha check — `docs/superpowers/specs/2026-09-29-booking-slot-hold-and-live-sync-design.md` and its phase-1 plan.
