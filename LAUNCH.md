# Launch checklist — Harbour Hair Salon

Last verified against production: **2026-10-12 23:56 UTC** (read-only checks, `main` @
`a20310b`, PR #61), plus the 2026-10-13 production-readiness review.

> **Status:** the public site is live and stable. **Online booking is closed** — by the
> Square lock in code (production opens only with Square production credentials, see §2)
> and by configuration (§3). The 2026-10-13 review's code findings are fixed in the
> "review follow-ups" release (§1); Square deposits are built in a separate release (§2).
>
> **Deploys:** merge to `main`; GitHub Actions tests and deploys. Runs on `main` queue
> (never cancel mid-flight) and only main's current head builds and deploys. Local
> `vercel --prod` is refused by `scripts/production-build-guard.mjs`.

Work top to bottom. The order in §3 is **load-bearing**.

---

## 0. Current state (verified 2026-10-12/13, not assumed)

| Area | State |
|---|---|
| Tests / `tsc` / lint / audit | All green — 1,247 tests with the follow-ups release (1,057 before); CI also replays migrations on PostgreSQL 18 and runs the integration, booking-lifecycle and HTTP suites |
| Online booking | **CLOSED** — `SiteSettings.bookingEnabled=false`, plus the Square lock |
| Notifications | `NOTIFICATIONS_ENABLED=false` — customers get no booking email yet |
| Calendar sync | `CALENDAR_SYNC_ENABLED=true`; Fresha inbound OK for all 4 stylists |
| Fresha outbound confirmed | Funky ✅ Ivan ✅ **Lox ❌ Shania ❌** — blocks the go-live gate **and** staff approvals |
| Treatwell | Active stylists `receivesBookings=false` (accepted blind spot: Treatwell has no export feed) |
| Housekeeping | `HOUSEKEEPING_ENABLED` unset — off until the follow-ups release, which makes it **on unless set to `false`** (the privacy notice's retention periods depend on it) |
| Operations diagnostics | Last run 2026-09-20, **never passed** |
| Neon | Free plan (100 CU-h/month, overrun **suspends** the database until next month); Oct 1–12 used 17.6 CU-h (~45/month pace); 6-hour restore history |
| Crons (UTC) | reminders `0 8` (+ daily ops alert), notifications `*/30 8-19`, calendar-sync `*/30` (staff hours ±15 min), housekeeping `15 3` |
| Migrations | 21 applied, none pending |
| Accounts | 1 admin, 12 customers |

---

## 1. Code — 2026-10-13 review follow-ups (release 1)

- Mark completed only once an appointment has started (with confirmation), started requests
  included; the busy feed keeps completed bookings until they end, so Fresha cannot resell the slot.
- PENDING requests lapse once their appointment has ended (notifications cron, and daily housekeeping
  while notifications are off; the customer is told if they had a request email). From the start staff
  cannot approve them; declining one then sends the same "couldn't confirm in time" email.
- No "cancelled" email for bookings that already happened; admin emails stored lowercase;
  customer erasure tool in Admin → Users (`docs/data-erasure.md`).
- Customer email language saved at sign-up / Google sign-in / booking; staff choose it for
  walk-ins.
- Privacy notice rewritten (lawful basis, retention, rights, ICO, processors, cookies) and linked
  from sign-in and registration. **Owner to confirm** the legal entity name and retention periods.
- Email verification needs a click on a confirm page (mail scanners can no longer verify);
  per-IP daily caps on registration, verification and reset emails.
- Duplicate retries no longer create two requests (the wizard says it was already requested; a
  different named stylist at the same time is a real second booking); the wizard says "closed" when the
  gate closes mid-session; 2-hour minimum notice for online requests (`MIN_BOOKING_NOTICE_MINUTES`).
- "Add to Google Calendar" + `.ics` for confirmed bookings (emails and My appointments); the emailed
  file carries an ORGANIZER and a matching `method` on its MIME type, and a cancelled request that was
  never confirmed gets no calendar file.
- Deploy pipeline: concurrency, head-of-main check, pinned Vercel CLI, optional Neon snapshot
  before migrations (needs `NEON_API_KEY` secret + `NEON_PROJECT_ID` variable in GitHub).
- Daily "needs attention" email to the salon (failed emails, failing jobs, dead feeds, waiting
  requests, housekeeping switched off) — sent from the 08:00 UTC reminders run, so only while
  notifications are on.
- Monochrome confirmation email and admin controls; click-to-load map; image optimizer limited
  to local files; translated Operations messages, share-card alt text, placeholders and delete
  errors; settings cache 24 h; Prisma cold-start timeouts; no anonymous `/api/session` calls.

---

## 2. Square deposits (release 2)

Design: `docs/superpowers/specs/2026-10-13-square-deposits-design.md`. Runbook:
`docs/square-payments-setup.md`.

- [ ] Developer: free Square Developer account → Sandbox application → set the sandbox env vars
      on **Preview** only → run the sandbox acceptance list in the runbook.
- [ ] Owner: Square seller account in the salon's legal name (UK, GBP, identity checks, bank).
- [ ] Production env vars (`SQUARE_PAYMENTS_ENABLED=true`, `SQUARE_ENVIRONMENT=production`,
      application ID `sq0idp-…`, access token, Leeds location ID, webhook signature key,
      `SQUARE_WEBHOOK_NOTIFICATION_URL=https://www.harbourhair.co.uk/api/webhooks/square`).
- [ ] Webhook subscription at exactly that URL (www, no trailing slash): `payment.created`,
      `payment.updated`, `refund.created`, `refund.updated`.
- [ ] Admin → Settings → Deposits: percentage / minimum; Admin → Services: per-service overrides.
- [ ] One real low-value test booking in production (approve, then cancel → refund).

---

## 3. Opening online booking — the order matters

`assertOnlineBookingReady` (`src/app/lib/booking-maintenance.ts`) fails closed.

- [ ] **3.1 Upgrades before customers arrive.** Neon → Launch (pay-as-you-go, ~US$11–15/month,
      7-day restore); Resend → Pro (a booking sends 5 emails; free is 100/day); Vercel Spend
      Management US$10 **alerts only** (never pause production).
- [ ] **3.2 Treatwell decision.** It cannot be synced (no export feed). Recommended: close it.
      Otherwise copy every Treatwell booking into Fresha at once, or accept the risk.
- [ ] **3.3 Fresha.** Give Lox an import link; ask Fresha support why Lox's blocked times are not
      exported; Shania shows "Calendar bookings: Off" in Fresha. Then tick Lox's and Shania's
      outbound confirmations in Admin → Integrations.
- [ ] **3.4 Second admin account** (Admin → Users).
- [ ] **3.5 Environment, then redeploy** (env changes only reach the runtime after a deploy):
      leave `HOUSEKEEPING_ENABLED` unset (on), then `NOTIFICATIONS_ENABLED=true` (sends real email);
      `SALON_NOTIFY_EMAIL` if salon alerts should not go to `EMAIL_REPLY_TO`.
- [ ] **3.6 Square** — §2 complete.
- [ ] **3.7 Run Admin → Operations diagnostics LAST.** The report is invalidated by changes to
      `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SALON_NOTIFY_EMAIL`, `RESEND_API_KEY`, `CRON_SECRET`,
      `NOTIFICATIONS_ENABLED`, `POSTGRES_URL`, `DATABASE_URL` or the Redis credentials.
- [ ] **3.8 Admin → Settings → turn booking on.** Never write `bookingEnabled` straight into the
      database.

---

## 4. Business decisions — owner input needed

- [ ] Deposit amount (percentage / fixed / minimum), which services, refund and no-show rules.
- [ ] Staff approval time (holds expire after 7 days; aim for same-day replies).
- [ ] Legal entity name and retention periods for the privacy notice.
- [ ] Minimum notice for online requests (default 2 hours).

---

## 5. After booking opens — verify, do not assume

- [ ] `/book` signed out → sign-in redirect; signed in → real slots.
- [ ] One real booking: request email arrives; admin approval captures the deposit; confirmation
      email with calendar links; Fresha shows the block within ~10 minutes; cancelling frees the
      slot and refunds.
- [ ] Watch Neon CU-hours for 48 h (Neon operations log `start_compute` / `suspend_compute`).

**Rollback:** Admin → Settings, switch booking off. It fails closed; customers can still cancel.

---

## 6. Deferred — not blocking launch

- [ ] Per-stylist booking gate (today one stale feed closes booking and approvals for everyone).
- [ ] Live Fresha check at submit (`docs/superpowers/specs/2026-09-29-booking-slot-hold-and-live-sync-design.md`).
- [ ] Website-first CTAs, `ReserveAction` JSON-LD and the Google Business Profile booking link once
      booking is open.
- [ ] DMARC `p=none` → `p=quarantine` once reports are clean; Search Console verification.
- [ ] Remove the duplicate `NEON2_*` env set once confirmed unused.
- [ ] Before the first records turn 6 years old (2032): decide and implement what happens to booking
      records after 6 years (delete or anonymise; deleting an appointment also deletes its review) —
      the privacy notice says "up to 6 years". Account-event records are already deleted by housekeeping.
