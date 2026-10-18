# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Harbour Hair Salon — a bilingual Next.js 16 website for a hair salon in Leeds: English (no URL prefix) and Traditional Chinese (`/zh-hk`). It has:

- **Public pages:** home, services & pricing, stylists, blog, offers, reviews, contact, privacy notice and booking terms.
- **Sign-in:** email + password, or Google.
- **Online booking requests** that staff confirm, with Square card deposits (Square production keys set 2026-10-18; open only to beta testers until launch). Consultation-required services show "From £X" and their consultation fee is credited against the treatment.
- **Customer appointments:** view, cancel, request a reschedule, add to Google Calendar / `.ics`.
- **Admin panel:** schedule (arrivals, late-arrival restore, drag/resize with confirmation, consultation credit), services & pricing, stylists (show on website, takes walk-ins), staff shifts and payroll, blog, FAQs, offers, discounts, reviews, users (with erasure), site settings (deposits, late-arrival rule), integrations (Fresha feeds, Google Calendar) and operations.
- **Staff kiosk.**
- **Fresha availability:** exchanged both ways through iCal busy feeds.
- **Google Calendar:** two-way sync with the salon's primary "HarbourHair" calendar (harbourhairuk@gmail.com), mirrored in Admin → Schedule by colour (diary mirror, 2026-10-17).

Deployed on Vercel (Pro plan) with Neon PostgreSQL.

## Current state (2026-10-18)

- Releases #62 (review follow-ups, Google Calendar links, i18n) and #63 (Square deposits) are live since 2026-10-13 and verified read-only against production — see `LAUNCH.md` §0.
- Deployed to production on 2026-10-16: #68 (Fresha blocked time shows as "Blocked", Fresha bookings as "Fresha booking"), #69 (sign-out ends every session), #70 (late-arrival auto-cancel, ships off), #71 (consultation credit, price after consultation, move confirmation, NHS/student proof and offer terms) and #72 (two-way Google Calendar sync, switched on the same day).
- **Online booking is closed to the public in production, open to beta testers:** `SiteSettings.bookingEnabled=false` and `NOTIFICATIONS_ENABLED=false`, so customers book by phone, Fresha or Treatwell (`/book` shows exactly that). §4 (the sandbox acceptance list, `docs/square-payments-setup.md`) passed on `main` 13dbe8f on 2026-10-17/18 (`readme/square-acceptance-2026-10-14.md`), and on 2026-10-18 the owner had the **Square production keys set** (§5): all seven `SQUARE_*` on Vercel Production only, from the salon's own Square account FaithArkLtd (owner-confirmed; location `LMDPK9XXXTJEM`), and the production webhook "Harbour Hair website" ("Send test event" 200). **Beta booking** (#81; Admin → Settings → Beta testers, `SiteSettings.bookingBetaEmails`) lists `hillmanchan709@gmail.com` only. A real £0.01 test booking on 2026-10-18 passed end to end: hold, live `payment.created`, the owner's approval (CAPTURED), customer cancel (refund requested, Square notices processed), and four tester emails. The assistant may not capture or refund real money: staff press those buttons.
- **Deposit policy (owner, set in production 2026-10-15):** 50% of the price, minimum £0. Both consultations take a fixed £15 override, which is their full price: the general Consultation went from free to £15. Nothing is charged while booking is locked. A no-show's deposit is never refunded (decided 2026-10-16); the late-cancellation rule is still open, so the terms say "may keep".
- **Styling** (the 7 blow-dry services) is booked directly since 2026-10-16 (production data change, `requiresConsultation=false`); Colouring and Perms keep the consultation.
- Production flags: `NOTIFICATIONS_ENABLED=false` (no booking emails and no daily ops alert yet; the go-live gate needs it `true`), `CALENDAR_SYNC_ENABLED=true`, and housekeeping on (first run 2026-10-14 03:15 UTC).
- Late-arrival rule: OFF (`SiteSettings.lateAutoCancelSince` null); brief the staff on Arrived first (`LAUNCH.md` §4), then switch it on in Admin → Settings.
- Google Calendar sync: switched ON in production on 2026-10-16 (five `GOOGLE_CALENDAR_*` variables on Production; runbook `docs/google-calendar-setup.md`). Google Cloud project **`harbourhair`** (`harbourhair-511821`, owned by harbourhairuk@gmail.com) holds the service account `harbour-website-calendar@harbourhair-511821.iam.gserviceaccount.com` **and**, since the same day, the Google sign-in OAuth client (moved from the developer's old personal project; Google account ids are the same across clients, so linked accounts keep working).
- Deployed to production on 2026-10-17 (22:41 UTC): #80, Admin → Schedule lists cancelled bookings under the day and week grids (so "Mark refund as settled outside the website" is reachable on a tablet or computer), and Admin → Operations links each payment to its booking.
- **Google diary mirror** (#75, `ba82f3a`, deployed 2026-10-17 02:25 UTC with migration `20261017120000_google_diary_mirror`; spec `docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md`, runbook `docs/google-calendar-setup.md` §2b). Done 2026-10-17: HarbourHair shared with the service account; Admin colours set (Ivan Lavender `1`, Funky Sage `2` + `F`, Lox Banana `5` + `L`, Shania names `天`; no-stylist Tomato `11`, leave Graphite `8`); Production `GOOGLE_CALENDAR_ID=harbourhairuk@gmail.com`; Sync now (397 entries) and the Chrome check (Admin day view identical to Google) passed; preview database migrated. **Walk-in chairs:** only stylists with "Takes walk-ins" (Admin → Stylists; `Stylist.takesWalkIns`, default on, #76) count as a chair for red events, and booking an unticked one uses none; Shania (assistant) is unticked in production since 2026-10-17. The old "Harbour website bookings" calendar is switched off but kept (the owner prefers disabling to deleting, 2026-10-17): 0 events, unshared from the service account (the website gets 404 for it) and unticked in Google Calendar; re-share it to undo.
- **Test deposit kept on purpose (owner, 2026-10-18):** "Short Over Ears - Wash, Haircut & Blow Dry" (`cmns9nwec000lhgg0erqsl66r`, £37) has a £0.01 deposit override so beta testers can run real-card checks for a penny; only testers can book online. **Remove it before public booking opens** (Admin → Services & Pricing → that service → empty "Deposit for this service"; `LAUNCH.md` §3.8).
- **Fresha gap — Lox:** Lox's Fresha import of the website busy feed is not set up (`CalendarConnection.receivesBookings=false`), so a website booking with Lox does not block Lox on Fresha; staff check Fresha before confirming a Lox request until `LAUNCH.md` §3.3 is done. Funky, Ivan and Shania receive it.
- Deployed 2026-10-18: #79 (§4 record), #81 (beta booking; Google link keeps a confirmed password; migration `20261018120000_booking_beta_emails`).
- The remaining launch steps, in order: `LAUNCH.md` §3; open owner decisions and staff briefings in §4.

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

- **Framework**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- **Package manager**: pnpm
- **Database**: Prisma ORM with triple schema setup:
  - `prisma/dev/schema.prisma` — SQLite for local development
  - `prisma/vercel/schema.prisma` — PostgreSQL for Vercel deployment (Neon)
  - `prisma/prod/schema.prisma` — MS SQL Server (legacy Docker)
  - **Always edit all three schema files** when changing the database schema
- **Auth**: JWT sessions via `jose`, passwords hashed with `bcryptjs`, plus Google sign-in. Session helpers in `src/app/lib/session.ts`. Admin sign-in is password or Google only: MFA stopped being required in e9f3a25 and its code is dormant.
  - **Route protection** lives in `src/middleware.ts`; a root `middleware.ts` is never loaded. It guards `/admin`, `/kiosk`, `/appointments` and `/reviews/new`, and rewrites the locale prefix.
  - `/book` checks sign-in in its page instead (see Key Conventions).
  - The header learns who is signed in from the `session_hint` cookie alone (`lib/session-hint.ts`) — no `/api/session` request per visitor.
- **i18n**: English (default, unprefixed) and Traditional Chinese (`/zh-hk`), admin pages included.
  - Messages live in `src/i18n/messages/{en,zh}/*.ts`; `src/i18n/messages/completeness.test.ts` fails when either language misses a key.
  - Customers get emails in `User.preferredLocale`, saved at registration, Google sign-up and booking; staff choose it for walk-ins.
- **Email**: Resend's REST API (`sendPreparedEmail` in `src/app/services/email-service.ts`) with React Email templates in `src/components/emails/`.
  - Booking emails (to the customer and the salon) are queued in the notification outbox (`services/notification-outbox-service.ts`) and only sent while `NOTIFICATIONS_ENABLED=true` — except a beta tester's appointment, which its own per-appointment dispatch sends even while it is off (beta booking, Key Conventions).
  - Account emails (verification, password reset, unsubscribe) go out at once.
  - A preview deployment only emails `PREVIEW_EMAIL_ALLOWLIST`.
  - One online booking sends 5 emails: request received, salon alert, confirmation, reminder and review request.
- **Payments**: Square for booking deposits — the Web Payments SDK card form in the browser, REST calls through `services/square-gateway.ts`, and webhooks at `/api/webhooks/square`. See the Square bullets under Key Conventions and `docs/square-payments-setup.md`.
- **Rate limiting**: Upstash Redis through `lib/rate-limit.ts` (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL`/`_TOKEN`). It never fails open.
- **Calendars**:
  - Each stylist has a token-protected outbound busy feed, `/api/ical/[stylistId]`, served from the Data Cache. Fresha imports it as blocked time.
  - The calendar-sync cron imports the stylists' inbound feeds into `ExternalBusyBlock`. Its `summary` keeps only Fresha's generic titles (`services/calendar-busy-kind.ts`), so Admin → Schedule (`lib/calendar-busy-display.ts`) shows part-day blocked time as "Blocked", a Fresha appointment as "Fresha booking" and a whole-day block as "Unavailable"; any other title is never stored.
  - Customers get Google Calendar links and `.ics` files (`lib/calendar-links.ts`).
  - **Google Calendar sync** (two-way, ON in production since 2026-10-16; runbook `docs/google-calendar-setup.md`, design `docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md`): the salon's primary "HarbourHair" calendar (`GOOGLE_CALENDAR_ID=harbourhairuk@gmail.com` once the diary mirror is rolled out), written through a service account (`services/google-calendar-*.ts`, `lib/google-calendar-config.ts`). It is not a `CalendarConnection`.
    - **Push**: every booking is one event (id `hh` + sha256 of the appointment id). `invalidateStylistIcalFeed` (Server Actions only) schedules the push with `after()` (`scheduleGoogleCalendarPush`); the calendar-sync cron retries and catches cron-made changes (45-minute look-back); housekeeping re-renders the whole window and deletes copies of appointments that ended over **12 months** ago. A Google failure never fails a booking action: the row keeps `attempts`/`lastError` and the cron retries (a booking before the 7-day window only while `attempts < 5`; a row erasure marked for re-rendering until it lands).
    - **Pull**: `POST /api/webhooks/google-calendar` checks sync-enabled (404) and the `X-Goog-Channel-Token` (HMAC over the channel id, carrying its own expiry, `lib/google-channel-token.ts`; 401) before any DB access, answers 200 and pulls in `after()`, single-flight (`runPullSingleFlight`: one pull at a time plus one re-run). The watch channel is made by the daily run (housekeeping renews it within 48 hours of its expiry) and by Admin → Integrations → "Sync now", which replaces it at once (`runGoogleCalendarJob('daily', { renew: true })`). The webhook and the pull NEVER push (`invalidateStylistIcalFeedFromCron` never schedules one), or every notification would start a push, a notification and a pull again without end.
    - **Blocks**: STYLIST and LEAVE diary entries (below) become `ExternalBusyBlock` source `GOOGLE` for their stylists (`services/google-busy-mapping.ts`); #72's title-prefix rule (an unmatched title blocked the whole salon) is gone. Website events (private property `harbourAppointmentId`, or an id shaped `hh` + 40 hex should the property be stripped) are NEVER diary entries or blocks, and an edited, recoloured or deleted one is written back, for bookings from 7 days back too: the website wins, staff edit website bookings in Admin (a loop breaker: not within 10 minutes of its own write, `GOOGLE_EVENT_NOT_KEPT`). GOOGLE blocks ARE exported in the stylist's outbound busy feed so Fresha stops selling the hour; FRESHA/TREATWELL blocks are not. The pull writes busy blocks (and drops the feed cache) only when the blocks that have not ended differ from the stored ones that have not ended.
    - **Diary mirror** (`docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md`): the pull classifies every Google-only event (`services/google-diary-classify.ts`: website/cancelled skipped; stylist Google colour → STYLIST; no-stylist colour (default Tomato 11) → UNASSIGNED; else names in the title → LEAVE, else NOTE; transparency ignored) into `GoogleDiaryEntry` (30 days back to 90 ahead, deleted 30 days after the end by the pull and by housekeeping) and writes GOOGLE busy blocks for STYLIST/LEAVE only, in one transaction. UNASSIGNED entries take a chair (`services/diary-chair-rule.ts`, loaded by `diary-chair-load.ts` inside the booking reads and transactions; the chairs are the active stylists with `takesWalkIns`, Admin → Stylists "Takes walk-ins", and booking a stylist without it uses none): customer paths refuse, admin create/move warn (`DIARY_CHAIR`), staff confirm/approve never apply it (`{ chairRule: false }`). Website events take the stylist's `googleColorId` (`googleColorFor`; none set → the no-stylist colour); `GoogleCalendarSyncState.calendarId` + `services/google-calendar-guard.ts` start over when `GOOGLE_CALENDAR_ID` changes. Colours: Admin → Stylists (Google colour, Google names) and Admin → Integrations (Diary colours). Diary titles hold customers' names and phone numbers: admin-only (Admin → Schedule), never in a public page, feed or email.
    - **Config**: `GOOGLE_CALENDAR_SYNC_ENABLED` is the kill-switch, set on **Production only** (the preview database holds real customers; `VERCEL_ENV=preview` is off whatever the env says). Status, "Sync now", "Clear Google busy time and diary copy" (deletes every GOOGLE block and the diary copy, so turning the sync off is reversible; audited) and the diary colours live in Admin → Integrations. Failures reach the daily ops alert through two job rows: `google-calendar` (the 30-minute run, which also checks health: a live watch channel and a successful pull within 24 hours) and `google-calendar-daily` (housekeeping and Sync now).
- **Validation**: Zod
- **Deployment**: Vercel (Pro plan) with Neon Postgres (**PostgreSQL 18, `eu-west-2`/London** since 2026-09-16 — moved from `us-east-1` to stop every query crossing the Atlantic; CI must test against the same major version). Four crons live in `vercel.json`: reminders (daily 08:00 UTC; also sends the salon's daily "needs attention" email, `services/ops-alert-service.ts`, only when something is wrong), notifications (`*/30 8-19` UTC, daytime only), calendar-sync (`*/30`, but the route skips ticks outside saved staff hours ±15 min before touching the DB; after the feeds it runs the late-arrival rule and the Google Calendar retry/pull) and housekeeping (daily 03:15 UTC: retention clean-up, unanswered-request lapses, Square reconciliation `services/payment-reconciliation.ts` and the daily Google Calendar run `services/google-calendar-job.ts`). See "Neon compute budget" below before adding another; `neon-compute-budget.test.ts` pins these.

### Environment Variables

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` — Vercel Postgres (auto-injected by Neon)
- `DATABASE_URL` — Local SQLite (in `.env`)
- `SESSION_SECRET` — JWT signing key (required, no fallback)
- `RESEND_API_KEY` — Email service
- `EMAIL_FROM` / `EMAIL_REPLY_TO` — sender and reply-to on every email.
- `SALON_NOTIFY_EMAIL` — the salon inbox for new-request alerts and the daily ops alert. Falls back to `EMAIL_REPLY_TO`.
- `RESEND_AUDIENCE_ID` — the marketing list. Unsubscribe and customer erasure remove contacts from it.
- `NOTIFICATIONS_ENABLED` — `"true"` turns on booking emails, reminders and the daily ops alert. Anything else makes the notifications and reminders crons return before touching the DB. The online-booking go-live gate also requires it (`lib/booking-maintenance.ts`); beta booking does not, and a beta tester's booking emails go out even while it is off (per-appointment dispatch only; the crons stay off). Production: `false` until launch.
- `CALENDAR_SYNC_ENABLED` — `"true"` lets the calendar-sync cron run (production: `true`). The late-arrival rule runs inside it, so it stops too when the cron is off (as do the Google Calendar steps, below).
- `GOOGLE_CALENDAR_SYNC_ENABLED` / `GOOGLE_CALENDAR_ID` / `GOOGLE_CALENDAR_SA_EMAIL` / `GOOGLE_CALENDAR_SA_PRIVATE_KEY` / `GOOGLE_CALENDAR_WEBHOOK_SECRET` — the Google Calendar sync (`lib/google-calendar-config.ts`). **Vercel Production only, never Preview.** All five must be present and `GOOGLE_CALENDAR_SYNC_ENABLED` must be `"true"`, else the sync is off (webhook 404). The private key is a PEM whose newlines are the literal characters `\n`. Rotating the webhook secret refuses the live channel's notifications (401) until Sync now, which replaces the channel at once (redeploy, then Sync now: `docs/google-calendar-setup.md` §5). The 30-minute retry of failed writes and the safety-net pull run inside the calendar-sync cron, so they need `CALENDAR_SYNC_ENABLED=true` and run in staff hours only.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google sign-in: the OAuth client "Harbour website sign-in" in the `harbourhair` Google Cloud project (harbourhairuk@gmail.com; consent screen published, External). Its redirect URIs are `https://www.harbourhair.co.uk/api/auth/google/callback`, the bare-domain one and `http://localhost:3000/...`. Production and Preview.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `_TOKEN`) — Upstash Redis for rate limits (`lib/redis-credentials.ts`).
- `NEXT_PUBLIC_SITE_URL` — canonical site URL; defaults to `https://www.harbourhair.co.uk`.
- `TREATWELL_API_ENABLED` — `"true"` turns on the Treatwell API worker (`services/treatwell-api.ts`).
- `CRON_SECRET` — Vercel cron auth (auto-injected)
- `HOUSEKEEPING_ENABLED` — the daily housekeeping cron runs unless this is `"false"` (retention in the privacy notice, delivery-lease recovery, request lapsing and card-deposit reconciliation depend on it).
- `TREATWELL_SYNC_ENABLED` — kill-switch for `/api/cron/treatwell-sync`. Unset/anything but `"true"` makes the route return before touching the DB. Deliberately off (see below).
- `SQUARE_*` (seven variables) — Square deposits. Sandbox values on Vercel **Preview** only, production values on **Production** only; what goes where, and why sandbox credentials never open production booking: `docs/square-payments-setup.md` §2. Production has all seven since 2026-10-18. Preview currently has no `SQUARE_ACCESS_TOKEN` / `SQUARE_WEBHOOK_SIGNATURE_KEY` (its card form says "not available"): re-add the sandbox ones before the next sandbox test.
- `PREVIEW_EMAIL_ALLOWLIST` — Vercel **Preview** only: comma-separated addresses and/or `@domain` entries. Previews run on a copy of production's customers, so on a preview deployment (`VERCEL_ENV=preview`) `sendPreparedEmail` emails only these recipients; anything else is dropped as if sent (no retry), and with it unset a preview sends nothing (`lib/preview-email.ts`). Set it to your own address before `NOTIFICATIONS_ENABLED=true` on Preview (`docs/square-payments-setup.md` §3). Since 2026-10-18 Preview keeps the allowlist and has `NOTIFICATIONS_ENABLED=false` (switched off, not deleted).
- **GitHub Actions** (repository settings, not Vercel):
  - Secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are needed for every deploy.
  - The optional `NEON_API_KEY` secret plus the `NEON_PROJECT_ID` variable turn on the pre-migration Neon snapshot.
- **Vercel's team policy makes new variables Sensitive.** `vercel env pull` and the deploy job's `vercel pull` then read the literal `[SENSITIVE]` instead of the value. Anything the BUILD reads must be added with `vercel env add --no-sensitive`, or the build sees the placeholder: `NEXT_PUBLIC_*`, and the database URLs that `prisma migrate deploy` uses. The team also has **"Separate Production Secret Values"**: a Secret's Production value must differ from its Preview value, so add a production secret as a NEW Production-only variable, never into the Preview one (that happened on 2026-10-18 and was fixed by retargeting).

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
- **Site settings are cached for 24 hours** (`getSiteSettings`, tag `site-settings`). Admin → Settings, opening hours and content saves drop the tag. A direct database write is not seen until then: press Save in Admin → Settings. The settings form and the deposit policy read the live row (`getSiteSettingsForEditing`); a form built from the cached copy once switched booking off when saved.
- **Each Google Calendar notification wakes the database** (the webhook pulls after answering; a pull reads and may replace busy blocks and the diary). That is a public endpoint something external calls: the website's own writes notify it too, so bursts collapse into one pull at a time plus one re-run, the webhook refuses (404/401) before any DB access, and its token expires with its channel. Notifications only follow a change on the salon calendar — since the diary mirror that is the staff's whole diary, so volume is bookings plus every diary edit, mostly in opening hours — and the Google steps ride the existing calendar-sync and housekeeping crons (no new cron). Watch Neon's operations log after turning it on, and again after switching `GOOGLE_CALENDAR_ID` to HarbourHair.
- **The chair rule adds one `GoogleDiaryEntry` read to the booking reads** (three more when the range holds a walk-in); it rides requests that are already awake. The diary is written only when it changed.
- **Beta booking costs a signed-out visitor nothing.** While booking is closed, `/book`, the slot/day lookups and the price preview read the session cookie only; the beta check (the live `SiteSettings` row, then the account's email, then calendar readiness for a tester) runs only for a signed-in caller, and in the lookups only after their input and per-address checks. With the switch off, the outbox reads the beta list once per per-appointment dispatch (inside actions that already woke the database); the crons still return before any query.
- **Housekeeping is on by default**: one daily wake at 03:15 UTC, about 2.5 CU-hours a month. It already carries retention, request lapses, Square reconciliation and the daily Google Calendar run, so put a new daily chore there rather than adding a cron. Likewise, a 30-minute chore rides calendar-sync (as the late-arrival rule does).
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
  env) or every PR's "Deploy Preview" fails. The last one applied by hand was
  `20261018120000_booking_beta_emails` (2026-10-18; before it `20261017180000_stylist_show_on_website`,
  `20261017150000_stylist_takes_walk_ins` and `20261017120000_google_diary_mirror` on 2026-10-17). The Blast Radius hook holds
  `prisma migrate` until the owner approves it; when they are away it times out, and the owner
  can run the §7 command themselves (a `!` line in Claude Code). Refresh the copy with a PostgreSQL 18
  `pg_dump` of production restored into it. The old us-east-1 project
  (`neon-beige-river`) is kept, unused, by owner decision.
- `infra/aws/treatwell-sync/` is a **dormant** EventBridge→Lambda fallback for
  the same endpoint. Do not deploy it; see its README.

### Source Layout

- `src/app/` — Next.js App Router pages and API routes
  - `[locale]/` — every page. English is served unprefixed, Chinese under `/zh-hk`, and `src/middleware.ts` rewrites. It covers:
    - the public pages, `auth/`, `book/`, `appointments/`, `privacy/`, `booking-terms/` and `kiosk/`;
    - `admin/`: the schedule home page, `services`, `stylists`, `shifts`, `timesheets`, `payroll`, `employees`, `blog`, `faqs`, `offers`, `discounts`, `reviews`, `users`, `settings`, `opening-hours`, `integrations` and `operations`.
  - `actions/` — Server actions by domain:
    - `auth.ts`, `booking.ts`, `booking-quote.ts`, `admin.ts`;
    - `admin-erasure.ts`, `admin-payments.ts`, `admin-settings.ts`, `admin-operations.ts`;
    - `admin-arrivals.ts` (Arrived, late-cancel restore), `admin-consultation-credit.ts`, `admin-google-calendar.ts` (Sync now, Clear Google busy time and diary copy, Diary colours), …
  - `lib/` — Shared utilities:
    - `prisma.ts`, `session.ts`, `session-hint.ts`, `rate-limit.ts`;
    - `booking-maintenance.ts` (the go-live gate), `online-booking-lock.ts`, `square-config.ts`;
    - `booking-constants.ts` (notice, late-arrival and consultation-credit constants), `late-arrival.ts`;
    - `calendar-links.ts`, `calendar-busy-display.ts`, `calendar-diary-display.ts`, `google-calendar-config.ts`, `google-channel-token.ts`, `google-aliases.ts`, `preview-email.ts`, …
  - `services/` — Business logic:
    - booking (`booking-service.ts`, `pending-request-lapse.ts`, `reschedule-request-lapse.ts`, `late-arrival-cancel.ts`, `consultation-credit.ts`);
    - pricing (`pricing/`: `policy.ts`, `eligibility.ts`, `quote.ts`, `public-catalog.ts`, …);
    - email (`email-service.ts`, `notification-outbox-service.ts`, `ops-alert-service.ts`);
    - `housekeeping-service.ts` and `operations-messages.ts`;
    - calendars (`calendar-sync-service.ts`, `calendar-busy-kind.ts`, `stylist-ical-feed.ts`, `stylist-ical-cache.ts`, `google-calendar-*.ts`, `google-busy-mapping.ts`, `google-diary-*.ts`, `diary-chair-*.ts`);
    - deposits (`deposit-*.ts`, `payment-*.ts`, `square-gateway.ts`, `square-webhook-events.ts`).
  - `api/` — API routes:
    - `cron/`: reminders, notifications, calendar-sync, housekeeping, and the gated treatwell-sync;
    - `health/`, `ical/[stylistId]/` (busy feeds), `webhooks/square/`, `webhooks/google-calendar/`;
    - `auth/` (Google OAuth, email verification, sign-out) and `session/`.
- `src/i18n/` — locales, routing helpers and the `messages/{en,zh}` dictionaries.
- `src/components/` — React components by feature (`booking/`, `admin/`, `appointments/`, `emails/`, `layout/`, …).
- `src/test/` — shared fixtures (`booking-fixture.ts`, `deposit-fixture.ts`, `payments-fixture.ts`) and page tests (`src/test/pages/`). `node --test` reads `[locale]` in a path as a glob, so a test placed under `src/app/[locale]/` never runs.
- `src/middleware.ts` — route protection and locale rewrites.
- `prisma/{dev,vercel,prod}/` — the three schemas, each with its own migrations folder; seed scripts.
- `scripts/` — `production-build-guard.mjs`, the PostgreSQL verification suites (`verify-*.ts`) and the handover PDF builder (`pdf/`).
- `docs/` — runbooks (`square-payments-setup.md`, `google-calendar-setup.md`, `data-erasure.md`) and design specs and plans (`superpowers/`).
- `infra/` — Vercel firewall rules (`vercel-firewall/`) and the dormant AWS fallback (`aws/`).
- `LAUNCH.md` — the launch checklist and the last verified production state.
- `vercel.json` — Cron job configuration
- `readme/structure.md` — Function/component registry

## Key Conventions

- **Server actions over API routes** for data operations. Place in `src/app/actions/`, use `'use server'` directive.
- **Use Prisma generated types** from `@prisma/client` — never create manual interfaces for database models.
- **Never access env vars at module level** — wrap in async functions for runtime access.
- **Email service uses `import 'server-only'`** — not `'use server'` (internal functions, not client-callable).
- **Booking needs a signed-in customer with a confirmed email.** `src/app/[locale]/book/page.tsx` redirects to sign-in with `?redirect=/book`, and every booking action checks again (`verifySession`, `hasVerifiedEmail`). Middleware deliberately does not gate `/book`: whether booking is open lives in the database, and middleware would need a DB read per request. While booking is closed, `/book` shows everyone the phone / Fresha / Treatwell page (`BookingClosedNotice`) — beta testers excepted (next bullet).
- **Beta booking (owner decision 2026-10-18).** While online booking is closed to the public (`bookingEnabled` off), a signed-in account whose `User.email` is on `SiteSettings.bookingBetaEmails` gets the whole online flow, Square deposits included: `/book`'s wizard, the slot/day lookups, the price preview, `submitBooking`, and Reschedule in My Bookings. The list lives in Admin → Settings ("Beta testers", one email per line, at most 20, no walk-in/erased placeholders; `lib/booking-beta.ts`), is stored lowercase `", "`-joined, is read from the live row on every check (never the day-cached `getSiteSettings()`, and kept out of that cached object: it is personal data) and takes effect on Save; the settings audit records only how many testers. Gate (`lib/booking-maintenance.ts`): `assertOnlineBookingReady` / `isBookingEnabled` stay the public gate, unchanged; `assertOnlineBookingReadyFor(db, userId)` (booking transactions and the deposit precheck) and `isBookingEnabledFor(userId)` / `isBetaBookingOpenFor(userId)` (pages and lookups) add the beta check, which still needs the Square payments lock to be off (production credentials), the same calendar readiness and the CALENDAR_SYNC_ENABLED / receivesBookings rule — but not `NOTIFICATIONS_ENABLED`, `bookingEnabled` or the operations readiness. It does not open anything to anyone else, and admin booking paths still never call the gate. Emails: with `NOTIFICATIONS_ENABLED` off, only a tester's appointments are emailed (the customer's mail and the salon's alert, through `dispatchAppointmentNotifications`); every other customer stays email-free and the crons (reminders, review requests, the ops alert) stay off — so testers get no reminder or review request.
- **Every UI string goes in both languages** (`src/i18n/messages/en` and `zh`, admin included; `completeness.test.ts` enforces it). Links go through the locale-aware helpers in `src/i18n/` so a `/zh-hk` visitor stays in Chinese.
- **Online booking opens in production only with Square PRODUCTION credentials.** In every production build (fails closed: a missing `VERCEL_ENV` counts; only an explicit Vercel preview is exempt) `isOnlineBookingLockedForPayments` in `lib/online-booking-lock.ts` makes `assertOnlineBookingReady` / `isBookingEnabled` answer "closed" before any DB read, and Admin → Settings refuses to switch booking on, unless `parseSquareConfig(env)` succeeds with `environment === 'production'`. No config, `SQUARE_PAYMENTS_ENABLED` not `true`, sandbox credentials or a config that does not parse all stay locked. `SQUARE_DEPOSITS_WIRED = true` records that the deposit code exists; setting it back to `false` re-locks every production build whatever the config. Deposits follow `docs/superpowers/specs/2026-10-13-square-deposits-design.md` in phases: S1 (payment tables, Admin → Settings deposit policy, per-service override, `services/deposit-quote.ts`, `previewBookingQuote`), S2 (`submitBooking` authorizes the deposit as a HOLD on the card through `services/payment-attempts.ts` and ties it to the request) and S3 (`services/deposit-lifecycle.ts`: staff confirming a request CAPTURE the deposit between two Serializable transactions; declining, withdrawing or lapsing it RELEASES the hold after the change commits, and a request whose hold has run out lapses early; cancelling a confirmed booking REFUNDS it through `services/payment-refunds.ts` — staff may keep it) and S4 (below) are in. Square is never called inside a transaction, an attempt only becomes CAPTURING in a transaction that saw its request PENDING, and every closing refuses while a capture is in flight. **Production Square credentials may be set once the sandbox acceptance list in `docs/square-payments-setup.md` §4 has passed on `main`** — every item on a local production build, plus the owner's short check on a Preview (3-D Secure with the console open, Square's own webhook, a refund, a decline; owner decision 2026-10-17, runbook §4 "How §4 is run"). It passed for 13dbe8f (locally 2026-10-17, the Preview check 2026-10-18; `readme/square-acceptance-2026-10-14.md`) (then §5 of the same runbook; S1–S4 are merged and live since 2026-10-13, #63). Deposit amounts read the policy from the `SiteSettings` row, never the day-cached `getSiteSettings()`. Money-safety rules (2026-10-13 review): outside a production build only SANDBOX credentials are usable (`usableSquareConfig`), so a preview or dev server can never move live money even if production vars leak into it; a refund claims SUBMITTING before Square is called and only a provable first send may end FAILED (a 4xx on a retry stays UNKNOWN for staff); Square's refund payload is payment + amount + key only (no free text), so a retry is byte-identical; a deliberate staff keep sets the attempt to KEPT (reconciliation never refunds it); declined cards are limited to 3 per account and 5 per IP a day (`createFailureLimiter`, never fails open). Review 2 (same day): only Square's HTTP 400/402 is a card decline — 401/403/404 and any other 4xx are the website's own Square setup (`FAILED` + `PAYMENT_SETUP_REFUSED`, customer told `PAYMENT_UNAVAILABLE`, no decline budget used, logged once per HTTP status, raised as a configuration problem); a deposit taken for a request nobody confirmed is lapsed and refunded only by the DAILY housekeeping run, 12 hours after its appointment ended (`TAKEN_DEPOSIT_LAPSE_GRACE_MS`; staff mark it completed to keep it, or decline it); `lastError` sentences that code reads back (Prisma `where`, `===`) are state keys pinned in `operations-messages.test.ts` — never reword one in place, add a key and a migration.
- **Square webhook and reconciliation (S4) — no polling cron.** `POST /api/webhooks/square` (`services/square-webhook-events.ts`) answers 404 while `usableSquareConfig()` is null and 413/401 (body over 64 KB, signature not matching the configured key and the CONFIGURED notification URL — never the Host header) before any DB access; event types it does not act on, other locations (also an event the schema cannot read that names one) and payments without a deposit reference (in-salon card-reader sales — Square notifies every payment on the account) are acknowledged before the database is opened (it is a public endpoint something external calls — see "Neon compute budget"); a refund (no reference to drop it by) whose payment is none of the site's deposits is looked up once and settled at once (`NOT_OURS`: never listed, emailed or re-read). Each `event_id` is stored once in `SquareWebhookEvent` (a repeat is a no-op); notices only move PAYMENT rows forward — Square's final COMPLETED/CANCELED/FAILED, never an older APPROVED — and never change a booking; a fresh CAPTURING claim is its approval's. When a notice says Square holds money no booking wants (an authorization that landed after the site gave up, a hold whose release failed) or took money the site believed held or released, the event stays open and the route reads Square afresh in `after()` and acts on THAT (`reconcileSquareEvent`). Reconciliation (`services/payment-reconciliation.ts`) rides the existing daily housekeeping run and Admin → Schedule → "Re-check payment" (`actions/admin-payments.ts`, admin-only, audited `PAYMENT.RECHECKED`): settles unanswered captures with S3's `settle`, releases AUTHORIZED holds whose booking is missing or not PENDING, confirms once with Square each hold S3 recorded EXPIRED by its date alone, cancels UNKNOWN authorizations by key every day for 7 days (cancel-by-key answers `{}` even when nothing has landed yet) then settles them VOIDED, resubmits REQUESTED/UNKNOWN refunds with the row's own key (each try dated on the row, so the batch — least recently tried first — rotates; 7 days after the refund was requested one that was sent becomes `UNRESOLVED`: counted, never resent, listed for staff) and follows PENDING ones, records a hold Square shows taken on a still-PENDING request as CAPTURED + `PAYMENT_CAPTURED_NOT_CONFIRMED` (a decline then refunds it at once; confirming still works), and refunds in full (`LATE_CAPTURE`) a deposit Square took after its booking closed or was never made. Every gateway comes from the guarded path (`depositGatewayFor` / `usableSquareConfig`; `createSquareGateway` has no default config) and only for the deposit's own Square environment and location. What still needs a person — Square refusing deposits because of the website's own setup (401/403/404), unanswered deposits, money taken on an unconfirmed request or on a cancelled booking with no refund or keep recorded, unreleased holds, failed, unanswered or `UNRESOLVED` refunds, late captures, unmatched notifications — is `services/payment-attention.ts`: the daily "needs attention" email (`PAYMENTS_NEED_ATTENTION`) and Admin → Operations → "Payments needing attention". Staff close a refund they settled themselves (Square Dashboard or cash) with the booking dialog's "Mark refund as settled outside the website" (`markRefundSettledOutside`, admin-only, audited `PAYMENT.REFUND_SETTLED_OUTSIDE`: REQUESTED / UNKNOWN / UNRESOLVED / stale SUBMITTING → `SETTLED_EXTERNALLY`, counted, never sent again). Dev, unit tests and CI integration scripts are not locked; a local `pnpm build && pnpm start` rehearsal is (without production Square credentials). **Runbook** (what the site does at each step, env vars, sandbox setup on Preview, acceptance tests, production go-live, staff operations, preview-database migration): `docs/square-payments-setup.md`. The customer-facing rules live on `/booking-terms` (`legal.bookingTerms`, its notice and patch-test periods read from code constants) and in the privacy notice — keep both true when the payment rules change.
- **24-hour cancellation/reschedule policy** — enforced server-side in booking actions; a reschedule request's new time must also be ≥ 24 h away.
- **Customer reschedules are staff-approved requests** (`requestReschedule` → `decideRescheduleRequest`); the booking stays CONFIRMED at its original time until approval, which refreshes the stylist's Fresha feeds and re-checks the slot in a Serializable transaction. Unanswered requests lapse 24 h before the requested time (notifications cron).
- **Consultation credit** (`services/consultation-credit.ts`, spec `2026-10-16-consultation-credit-pricing-ux-design.md` §2): a paid consultation or patch test (COMPLETED, or CONFIRMED and started and not late-cancelled) is taken off a consultation-required treatment starting within `CONSULTATION_CREDIT_MONTHS` (6, salon-local calendar months), **used once**: a live booking holding it uses it up, and a cancelled treatment frees it. **Staff apply it, in Admin only** (online customers cannot book consultation-required services): the booking dialog previews it (`actions/admin-consultation-credit.ts`) and `createAppointmentByAdmin` / `editAppointmentByAdmin` — and a late-cancellation restore — **look it up again inside the booking's Serializable transaction**, never trusting an amount from the browser. Capped at the price less any captured deposit; recorded beside the price (`consultationCreditFromId`, `consultationCreditPence`) — `priceAtBooking` / `quoteJson` never change. Shown as "Consultation credit −£X" plus what is left to pay on the confirmation and reminder emails, My Bookings and the admin board (not on a cancelled booking). Treatments booked through Fresha or by phone outside Admin are not tracked: staff deduct the fee at the till (`LAUNCH.md` §4).
- **Price after consultation:** `effectivePriceNature(service)` (`services/pricing/policy.ts`) makes a consultation-required service's price `SUBJECT_TO_CONSULTATION` whatever its row stores — a code rule, not per-service data. It is applied to the public catalogue (`public-catalog.ts`: "From £X — final price confirmed at your consultation", JSON-LD `minPrice`) and to every recorded quote (`buildQuote`), so confirmations, reminders and My Bookings never state a fixed amount left to pay for such a booking.
- **NHS/student prices and offer terms:** an NHS-priced option (`requiresEligibilityProof`, `services/pricing/eligibility.ts`) carries the `pricing.eligibilityProof` notice (bring an NHS staff ID or student card, else the standard price applies) in the booking wizard, the request, confirmation and reminder emails and My Bookings. The five offer and discount-code terms (`legal.bookingTerms.offers`, rendered by `components/legal/OfferTerms.tsx`) appear on `/booking-terms` and `/offers`. Discount codes stay paused (`DISCOUNTS_PAUSED` in `services/pricing/policy.ts`, a constant); before unpausing, those terms must be enforced in code, not only stated.
- **Who customers see, who takes walk-ins** (owner, 2026-10-17). Two switches per stylist, in the Admin → Stylists list (one click, `setStylistSwitch`) and on the Edit page:
  - **Show on website** (`Stylist.showOnWebsite`, default on). Off: left out of every public stylist query (`stylists/slug.ts`, sitemap), the `/book` list, "Anyone" (`getAvailableSlotsUnion`, `getBookingDays(ANY)`, `eligibleStylistIds`) and the online-booking coverage gate (`getCalendarSyncCoverage`, so a new starter with no rota or Fresha feed never closes booking), and `createBooking` / `createBookingForFirstAvailable` / `precheckBookingRequest` refuse them (`assertShownOnWebsite`, `STYLIST_UNAVAILABLE`). Their times still read by name (a customer rescheduling an existing booking uses the same lookups), and they stay in Admin, the Google diary, staff bookings and their Fresha feed. Admin lists come from `getStylistsForAdmin` / `getStylistById`, never the public helpers.
  - **Takes walk-ins** (`Stylist.takesWalkIns`): the chair rule (Architecture → Calendars → Diary mirror).
  - **Admin → Employees → "Also add as stylist"** (new employee, or one never linked): `services/stylist-from-employee.ts` makes the linked stylist in the employee's transaction: the employee's name, the job title as the role in both languages (published and marked reviewed), **hidden from the website**, takes walk-ins on, a free slug (`mei`, `mei-2`…). Picking an existing stylist as well is refused (`STYLIST_BOTH`).
- **Admin calendar drags and resizes ask first** (`components/admin/MoveConfirmDialog.tsx`): nothing is saved until staff press Move; focus starts on Cancel, and clicks in the first 350 ms are ignored (iPad ghost taps).
- **Use regular `<img>` for external/CDN images**, `next/image` only for local `public/` assets.
- **Tailwind CSS only** for styling. The brand is **monochrome black/white/grey** (client requirement) — never reintroduce the old blue `#174F7F` or gold.
- **readme/structure.md**: Check before creating new functions/components to avoid duplication.

### Booking and operations rules (2026-10-13 review — keep them)

- **Online requests need `MIN_BOOKING_NOTICE_MINUTES` (120) notice** (`lib/booking-constants.ts`); staff-entered bookings are exempt. A repeat submission (same customer, service and start — with the same stylist when one is named, any stylist for "Anyone") returns the existing request instead of booking twice, and the wizard says it was already requested; the same time with a different named stylist is a deliberate second booking. When a deposit is due the same rule (`findExistingRequest`, sharing `repeatRequestWhere` with `findRepeatRequest`) is checked before the card is touched, so a repeat never authorizes a card; keep the two lookups on one rule.
- **Unanswered requests lapse once their appointment has ended** (start + `durationAtBooking ?? service.duration`, `hasAppointmentEnded`; `services/pending-request-lapse.ts`, run by the notifications cron and by housekeeping) — never at the start: a staff pencil-in is PENDING too, its customer may be in the chair, and a cancelled booking leaves the busy feed at once. Staff cannot confirm a request that has started, but can mark it completed or decline it; a decline after the start sends the `REQUEST_LAPSED` email under the lapse step's own rule (`services/request-lapse-notice.ts`). Cron code invalidates the busy feed with `invalidateStylistIcalFeedFromCron()` — `updateTag` only works in Server Actions.
- **"Mark completed" only once an appointment has started** (a confirmed booking, or a started request whose customer came in). The outbound busy feed exports every non-cancelled booking until it ends, completed ones included, so Fresha cannot resell a chair that is still in use.
- **Late arrivals** (`services/late-arrival-cancel.ts`, rules in `lib/late-arrival.ts`, constants in `lib/booking-constants.ts`, spec `2026-10-16-late-arrival-auto-cancel-design.md`): switched on in Admin → Settings (`SiteSettings.lateAutoCancelSince`, off by default; read from the live row, never the cached settings). The calendar-sync cron (no new cron; it needs `CALENDAR_SYNC_ENABLED=true` and runs in staff hours) then cancels, at its first tick 15 minutes or more after the start, a CONFIRMED booking not marked Arrived, only if it was both created and starts after the switch-on, started within the last 120 minutes and has no open customer reschedule request. The deposit is kept (KEPT, as a no-show) and `LATE_CANCELLED` is emailed 30 minutes later. Staff tap Arrived (arrivals panel `components/admin/LateArrivalPanel.tsx` / booking dialog; `markArrived` in `actions/admin-arrivals.ts`) or move the booking when a customer phones ahead; Mark completed and staff bookings starting within 15 minutes of entry count as arrived. A move outside the arrival window clears the arrival, unless the customer is already there and it stays the same day. Restore within 24 h (`restoreLateCancellation`, audited `APPOINTMENT.LATE_CANCEL_RESTORED`: KEPT → CAPTURED, drops the unsent email, re-checks any consultation credit). The privacy notice describes it as the one automated decision.
- **Calendar files** (`lib/calendar-links.ts`) — the customer's side, Google Calendar option A: links and files only, no Google API (the salon calendar's two-way sync, under Architecture → Calendars, is separate):
  - Confirmed bookings carry an "Add to Google Calendar" link and an RFC 5545 `.ics` on the confirmation, reschedule and reminder emails and on My appointments.
  - The emailed file has an ORGANIZER and a matching `method` on its MIME type.
  - A cancellation sends `METHOD:CANCEL` only when the booking had been confirmed (`wasConfirmed`); a request that was never confirmed gets no calendar file.
- **Email verification is GET → confirm page → POST.** Never verify (or consume anything) on a GET: mail scanners open every link. Every public form that sends email (registration, verification resend, password reset, marketing unsubscribe) shares a 20-per-IP daily cap (`emailSendDailyLimiter`).
- **Customer erasure goes through Admin → Users** (`actions/admin-erasure.ts`, `docs/data-erasure.md`): anonymise, never delete a customer row (it cascades the booking history). The privacy notice (`messages/*/legal.ts`) states retention periods — keep it true when retention code changes.
- **Every fixed `lastError` sentence a job writes is catalogued** in `services/operations-messages.ts` (a test enforces it) so Admin → Operations can translate it.
- **No `images.remotePatterns`.** Remote images render as plain `<img>`; a remote pattern lets anyone run billed optimisations on that host.
- **The monochrome brand is enforced by `src/app/brand-monochrome.test.ts`.**
- **Deploys are serialised** (`deploy.yml` concurrency: runs on main queue and are never cancelled mid-flight; a queued run is superseded by a newer one, so the newest commit deploys last; the Vercel CLI is pinned — bump it on purpose). With the `NEON_API_KEY` secret and `NEON_PROJECT_ID` variable set, each production deploy first takes a compute-less Neon branch (`predeploy-*`, newest three kept).
- **A skip-CI marker in main's head commit message deploys nothing.** GitHub runs no workflow for a push whose head commit message contains `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` or `[actions skip]` — even quoted inside an explanation — and a squash merge copies every commit message of the PR into one body. On 2026-10-13 #62's squash body quoted the marker, so its push ran no CI and no deploy, and production silently stayed on the old code until the next push. In commit messages write "skip-ci marker", never the bracketed form; before merging, check the squash body (or pass `gh pr merge --squash --body …`); after merging, confirm a `push` run for the new main SHA appears in Actions.

### Security guardrails (2026-09-29 audit, PRs #48–#55 — keep them)

- **Google sign-in:** a *first* Google sign-in may create or link an account only when Google is authoritative for the address (gmail/googlemail, or a Workspace `hd` claim), and never auto-links an administrator — `decideGoogleLink` in `lib/google-oauth.ts`. Linking an existing customer keeps their password only when the account's email was already confirmed (`emailVerifiedAt`: a verification link or a redeemed reset — the mailbox owner set it; owner decision 2026-10-18); a password on a never-confirmed email is destroyed with its reset links and every session (`sessionVersion`), because it may have been planted by someone who pre-registered the address. Already-linked identities sign in by Google id.
- **Any code that sets a password** (admin reset, bootstrap, Google takeover defence, reset redemption) revokes that account's unused `PasswordResetToken`s in the same transaction. New passwords are capped at **72 UTF-8 bytes** (`fitsBcryptLimit`) — bcrypt ignores the rest.
- **Rate limits** go through `lib/rate-limit.ts` and never fail open. Login and reset requests have per-IP *and* per-account buckets (keyed by `accountRateLimitKey`, a hash); a signed `login_device` cookie (`lib/login-device.ts`) lets a browser that signed in before skip the account bucket so strangers cannot lock the owner out.
- **Sign-out ends every session, everywhere** (`POST /api/auth/signout`, `endAllSessions` in `lib/session.ts`): it bumps `sessionVersion`, so the account's other devices are signed out too, and answers with `Clear-Site-Data: "cache", "storage"` plus a full-page navigation, so no signed-in page survives in the HTTP or router cache. Never move sign-out back into a Server Action (it cannot send that header) or add a GET (link scanners).
- **Self-service booking requires a confirmed email** (`hasVerifiedEmail`: `User.emailVerifiedAt` or a linked Google account).
- **Security review 2026-10-16 (keep):**
  - Seeing or changing a booking needs the address proved too: My Bookings shows a confirm-your-email prompt; `cancelAppointment` / `requestReschedule` / `withdrawRescheduleRequest` answer `MANAGE_EMAIL_NOT_VERIFIED`; `createReview` is gated the same way. Reason: staff attach phone bookings to whichever account holds the email, and anyone can register an address.
  - Reviews only for CONFIRMED or COMPLETED visits (never PENDING), and moderation shows the visit's date and whether it happened.
  - Daily ceilings: `bookingDailyLimiter` (10 a day per user, alongside 6 an hour) and `cancelLimiter` (10 a day). `depositAuthorizeIpLimiter` (20 card authorizations a day per address) is spent atomically BEFORE Square is asked, because the decline budgets are only counted after Square answers.
  - Registration names refuse links, `@`, `<>` and control characters (they greet the address owner in booking emails).
  - Account enumeration through registration and reset timing is an accepted trade-off.
- **Public availability actions** refuse any date outside `isBookableDateWindow` *before* touching the database, and have a per-IP limiter. Requesting the booking's current (or already-requested) time is a no-op; real requests are limited per customer and per appointment.
- **Marketing unsubscribe** needs the signed emailed link (`lib/unsubscribe-token.ts`); the form never changes the list.
- **Vercel Firewall:** the scanner-probe deny rule lives in the **project firewall**, versioned in `infra/vercel-firewall/` (apply with the CLI, see its README). **Never** put `routes` + `mitigate` in `vercel.json`: that deployment challenged *every* request, which Fresha's and Treatwell's iCal pollers cannot pass. Rate-limit rules are usage-billed — none are used.
- **Spend Management:** intended as a US$10 on-demand budget with **email alerts only** (never pause production — the site would go offline). Set in the dashboard (Team → Settings → Billing).
- **Planned, not built:** slot holds with a live Fresha check — `docs/superpowers/specs/2026-09-29-booking-slot-hold-and-live-sync-design.md` and its phase-1 plan.
