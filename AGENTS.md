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

# Deployment
npx vercel --prod     # Deploy to Vercel production
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
- **Deployment**: Vercel (Pro plan) with Neon Postgres. Cron: appointment reminders daily at 8am UTC, Treatwell inbound sync every 5 min (the */5 schedule requires Pro — Hobby only allows daily crons and would fail the build).

### Environment Variables

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` — Vercel Postgres (auto-injected by Neon)
- `DATABASE_URL` — Local SQLite (in `.env`)
- `SESSION_SECRET` — JWT signing key (required, no fallback)
- `RESEND_API_KEY` — Email service
- `CRON_SECRET` — Vercel cron auth (auto-injected)

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
