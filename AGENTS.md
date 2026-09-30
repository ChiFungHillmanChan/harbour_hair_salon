# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
- **Deployment**: Vercel (Pro plan) with Neon Postgres. Cron: appointment reminders daily at 8am UTC, notification delivery every 30 minutes during daytime UTC hours (`*/30 8-19`), and calendar sync every 30 minutes during saved active-staff opening hours, with a 15-minute buffer before/after (Europe/London). Production deploys only from GitHub Actions after CI; see scripts/production-build-guard.mjs. These sub-daily schedules require Pro. Notification and calendar jobs return before accessing the database unless their runtime flags are enabled.

### Environment Variables

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` — Vercel Postgres (auto-injected by Neon)
- `DATABASE_URL` — Local SQLite (in `.env`)
- `SESSION_SECRET` — JWT signing key (required, no fallback)
- `RESEND_API_KEY` — Email service
- `CRON_SECRET` — Configure in Vercel; sent as the cron Authorization bearer token
- `NOTIFICATIONS_ENABLED` / `CALENDAR_SYNC_ENABLED` — Default disabled; enable only after the corresponding production setup and acceptance checks

### Source Layout

- `src/app/` — Next.js App Router pages and API routes
  - `actions/` — Server actions organized by domain (`auth.ts`, `booking.ts`, `admin.ts`)
  - `lib/` — Shared utilities (`prisma.ts`, `session.ts`, `password.ts`)
  - `services/` — Business logic (`booking-service.ts`, `email-service.ts`)
  - `api/cron/reminders/` — Daily reminder cron endpoint
  - `api/cron/notifications/` — Transactional notification outbox worker
  - `api/cron/calendar-sync/` — Per-stylist Treatwell/Fresha ICS busy-time import
  - `admin/integrations/` — Calendar setup, tests and outbound subscription evidence
  - `admin/operations/` — Runtime diagnostics, cron history and notification status
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
- **Tailwind CSS only** for styling. The brand is **monochrome black/white/grey** (client requirement) — never reintroduce the old blue `#174F7F` or gold.
- **readme/structure.md**: Check before creating new functions/components to avoid duplication.
- **Online booking is LOCKED closed in production until Square deposits are wired** (`SQUARE_DEPOSITS_WIRED = false` in `src/app/lib/online-booking-lock.ts`; every production build, fails closed). The Square code is foundation only. Flip it only in the change that takes the deposit in `submitBooking`.
- **Neon bills compute time, not queries** — read CLAUDE.md "Neon compute budget" before adding a cron, a dynamic public page or a timed cache expiry. `/blog` reads `?page=` and is therefore dynamic; it serves from the Data Cache (`BLOG_POSTS_TAG`).
- **Never return a fallback from inside `unstable_cache`** — it caches the fallback (site settings did, on Neon cold starts). Throw out of the cached function and fall back outside it.
- **Preview deployments use their own London database** (`harbour-hair-preview-lhr`, PG 18) holding an exact copy of production from 2026-09-30, real customer data included — treat it like production. Previews never migrate: apply new migrations to it too, or every PR's preview build fails.

## Security guardrails (2026-09-29 audit — keep them)

- First Google sign-in: only Gmail/googlemail or Workspace (`hd`) addresses may create or link an account; administrators are never auto-linked (`decideGoogleLink`).
- Every password change revokes unused reset tokens in the same transaction; new passwords ≤ 72 UTF-8 bytes (`fitsBcryptLimit`).
- Login and reset requests: per-IP and per-account limits via `lib/rate-limit.ts` (never fail open); the `login_device` cookie keeps the owner's own browser out of the account bucket.
- Self-service booking needs a confirmed email (`hasVerifiedEmail`). Availability lookups are bounded by `isBookableDateWindow` before any query.
- Marketing unsubscribe only through the signed emailed link.
- Scanner probes are denied by a **project firewall** rule (`infra/vercel-firewall/`, applied with the Vercel CLI). Never use `vercel.json` `routes` + `mitigate`: it challenged all traffic, including the marketplaces' iCal pollers.
- Planned, not built: slot holds + live Fresha check — see `docs/superpowers/specs/2026-09-29-booking-slot-hold-and-live-sync-design.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
