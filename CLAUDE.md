# CLAUDE.md

Guidance for Claude Code in this repository. This file is the short core. The detail lives in `docs/agents/`, and the table at the end says which file to read before touching what. `AGENTS.md` carries the same guide for Codex: keep the two in step.

## 1. What this project is

**Harbour Hair Salon** is the website and booking system of a hair salon in Leeds, UK. It is live at https://www.harbourhair.co.uk in English (no URL prefix) and Traditional Chinese (`/zh-hk`), admin included.

- **Customers** browse services and prices, stylists, the blog, offers and reviews. They sign in (email + password, or Google) to request bookings, which staff then confirm. A Square card deposit is held at booking and taken when staff confirm. Customers can cancel, ask for a new time, and add bookings to their calendar.
- **Staff** run the salon from the admin panel: the schedule (arrivals, drag-to-move, consultation credit), services and pricing, stylists, shifts, timesheets and payroll, content (blog, FAQs, offers), reviews, users (with GDPR erasure), settings, integrations and operations. There is also a staff clock-in kiosk.
- **Other channels stay in sync.** Fresha and the website swap busy time through iCal feeds both ways. The salon's Google Calendar ("HarbourHair") syncs both ways and shows as the staff diary in Admin → Schedule.
- **Brand:** monochrome black, white and grey (client requirement).

## 2. Current state (2026-11-03)

- The public site is live. **Online booking is closed to the public**: customers book by phone, Fresha or Treatwell. It is open to **beta testers** only (Admin → Settings → Beta testers, currently the owner's account).
- Square **production** keys and the webhook are set. A real £0.01 test booking passed end to end (its refund COMPLETED on 2026-10-19). The account's card rate is "API 1.40% + £0.25", and the location `LMDPK9XXXTJEM` is named "FaithArkLtd". The assistant never captures or refunds real money: staff press those buttons.
- **Operations diagnostics (2026-10-25):** everything passes except Notification delivery, which fails until `NOTIFICATIONS_ENABLED=true`. Run them again after that, less than 24 hours before booking opens (`LAUNCH.md` §3.7).
- Production flags: `NOTIFICATIONS_ENABLED=false`, `CALENDAR_SYNC_ENABLED=true`, Google Calendar sync on, housekeeping on, late-arrival rule off, Fresha watch and its Google mirror on since 2026-10-27 (`FRESHA_WATCH_ENABLED=true`, `GOOGLE_FRESHA_MIRROR_CALENDAR_ID` = the separate "Fresha（自動同步）" calendar; `docs/google-calendar-setup.md` §9).
- **Remove before public launch:** the £0.01 test deposit on "Short Over Ears - Wash, Haircut & Blow Dry" (`LAUNCH.md` §3.8).
- **Calendars (checked 2026-11-03):** Funky, Ivan and Lox swap busy time with Fresha both ways. Lox was linked on 2026-11-03 with the owner's OK, and Lox / FRESHA now takes bookings with its outbound subscription confirmed. Treatwell reads all three website busy feeds every 5 minutes and shows the same blocks. A Treatwell booking reaches the website only when staff copy it into HarbourHair (red `TW`): the accepted blind spot. Never rotate a stylist's busy-feed URL while any provider takes their bookings. Untick "takes bookings" first, or beta booking closes (`LAUNCH.md` §3.3).
- **Owner decisions (2026-10-25, `LAUNCH.md` §3/§4):** Resend stays on Free for now; Neon moves to Launch at public launch; Treatwell stays (risk accepted); the second admin and `NOTIFICATIONS_ENABLED` come later; the £0.01 override and the beta tester list stay for now; the privacy notice's entity name stays (FaithArkLtd and Harbour Hair Salon are the same company).
- The preview database is migrated through `20261018200000_deposit_locked_at`.
- Full dated detail: `docs/agents/production-state.md`. The launch steps, in order: `LAUNCH.md` §3, then the owner decisions in §4.

## 3. Production stack

| Layer | Service | Setup | Plan / cost |
|---|---|---|---|
| App | **Next.js 16** (App Router), React 19, TypeScript, Tailwind v4, pnpm, Node 24 | `vercel.json` pins region `lhr1` (London) | — |
| Hosting | **Vercel** | Deployed **only** by GitHub Actions after CI (`.github/workflows/deploy.yml`); Vercel's git builds are off. The project firewall is in `infra/vercel-firewall/`; preview URLs sit behind Vercel login | Pro, US$20/month |
| Database | **Neon PostgreSQL 18**, `eu-west-2` | Prisma 6. Production `damp-wildflower-12426644`; preview has its own copy, `aged-glitter-18950253` (real customer data: treat it like production) | Free (100 CU-h/month; going over **suspends** the database). October 2026 pace ~47 CU-h. Move to Launch at public launch (~US$5–6/month at that pace); the switch moves every database in the Vercel-managed integration |
| Rate limits | **Upstash Redis**, `eu-west-2` | `lib/rate-limit.ts`; never fails open | Free |
| Email | **Resend** (REST) + React Email | Booking emails go through an outbox; previews only email an allowlist | Free (100/day); the owner keeps Free for now (2026-10-25). Pro is US$20/month |
| Payments | **Square** (Web Payments SDK + REST + webhook) | The salon's own account; production keys on Vercel Production only, sandbox on Preview only. Runbook: `docs/square-payments-setup.md` | 1.4% + 25p per UK card (the account's rate, checked 2026-10-25); no monthly fee |
| Google | Google Cloud project `harbourhair` (`harbourhair-511821`) | The OAuth client for Google sign-in, plus a service account for Calendar sync. Runbook: `docs/google-calendar-setup.md` | Free |
| DNS | IONOS | `www.harbourhair.co.uk` is canonical; DMARC is live | Domain renewal yearly |
| Crons | Vercel crons (UTC) | reminders `0 8`, notifications `*/30 8-19`, calendar-sync `*/30` (staff hours only), fresha-watch `*/5 8-19` (15 minutes before opening until closing; on since 2026-10-27, `FRESHA_WATCH_ENABLED`), housekeeping `15 3` | Read `docs/agents/neon-budget.md` before adding one |

**Running cost:** about US$20/month now, about US$25–30/month once public booking opens (Vercel Pro plus Neon Launch; Resend Pro would add US$20), plus Square's per-payment fees. Also set a Vercel spend alert of US$10 (**alerts only**: pausing would take production offline). Environment variables: `docs/agents/environment.md`.

## 4. Repository structure

```text
src/
  app/
    [locale]/        every page; middleware serves English unprefixed, Chinese under /zh-hk
      admin/         staff panel (schedule home, services, stylists, shifts, payroll, blog, settings, integrations, operations, …)
      book/ appointments/ auth/ kiosk/ booking-terms/ privacy/ …
    actions/         Server Actions by domain ('use server'): booking, admin*, auth, kiosk, …
    services/        business logic: booking, pricing/, deposits + Square, email + outbox, calendars (Fresha, Google), housekeeping
    lib/             shared helpers: session, prisma, rate-limit, booking gate + constants, Square config, calendar links
    api/             cron/, webhooks/ (square, google-calendar), ical/[stylistId], auth/, health, session
  components/        React components by feature (booking, admin, appointments, emails, layout, home, legal, …)
  i18n/              locales, routing helpers, messages/{en,zh}
  middleware.ts      route protection + locale rewrite (a root middleware.ts is never loaded)
  test/              shared fixtures and page tests (tests under src/app/[locale]/ never run)
prisma/{dev,vercel,prod}/   SQLite (local) · PostgreSQL (Vercel; the app's Prisma client) · SQL Server (legacy). Each has its own schema and migrations
docs/agents/         the detailed agent guide (table at the end)
docs/                runbooks (Square, Google Calendar, data erasure) and design specs (superpowers/specs, plans)
scripts/             production build guard, PostgreSQL verification suites, PDF handover builder
infra/               Vercel firewall rules; a dormant AWS fallback (do not deploy)
readme/structure.md  function/component registry: check it before adding a new one
LAUNCH.md            the launch checklist and the last verified production state
```

## 5. Commands

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
pnpm test                    # Every src/**/*.test.ts (node:test + tsx, react-server conditions, TZ=UTC like CI)
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

## 6. How a change reaches production

1. Work on a branch: `main` deploys. Before pushing, run `pnpm test`, `pnpm exec tsc --noEmit` and `pnpm lint`.
2. **Schema change:** edit all three `prisma/*/schema.prisma` files and add a migration to each `migrations/` folder. Production applies migrations in its deploy build. The **preview database never migrates by itself**: apply each migration by hand (`docs/square-payments-setup.md` §7), or every PR's "Deploy Preview" fails. The Blast Radius hook holds that command until the owner approves it in the terminal.
3. Open a PR. "CI" is the gate; "Deploy Preview" only needs the preview database to be current.
4. Squash-merge with an explicit `--subject`/`--body`. **A skip-CI marker anywhere in the head commit message deploys nothing** (`[skip ci]` and friends, even when quoted). Write "skip-ci marker" in prose. After merging, confirm a `push` run for the new `main` SHA appears in Actions.
5. Deploys on `main` queue one after another and are never cancelled mid-flight. When the `NEON_API_KEY` secret and the `NEON_PROJECT_ID` variable are set, each production deploy first takes a Neon snapshot branch (`predeploy-*`). Rollback: promote an older deployment in Vercel.
6. When behaviour, setup or production facts change, update this guide (`CLAUDE.md`, `AGENTS.md`, `docs/agents/`), `LAUNCH.md` and the customer-facing terms and privacy notice in the same PR.

## 7. Rules that must never break

Each rule has its full story in the linked file.

- **Neon wakes cost money, not queries.** New crons run every 30 minutes or less often, in business hours where possible. The one exception is the 5-minute Fresha watch, which never reaches the database unless a Fresha feed changed (owner decision 2026-10-26); nothing joins it without the same proof. Kill-switches go **above** the first database call. Public pages stay on ISR or the Data Cache. Anything external that polls a route counts as a cron you do not control. → `neon-budget.md`
- **Never return a fallback from inside `unstable_cache`.** It caches the fallback. Let the read throw and fall back outside the cache. → `neon-budget.md`
- **Every Server Action is a public endpoint.** Admin actions call `requireAdmin` / `verifySession` + a role check before any read; customer actions check ownership. `getSession()` checks only the signature: never show or answer from it without `isSessionCurrent`. → `security.md`
- **Money safety.** Square is never called inside a database transaction. Deposit amounts come from the server, never the browser. Outside a production build, only sandbox credentials work. Production booking stays locked without Square production credentials. A refund claims its row before Square is called. → `booking-and-payments.md`
- **Online booking gate.** It fails closed; admin booking paths never call it; beta testers get through only via `assertOnlineBookingReadyFor`. Never write `bookingEnabled` straight into the database: use Admin → Settings. → `booking-and-payments.md`
- **Deposit rules (owner decisions).** Customers cancelling 48 hours or more ahead get a full refund; inside 48 hours the deposit is kept. A reschedule the customer asked for inside 48 hours stays kept (`depositLockedAt`). A no-show keeps it. A salon cancellation refunds it. → `booking-and-payments.md`
- **Both languages, always.** Every UI string goes in `src/i18n/messages/en` **and** `zh` (`completeness.test.ts` enforces it). Links use the locale-aware helpers.
- **Monochrome brand.** No blue `#174F7F`, no gold (`brand-monochrome.test.ts`).
- **Calendars.** Cron code invalidates the iCal feeds with `invalidateStylistIcalFeedFromCron()`, because `updateTag` only works in Server Actions. A Google webhook or pull never pushes, or the sync would loop forever. → `architecture.md`
- **Never put `routes` + `mitigate` in `vercel.json`.** It challenged every request, which blocked Fresha's iCal pollers. Firewall rules live in `infra/vercel-firewall/`. → `security.md`
- **`lastError` sentences are state keys.** Code reads them back. Never reword one in place; catalogue new ones in `services/operations-messages.ts`.
- **Prefer reversible changes.** The owner wants things disabled or hidden, not deleted, unless they explicitly ask.

## 8. Coding conventions

- **Server actions over API routes** for data operations. Place in `src/app/actions/`, use `'use server'` directive.
- **Use Prisma generated types** from `@prisma/client` — never create manual interfaces for database models.
- **Never access env vars at module level** — wrap in async functions for runtime access.
- **Email service uses `import 'server-only'`** — not `'use server'` (internal functions, not client-callable).
- **Every UI string goes in both languages** (`src/i18n/messages/en` and `zh`, admin included; `completeness.test.ts` enforces it). Links go through the locale-aware helpers in `src/i18n/` so a `/zh-hk` visitor stays in Chinese.
- **Use regular `<img>` for external/CDN images**, `next/image` only for local `public/` assets.
- **Tailwind CSS only** for styling. The brand is **monochrome black/white/grey** (client requirement) — never reintroduce the old blue `#174F7F` or gold.
- **readme/structure.md**: Check before creating new functions/components to avoid duplication.
- **Next.js 16 is newer than your training data.** Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code, and heed deprecation notices. `next dev` maintains this rule as a block in `AGENTS.md`.
- **Tests:** `node:test` + tsx with `--conditions=react-server`, and modules loaded through `src/test/load-server-module.ts` with stubs. Page tests live in `src/test/pages/`, because `node --test` treats `[locale]` in a path as a glob.
- **Match the surrounding code:** its comment density, naming and idiom. Comments explain *why*, often with the owner decision and its date.

## 9. Read before you touch…

| You are about to… | Read |
|---|---|
| change booking, deposits, refunds, reschedules, consultation credit, late arrivals or the go-live gate | `docs/agents/booking-and-payments.md`, then `docs/square-payments-setup.md` |
| touch auth, sessions, sign-in, rate limits, webhooks or the firewall | `docs/agents/security.md` |
| add a cron, a public route that reads the database, or change caching | `docs/agents/neon-budget.md` |
| work on email, calendars (Fresha / Google), i18n, crons or the overall design | `docs/agents/architecture.md` |
| add or change an environment variable | `docs/agents/environment.md` |
| need production facts (what is live, IDs, colours, flags) | `docs/agents/production-state.md`, `LAUNCH.md` |
| change Google Calendar sync | `docs/google-calendar-setup.md` |
| erase a customer's data | `docs/data-erasure.md` |
