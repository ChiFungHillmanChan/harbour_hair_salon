# Harbour Hair Salon

A bilingual Next.js 16 website for Harbour Hair Salon in Leeds, in English and Traditional Chinese (`/zh-hk`). It is live at https://www.harbourhair.co.uk.

It offers:
- online booking **requests** that the salon confirms, with optional Square card deposits;
- customer appointment management with Google Calendar links and `.ics` files;
- an admin panel and a staff kiosk;
- availability exchanged with Fresha through iCal busy feeds;
- a two-way sync with the salon's own Google Calendar diary, mirrored in the admin schedule.

It runs on Vercel with Neon PostgreSQL 18 in London.

## Status (2026-10-18)

- The public site is live. Releases #62 (review follow-ups, Google Calendar links, i18n) and #63 (Square deposits) are deployed and verified.
- Deployed on 2026-10-16: Fresha blocked time labelled "Blocked" in the schedule (#68), sign-out that ends every session (#69), late-arrival auto-cancel (#70, switched off), consultation credit, "From £X" prices for consultation services, move confirmation and NHS/student and offer terms (#71), and two-way Google Calendar sync (#72, switched on the same day).
- Deployed on 2026-10-17/18: the Google diary mirror (#75), "Takes walk-ins" and "Show on website" for stylists (#76, #77), mobile admin improvements (#78), cancelled bookings on the desktop schedule (#80) and beta booking (#81).
- **Online booking is closed to the public; beta testers can book.** The Square sandbox acceptance list passed on 2026-10-17/18 ([record](readme/square-acceptance-2026-10-14.md)), the Square production keys and webhook were set on 2026-10-18, and a real £0.01 test booking passed (hold, capture on approval, refund on cancellation). Only the accounts in Admin → Settings → Beta testers (currently the owner) can book online; everyone else books by phone, Fresha or Treatwell until launch ([LAUNCH.md](LAUNCH.md) §3).
- **Test deposit kept on purpose:** "Short Over Ears - Wash, Haircut & Blow Dry" takes a £0.01 deposit so testers can check real cards for a penny. It is removed before public booking opens.
- **Switched off until the salon is ready:** the late-arrival rule (Admin → Settings, after briefing staff).
- **Google Calendar sync is on** (since 2026-10-16): since 2026-10-17 bookings are written to the salon's own "HarbourHair" diary (harbourhairuk@gmail.com), mirrored in Admin → Schedule (below); #72's "Harbour website bookings" calendar is switched off but kept ([runbook](docs/google-calendar-setup.md)). Google sign-in and the calendar's service account both live in the `harbourhair` Google Cloud project.
- **Google diary mirror** (live since 2026-10-17): Admin → Schedule mirrors the salon's "HarbourHair" diary by colour ([runbook](docs/google-calendar-setup.md) §2b).
- **Fresha:** Funky, Ivan and (since 2026-11-03) **Lox** exchange busy time both ways: inbound on, Fresha subscribed to their website busy feeds, and "This provider takes bookings" ticked in Admin ([LAUNCH.md](LAUNCH.md) §3.3). **Shania** is not sold on Fresha (her "takes bookings" was switched off in Admin on 2026-10-18) and is hidden from the website.
- **Treatwell:** reads Funky's, Ivan's and Lox's website busy feeds every 5 minutes (checked 2026-11-03: the same blocks as the website). Treatwell has no export feed, so its bookings reach the website only when staff copy them into the HarbourHair diary (red `TW` for "any stylist"); the owner accepted that risk on 2026-10-25.
- **Decided 2026-10-18:** the 48-hour deposit rule and the short set of customer emails (below).
- The remaining launch steps, in order, are in [LAUNCH.md](LAUNCH.md).

## What it does

**Customers**
- Browse services and pricing, stylists, the blog, offers and reviews. Every page exists in both languages.
- Services that need a consultation (colouring, perms) show a "From £X" price, confirmed at the consultation. The consultation's fee comes off that treatment if it goes ahead within 6 months. Styling can be booked directly.
- NHS and student prices need proof of eligibility at the appointment. The offer and discount-code terms are on `/offers` and `/booking-terms`.
- Register or sign in with email + password or Google. A confirmed email address is needed before booking, and before viewing or changing a booking.
- Request a booking: at least 2 hours ahead, and the salon confirms it. Services that need a consultation are booked as a "Consultation" or "Consultation & Patch Test" (£15; colour needs the patch test at least 48 hours before); staff then book the treatment in Admin, with the £15 taken off.
- When deposits are on, the card is only **held** at request time. It is charged when the salon confirms, and released if the request is declined, withdrawn or lapses. A confirmed booking cancelled **48 hours or more** before it starts gets the deposit back in full; cancelled later, or missed, the deposit is kept (owner decision 2026-10-18; My Bookings says which before the customer confirms). If the salon cancels, the deposit is refunded.
- When the late-arrival rule is on, a confirmed booking not marked Arrived 15 minutes after its start is cancelled and its deposit kept (staff also mark customers who phone ahead). The salon can restore it within 24 hours.
- View and cancel bookings (24 hours or more ahead online; the deposit is refunded only 48 hours or more ahead), and request a reschedule.
- Emails (the short set, 2026-10-18): the confirmation, a reminder (only for a booking confirmed at least 24 hours before it starts), and an email for each change, cancellation or request the salon could not confirm. No "request received" or review-invitation emails.
- Add confirmed bookings to Google Calendar or download an `.ics` file.
- Read the [privacy notice](https://www.harbourhair.co.uk/privacy) and the [booking terms](https://www.harbourhair.co.uk/booking-terms).

**Salon staff (admin)**
- **Schedule:** confirm or decline requests, mark visits completed, and take, refund or keep deposits.
  - Mark customers **Arrived**, and restore a late-arrival cancellation.
  - Drag or resize bookings; the calendar asks before saving the move.
  - Apply consultation credit when booking a treatment.
  - Fresha time shows as "Blocked" or "Fresha booking".
- **Content and pricing:** services & pricing (with per-service deposits), stylists, blog, FAQs, offers, discounts and reviews.
- **Staff:** shifts, timesheets and payroll.
- **Users:** includes customer data erasure.
- **Site settings:** the booking switch, beta testers (accounts that may book online while booking is closed), the deposit policy and the late-arrival rule.
- **Integrations:** Fresha calendar connections, setup readiness, and the Google Calendar status with "Sync now", "Clear Google busy time and diary copy" and the diary colours.
- **Operations:** diagnostics, background jobs and payments needing attention.
- **Staff kiosk** on a shared salon device.

**Background**
- Four Vercel crons:
  - reminders, plus the daily "needs attention" email;
  - email delivery;
  - calendar sync, which also runs the late-arrival rule and the Google Calendar retries;
  - daily housekeeping: retention clean-up, lapsing unanswered requests, Square reconciliation and the daily Google Calendar run.
- A signed Square webhook at `/api/webhooks/square`.
- A token-checked Google Calendar webhook at `/api/webhooks/google-calendar`.

## Production behaviour

- Website bookings are requests until the salon confirms them.
- Online booking opens only when every check in `assertOnlineBookingReady` (`src/app/lib/booking-maintenance.ts`) passes:
  - Square production credentials, in production builds;
  - `NOTIFICATIONS_ENABLED=true`;
  - the Admin → Settings booking switch;
  - calendar readiness;
  - a passing Admin → Operations diagnostics run.
- **Beta booking:** while it is closed, a signed-in account listed in Admin → Settings → Beta testers still gets the online flow (it needs the Square production keys and calendar readiness, not the switch or notifications), and only that tester's booking emails are sent.
- Deposits: 50% of the booked option's price (half a penny rounds up), or a per-service fixed amount (both consultations: £15); the card is held at request time and charged only when staff confirm.
- Calendar connections exchange iCal busy periods.
  - Fresha works both ways.
  - Treatwell can only import, because it has no export feed.
  - They never create marketplace orders, payments or refunds, and never relay one marketplace's events into another.
- Google Calendar sync (when switched on) uses the salon's primary "HarbourHair" calendar, its real diary.
  - Every website booking is written to it, in its stylist's Google colour.
  - Admin → Schedule shows the diary with Google's titles and colours, read-only.
  - An event in a stylist's colour, or naming a stylist (leave), blocks that stylist; those blocks also go out in the Fresha busy feed.
  - An event in the no-stylist colour (a walk-in) takes a chair: online booking keeps a stylist free for it. Only stylists ticked "Takes walk-ins" in Admin → Stylists count (an assistant is unticked). It is never sent to Fresha.
  - Admin → Stylists → "Show on website": a hidden stylist is not on the public pages and cannot be booked online (nor through "Anyone"), but stays in Admin, the diary and staff bookings. Admin → Employees → "Also add as stylist" makes a hidden, linked stylist for a new member of staff.
  - Any other event is a note and blocks nothing. "Show as available" is ignored.
  - Edits to the website's own events in Google are reverted.
  - It runs on Vercel Production only, never on previews.
- Booking emails wait in an outbox and are only sent while `NOTIFICATIONS_ENABLED=true` (beta testers' bookings excepted). One online booking sends 3: the salon's alert, the customer's confirmation and (usually) a reminder; the request and reschedule-request acknowledgements and the review invitation are retired (`RETIRED_CUSTOMER_EMAIL_KINDS`). Account emails (verification, password reset) go out at once. Preview deployments only email the addresses in `PREVIEW_EMAIL_ALLOWLIST`, because the preview database is a copy of production.
- Production is deployed **only** by [GitHub Actions](.github/workflows/deploy.yml) after CI passes on `main`.
  - The production build applies PostgreSQL migrations first. Preview builds skip them, so new migrations are applied to the preview database by hand.
  - Runs on `main` queue, and the newest commit deploys last.
  - A head commit message containing a skip-CI marker deploys nothing. Check squash-merge bodies for one.

## Documentation

| Document | What it covers |
|---|---|
| [LAUNCH.md](LAUNCH.md) | Launch checklist and the last verified production state |
| [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) | The agent guide: what the project is, stack, structure, commands, workflow and the rules that must not break |
| [docs/agents/](docs/agents/) | The guide's detail: architecture, booking and payments rules, security, Neon budget, environment variables, production state |
| [docs/square-payments-setup.md](docs/square-payments-setup.md) | Square runbook: sandbox setup, acceptance tests, go-live, staff operations |
| [docs/google-calendar-setup.md](docs/google-calendar-setup.md) | Google Calendar runbook: Google Cloud and calendar setup, diary colours and names, the switch to HarbourHair, Vercel variables, first run, changing the calendar, secret rotation, turning it off |
| [docs/data-erasure.md](docs/data-erasure.md) | Customer data erasure procedure |
| [docs/superpowers/specs/](docs/superpowers/specs/) | Design specs: [card deposits](docs/superpowers/specs/2026-10-13-square-deposits-design.md), [late-arrival auto-cancel](docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md), [consultation credit and pricing](docs/superpowers/specs/2026-10-16-consultation-credit-pricing-ux-design.md), [Google Calendar sync](docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md), [Google diary mirror](docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md) |
| [readme/square-acceptance-2026-10-14.md](readme/square-acceptance-2026-10-14.md) | Square sandbox acceptance record (2026-10-14/15, and the 2026-10-17/18 run on `main`) |
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
