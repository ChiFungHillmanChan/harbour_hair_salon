# AGENTS.md

This file guides Codex when working with code in this repository. `CLAUDE.md` is the fuller reference (same rules, more detail and history); read it before scheduling anything, touching payments or changing a public route.

## Project Overview

Harbour Hair Salon — a bilingual Next.js 16 website for a hair salon in Leeds: English (no URL prefix) and Traditional Chinese (`/zh-hk`), admin included. Live at https://www.harbourhair.co.uk, deployed on Vercel (Pro plan) with Neon PostgreSQL 18 in London.

- **Public pages:** home, services & pricing, stylists, blog, offers, reviews, contact, privacy notice and booking terms.
- **Sign-in:** email + password, or Google.
- **Online booking requests** that staff confirm, with Square card deposits (locked in production until Square production credentials are set).
- **Customer appointments:** view, cancel, request a reschedule, add to Google Calendar / `.ics`.
- **Admin panel:** schedule (arrivals, late-arrival restore, drag/resize with confirmation, consultation credit), services & pricing, stylists, shifts, timesheets and payroll, blog, FAQs, offers, discounts, reviews, users (with erasure), settings (booking switch, deposits, late-arrival rule), integrations (Fresha feeds, Google Calendar) and operations.
- **Staff kiosk.**
- **Calendars:** Fresha availability exchanged both ways through iCal busy feeds; two-way sync with the salon's primary "HarbourHair" Google Calendar, mirrored in Admin → Schedule by colour (sync on in production since 2026-10-16; diary mirror 2026-10-17, rollout in `docs/google-calendar-setup.md` §2b).

**Production state (2026-10-16):** online booking closed (`SiteSettings.bookingEnabled=false` plus the Square lock); `NOTIFICATIONS_ENABLED=false`; `CALENDAR_SYNC_ENABLED=true`; housekeeping on; late-arrival rule off; Google Calendar sync off until its five `GOOGLE_CALENDAR_*` variables are set on Production. Remaining launch steps: `LAUNCH.md`.

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

# Database (Vercel - PostgreSQL via Neon) — the schema the app's Prisma client is generated from
pnpm db:vercel:migrate  # Create a migration; every schema change needs one in all three prisma/*/migrations
pnpm db:vercel:deploy   # Apply migrations. Production applies them itself in its deploy build;
                        # run this by hand (preview env) for the preview database
pnpm db:vercel:studio   # Open Prisma Studio for Vercel DB
pnpm db:vercel:generate # Regenerate the Prisma client (also runs on postinstall)
pnpm db:vercel:push     # Push without a migration — throwaway local databases only, never production or preview

# Database (prod - MS SQL Server, legacy Docker deployment)
pnpm db:prod:migrate  # Create prod migrations
pnpm db:prod:deploy   # Deploy prod migrations

# Tests (CI runs all of these on every PR and every push to main)
pnpm test                    # Every src/**/*.test.ts (node:test + tsx, react-server conditions)
pnpm test:square             # The Square deposit subset
pnpm exec tsc --noEmit       # Type check
pnpm test:integration        # Real PostgreSQL suites: they refuse anything but SALON_TEST_DATABASE_URL
pnpm test:booking-lifecycle  #   on localhost with database name salon_test (migrated, disposable)
pnpm test:backend-http       #   — this one also needs `pnpm build` first (it runs `next start`)

# Deployment — production is deployed ONLY by GitHub Actions after CI passes
git push origin main  # (or merge a PR) → .github/workflows/deploy.yml tests, then deploys
# `vercel --prod` locally is refused by scripts/production-build-guard.mjs, and
# Vercel's own git builds are off (`git.deploymentEnabled: false` in vercel.json).
```

## Architecture

- **Framework**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4; pnpm; Zod for validation.
- **Database**: Prisma ORM with three schemas — `prisma/dev` (SQLite), `prisma/vercel` (PostgreSQL/Neon, the one the app's client is generated from) and `prisma/prod` (MS SQL Server, legacy). **Always edit all three schema files** and add a migration to each.
- **Auth**: JWT sessions via `jose`, `bcryptjs` passwords, plus Google sign-in (`src/app/lib/session.ts`). Route protection in `src/middleware.ts` (a root `middleware.ts` is never loaded): it guards `/admin`, `/kiosk`, `/appointments` and `/reviews/new` and rewrites the locale prefix. `/book` checks sign-in in its page. Sign-out is `POST /api/auth/signout` and ends every session.
- **i18n**: messages in `src/i18n/messages/{en,zh}/*.ts`; `completeness.test.ts` fails when either language misses a key. Customers get emails in `User.preferredLocale`.
- **Email**: Resend REST API (`services/email-service.ts`) with React Email templates in `src/components/emails/`. Booking emails go through the notification outbox and are only sent while `NOTIFICATIONS_ENABLED=true`; a preview deployment only emails `PREVIEW_EMAIL_ALLOWLIST`.
- **Payments**: Square deposits — Web Payments SDK card form, REST through `services/square-gateway.ts`, webhook `POST /api/webhooks/square`. Runbook: `docs/square-payments-setup.md`.
- **Rate limiting**: Upstash Redis through `lib/rate-limit.ts`; never fails open.
- **Calendars**:
  - Each stylist has a token-protected outbound busy feed, `/api/ical/[stylistId]`, served from the Data Cache; Fresha imports it as blocked time.
  - The calendar-sync cron imports the stylists' inbound feeds into `ExternalBusyBlock`; Admin → Schedule shows Fresha blocked time as "Blocked" and Fresha appointments as "Fresha booking" (`services/calendar-busy-kind.ts`, `lib/calendar-busy-display.ts`).
  - **Google Calendar sync** (on in production since 2026-10-16; runbook `docs/google-calendar-setup.md`): website bookings are pushed through a service account to the salon's primary "HarbourHair" calendar (`GOOGLE_CALENDAR_ID=harbourhairuk@gmail.com`; production uses #72's "Harbour website bookings" until the diary mirror's rollout), each in its stylist's Google colour. The website wins: edits to its own events in Google are written back.
  - **Diary mirror** (spec `docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md`): the pull copies every other event, 30 days back to 90 ahead, into `GoogleDiaryEntry` (`services/google-diary-classify.ts`): a stylist's Google colour → STYLIST; the no-stylist colour (Tomato) → UNASSIGNED, which takes a chair (`services/diary-chair-rule.ts`: customer paths refuse, Admin warns); otherwise a title naming a stylist → LEAVE, else NOTE (blocks nothing); "Show as available" is ignored. STYLIST and LEAVE become `ExternalBusyBlock` source `GOOGLE` and are exported in the outbound busy feed so Fresha stops selling the hour; UNASSIGNED and NOTE never are. Admin → Schedule shows the diary read-only; titles hold customers' names and phones, so admin-only. Colours: Admin → Stylists and Admin → Integrations. Changing `GOOGLE_CALENDAR_ID` starts the bookkeeping over (`services/google-calendar-guard.ts`).
  - Google calls `POST /api/webhooks/google-calendar`, which refuses (404/401) before any DB access and pulls single-flight after answering; the webhook and the pull never push. Website copies are kept 12 months; diary entries 30 days after they end.
- **Crons** (`vercel.json`, UTC): reminders `0 8` (plus the daily "needs attention" email), notifications `*/30 8-19`, calendar-sync `*/30` (skips ticks outside staff hours ±15 min before touching the DB; also runs the late-arrival rule and the Google Calendar retry/pull) and housekeeping `15 3` (retention, request lapses, Square reconciliation, the daily Google Calendar run).

### Environment Variables

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` — Neon (auto-injected); `DATABASE_URL` — local SQLite.
- `SESSION_SECRET` — JWT signing key (required, no fallback).
- `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SALON_NOTIFY_EMAIL`, `RESEND_AUDIENCE_ID` — email.
- `NOTIFICATIONS_ENABLED` — `"true"` turns on booking emails, reminders and the daily ops alert; the online-booking go-live gate also requires it. Production: `false` until launch.
- `CALENDAR_SYNC_ENABLED` — `"true"` lets the calendar-sync cron run (production: `true`); the late-arrival rule and the Google Calendar 30-minute step run inside it.
- `HOUSEKEEPING_ENABLED` — the daily housekeeping cron runs unless this is `"false"`.
- `TREATWELL_SYNC_ENABLED` / `TREATWELL_API_ENABLED` — deliberately off.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google sign-in (OAuth client in the `harbourhair` Google Cloud project, harbourhairuk@gmail.com).
- `GOOGLE_CALENDAR_SYNC_ENABLED`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_SA_EMAIL`, `GOOGLE_CALENDAR_SA_PRIVATE_KEY`, `GOOGLE_CALENDAR_WEBHOOK_SECRET` — Google Calendar sync (`lib/google-calendar-config.ts`). **Vercel Production only, never Preview** (a preview is off whatever the env says). All five must be present and the flag exactly `"true"`, else the sync is off. The private key keeps its newlines as literal `\n`.
- `SQUARE_*` (seven variables) — Square deposits: sandbox values on Preview only, production values on Production only (`docs/square-payments-setup.md` §2).
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `_TOKEN`) — rate limits.
- `NEXT_PUBLIC_SITE_URL` — canonical URL (defaults to `https://www.harbourhair.co.uk`).
- `CRON_SECRET` — cron auth bearer token.
- `PREVIEW_EMAIL_ALLOWLIST` — Preview only: the only recipients a preview deployment emails.
- Vercel makes new variables Sensitive: anything the BUILD reads (`NEXT_PUBLIC_*`, the database URLs for `prisma migrate deploy`) must be added with `vercel env add --no-sensitive`.

### Source Layout

- `src/app/[locale]/` — every page (English unprefixed, Chinese under `/zh-hk`): public pages, `auth/`, `book/`, `appointments/`, `privacy/`, `booking-terms/`, `kiosk/` and `admin/` (schedule home, `services`, `stylists`, `shifts`, `timesheets`, `payroll`, `employees`, `blog`, `faqs`, `offers`, `discounts`, `reviews`, `users`, `settings`, `opening-hours`, `integrations`, `operations`).
- `src/app/actions/` — Server actions by domain (`auth.ts`, `booking.ts`, `booking-quote.ts`, `admin.ts`, `admin-settings.ts`, `admin-payments.ts`, `admin-erasure.ts`, `admin-operations.ts`, `admin-arrivals.ts`, `admin-consultation-credit.ts`, `admin-google-calendar.ts`, …).
- `src/app/lib/` — shared utilities (`prisma.ts`, `session.ts`, `rate-limit.ts`, `booking-maintenance.ts` — the go-live gate, `online-booking-lock.ts`, `square-config.ts`, `booking-constants.ts`, `late-arrival.ts`, `calendar-links.ts`, `google-calendar-config.ts`, …).
- `src/app/services/` — business logic: booking (`booking-service.ts`, `pending-request-lapse.ts`, `late-arrival-cancel.ts`, `consultation-credit.ts`), pricing (`pricing/`), email and outbox, housekeeping, calendars (`calendar-sync-service.ts`, `stylist-ical-*.ts`, `google-calendar-*.ts`, `google-busy-mapping.ts`, `google-diary-*.ts`, `diary-chair-*.ts`), deposits (`deposit-*.ts`, `payment-*.ts`, `square-*.ts`), `operations-messages.ts`.
- `src/app/api/` — `cron/` (reminders, notifications, calendar-sync, housekeeping, gated treatwell-sync), `health/`, `ical/[stylistId]/`, `webhooks/square/`, `webhooks/google-calendar/`, `auth/` and `session/`.
- `src/i18n/` — locales, routing helpers and the `messages/{en,zh}` dictionaries.
- `src/components/` — React components by feature (`booking/`, `admin/`, `appointments/`, `emails/`, `legal/`, `pricing/`, `layout/`, …).
- `src/test/` — shared fixtures and page tests. A test under `src/app/[locale]/` never runs (`node --test` reads `[locale]` as a glob).
- `prisma/{dev,vercel,prod}/` — the three schemas and their migrations; seed scripts.
- `docs/` — runbooks (`square-payments-setup.md`, `google-calendar-setup.md`, `data-erasure.md`) and specs/plans (`superpowers/`).
- `LAUNCH.md` — launch checklist and last verified production state. `readme/structure.md` — function/component registry.

## Key Conventions

- **Server actions over API routes** for data operations (`src/app/actions/`, `'use server'`). Email service uses `import 'server-only'`, not `'use server'`.
- **Use Prisma generated types** from `@prisma/client` — never manual interfaces for database models.
- **Never access env vars at module level** — read them inside functions at runtime.
- **Every UI string goes in both languages** (`en` and `zh`, admin included); links go through the locale-aware helpers in `src/i18n/`.
- **Booking needs a signed-in customer with a confirmed email**; every booking action re-checks. Seeing or changing a booking needs the confirmed email too. While booking is closed, `/book` shows the phone / Fresha / Treatwell page.
- **Online booking opens in production only with Square PRODUCTION credentials** (`isOnlineBookingLockedForPayments` in `lib/online-booking-lock.ts`, fails closed). Deposits: a HOLD at request time, CAPTURE when staff confirm, RELEASE on decline/withdraw/lapse, REFUND on cancelling a confirmed booking (staff may keep it; a no-show's deposit is never refunded). Square is never called inside a transaction. Reconciliation rides the daily housekeeping run — no polling cron. Detail: CLAUDE.md and `docs/square-payments-setup.md`.
- **Booking rules**: 2-hour minimum notice online (`MIN_BOOKING_NOTICE_MINUTES`); 24-hour cancellation/reschedule policy; customer reschedules are staff-approved requests; unanswered requests lapse once their appointment has ended; "Mark completed" only after the start; reschedule approvals and staff bookings/edits run in Serializable transactions (no double booking).
- **Late arrivals** (`services/late-arrival-cancel.ts`, `lib/late-arrival.ts`; ships off): once switched on in Admin → Settings (`SiteSettings.lateAutoCancelSince`), the calendar-sync cron cancels a CONFIRMED booking not marked Arrived 15 minutes after its start (only bookings made and starting after the switch-on, started within 120 minutes, with no open reschedule request), keeps the deposit as a no-show and emails `LATE_CANCELLED` 30 minutes later. Staff tap Arrived (`actions/admin-arrivals.ts`, `components/admin/LateArrivalPanel.tsx`) and can Restore within 24 h.
- **Consultation credit** (`services/consultation-credit.ts`, `CONSULTATION_CREDIT_MONTHS` = 6): a paid consultation is taken off a consultation-required treatment staff book in Admin within 6 months, once; a cancelled treatment frees it. It is looked up again inside the booking's Serializable transaction (never trusted from the browser) and recorded in `Appointment.consultationCreditFromId` / `consultationCreditPence`; `priceAtBooking` never changes.
- **Price after consultation**: `effectivePriceNature` (`services/pricing/policy.ts`) makes every consultation-required service read "From £X — final price confirmed at your consultation" in the catalogue, JSON-LD and recorded quotes. Styling services need no consultation; colouring and perms do.
- **NHS/student proof and offer terms**: NHS-priced options carry a proof-of-eligibility notice (`services/pricing/eligibility.ts`); the offer and discount-code terms are `legal.bookingTerms.offers` (`components/legal/OfferTerms.tsx`). Discount codes stay paused (`DISCOUNTS_PAUSED`).
- **Admin calendar drags and resizes ask before saving** (`components/admin/MoveConfirmDialog.tsx`, iPad ghost-tap safe).
- **Neon bills compute time, not queries** — read CLAUDE.md "Neon compute budget" before adding a cron, a dynamic public page, a public endpoint something external polls, or a timed cache expiry. New crons need intervals over 5 minutes; put kill-switches above the first DB call; keep public pages on ISR; put new daily chores in housekeeping and 30-minute ones in calendar-sync.
- **Never return a fallback from inside `unstable_cache`** — throw out of the cached function and fall back outside it.
- **Site settings are cached for 24 hours**; a direct DB write is not seen until Admin → Settings → Save. Code that closes bookings or moves money reads the live `SiteSettings` row.
- **Preview deployments use their own London database** (`harbour-hair-preview-lhr`), an exact copy of production with real customer data — treat it like production. Previews never migrate: apply every new migration to it by hand (`pnpm db:vercel:deploy` with the preview env), or every PR's preview build fails. Latest applied: `20261016150000_google_calendar_sync` (2026-10-16).
- **Every fixed `lastError` sentence a job writes is catalogued** in `services/operations-messages.ts`; never reword one that code reads back.
- **Customer erasure goes through Admin → Users** (anonymise, never delete; `docs/data-erasure.md`). Keep the privacy notice and `/booking-terms` true when retention, payment or booking rules change.
- **Use regular `<img>` for external images**, `next/image` only for local `public/` assets; no `images.remotePatterns`.
- **Tailwind CSS only.** The brand is **monochrome black/white/grey** (client requirement, enforced by `brand-monochrome.test.ts`) — never reintroduce the old blue `#174F7F` or gold.
- **readme/structure.md**: check before creating new functions/components to avoid duplication.
- **Deploys are serialised** on `main`; a skip-CI marker anywhere in main's head commit message (a squash body copies every commit message of the PR) runs no CI and no deploy. Write "skip-ci marker", never the bracketed form.

## Security guardrails (keep them; details in CLAUDE.md)

- First Google sign-in: only Gmail/googlemail or Workspace (`hd`) addresses may create or link an account; administrators are never auto-linked (`decideGoogleLink`).
- Every password change revokes unused reset tokens in the same transaction; new passwords ≤ 72 UTF-8 bytes (`fitsBcryptLimit`).
- Login and reset requests: per-IP and per-account limits via `lib/rate-limit.ts` (never fail open); the `login_device` cookie keeps the owner's own browser out of the account bucket. Daily ceilings on bookings, cancellations and card authorizations.
- Sign-out (`POST /api/auth/signout`) ends every session and sends `Clear-Site-Data`; never move it into a Server Action or add a GET.
- Email verification is GET → confirm page → POST; never consume anything on a GET.
- Availability lookups are bounded by `isBookableDateWindow` before any query. Marketing unsubscribe only through the signed emailed link.
- Webhooks refuse before any DB access: Square 404/413/401 (unusable config, body over 64 KB, bad signature), Google Calendar 404/401 (sync off, bad or expired channel token).
- Scanner probes are denied by a **project firewall** rule (`infra/vercel-firewall/`). Never use `vercel.json` `routes` + `mitigate`: it challenged all traffic, including the marketplaces' iCal pollers.
- Planned, not built: slot holds + live Fresha check — `docs/superpowers/specs/2026-09-29-booking-slot-hold-and-live-sync-design.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
