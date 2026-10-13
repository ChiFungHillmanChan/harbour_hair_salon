# Harbour Hair Salon

A bilingual Next.js 16 website for Harbour Hair Salon in Leeds, in English and Traditional Chinese (`/zh-hk`). It is live at https://www.harbourhair.co.uk.

It offers:
- online booking **requests** that the salon confirms, with optional Square card deposits;
- customer appointment management with Google Calendar links and `.ics` files;
- an admin panel and a staff kiosk;
- availability exchanged with Fresha through iCal busy feeds.

It runs on Vercel with Neon PostgreSQL 18 in London.

## Status (2026-10-13)

- The public site is live. Releases #62 (review follow-ups, Google Calendar links, i18n) and #63 (Square deposits) are deployed and verified.
- **Online booking is closed.** It opens only once Square production credentials are set, after the sandbox acceptance checklist has passed. Until then customers book by phone, Fresha or Treatwell.
- The remaining launch steps, in order, are in [LAUNCH.md](LAUNCH.md).

## What it does

**Customers**
- Browse services and pricing, stylists, the blog, offers and reviews. Every page exists in both languages.
- Register or sign in with email + password or Google. A confirmed email address is needed before booking.
- Request a booking: at least 2 hours ahead, and the salon confirms it.
- When deposits are on, the card is only **held** at request time. It is charged when the salon confirms, released if the request is declined, withdrawn or lapses, and refunded when a confirmed booking is cancelled.
- View and cancel bookings (24 hours or more ahead online), and request a reschedule.
- Add confirmed bookings to Google Calendar or download an `.ics` file.
- Read the [privacy notice](https://www.harbourhair.co.uk/privacy) and the [booking terms](https://www.harbourhair.co.uk/booking-terms).

**Salon staff (admin)**
- **Schedule:** confirm or decline requests, mark visits completed, and take, refund or keep deposits.
- **Content and pricing:** services & pricing (with per-service deposits), stylists, blog, FAQs, offers, discounts and reviews.
- **Staff:** shifts, timesheets and payroll.
- **Users:** includes customer data erasure.
- **Site settings:** the booking switch and the deposit policy.
- **Integrations:** calendar connections and setup readiness.
- **Operations:** diagnostics, background jobs and payments needing attention.
- **Staff kiosk** on a shared salon device.

**Background**
- Four Vercel crons:
  - reminders, plus the daily "needs attention" email;
  - email delivery;
  - calendar sync;
  - daily housekeeping: retention clean-up, lapsing unanswered requests and Square reconciliation.
- A signed Square webhook at `/api/webhooks/square`.

## Production behaviour

- Website bookings are requests until the salon confirms them.
- Online booking opens only when every check in `assertOnlineBookingReady` (`src/app/lib/booking-maintenance.ts`) passes:
  - Square production credentials, in production builds;
  - `NOTIFICATIONS_ENABLED=true`;
  - the Admin → Settings booking switch;
  - calendar readiness;
  - a passing Admin → Operations diagnostics run.
- Calendar connections exchange iCal busy periods.
  - Fresha works both ways.
  - Treatwell can only import, because it has no export feed.
  - They never create marketplace orders, payments or refunds, and never relay one marketplace's events into another.
- Booking emails wait in an outbox and are only sent while `NOTIFICATIONS_ENABLED=true`. Account emails (verification, password reset) go out at once. Preview deployments only email the addresses in `PREVIEW_EMAIL_ALLOWLIST`, because the preview database is a copy of production.
- Production is deployed **only** by [GitHub Actions](.github/workflows/deploy.yml) after CI passes on `main`.
  - The production build applies PostgreSQL migrations first. Preview builds skip them, so new migrations are applied to the preview database by hand.
  - Runs on `main` queue, and the newest commit deploys last.
  - A head commit message containing a skip-CI marker deploys nothing. Check squash-merge bodies for one.

## Documentation

| Document | What it covers |
|---|---|
| [LAUNCH.md](LAUNCH.md) | Launch checklist and the last verified production state |
| [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) | Architecture, commands, conventions and guardrails for contributors |
| [docs/square-payments-setup.md](docs/square-payments-setup.md) | Square runbook: sandbox setup, acceptance tests, go-live, staff operations |
| [docs/superpowers/specs/2026-10-13-square-deposits-design.md](docs/superpowers/specs/2026-10-13-square-deposits-design.md) | Card-deposit design |
| [docs/data-erasure.md](docs/data-erasure.md) | Customer data erasure procedure |
| [readme/structure.md](readme/structure.md) | Function and component registry |
| [readme/production-readiness-rollout-cantonese.md](readme/production-readiness-rollout-cantonese.md) | Rollout record (Cantonese) |
| [readme/backend-security-operations.md](readme/backend-security-operations.md) | Administrator bootstrap, recovery, signing-key rotation, kiosk revocation, database maintenance. Its MFA steps describe dormant code: admin MFA stopped being required in `e9f3a25`. |
| [readme/upgrade-verification-2026-09-16-cantonese.md](readme/upgrade-verification-2026-09-16-cantonese.md) | The 2026-09-16 upgrade verification report |

### Salon handover

Use the [fillable Cantonese PDF](output/pdf/harbour-hair-salon-handover-fillable.pdf) for:
- the salon visit;
- account invitations;
- staff schedules;
- calendar evidence;
- launch acceptance.

Save a separate completed copy. Never put passwords, API keys, private calendar URLs or completed customer forms in Git. The PDF builder lives in `scripts/pdf/`. It needs ReportLab, pypdf, fontTools and an embeddable CJK font. Only the blank master belongs in this repository.

## Development and verification

Use Node.js 24 LTS (`nvm use`) and pnpm 10.33.0. CI reads `.nvmrc`, and `packageManager` pins the pnpm version. Install with `pnpm install --frozen-lockfile`. Database, test and deploy commands are in [CLAUDE.md](CLAUDE.md#commands).

```bash
pnpm lint
pnpm test                 # all unit tests
pnpm test:square          # the Square deposit subset
pnpm exec tsc --noEmit
pnpm build                # needs a database for page data
```

The PostgreSQL suites are `pnpm test:integration`, `pnpm test:booking-lifecycle` and `pnpm test:backend-http`.
- They accept only a disposable, migrated localhost database named `salon_test`, through `SALON_TEST_DATABASE_URL`. Never use production or preview credentials.
- `test:backend-http` also needs `pnpm build` first.
- CI runs all of the above against PostgreSQL 18 on every pull request to `main` and on every push to `main`.
