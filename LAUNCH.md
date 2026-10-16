# Launch checklist — Harbour Hair Salon

Last verified against production: **2026-10-13 18:55 UTC** (read-only checks after both
releases deployed, `main` @ `def37c4`), plus the 2026-10-13 production-readiness review.

> **Status:** the public site is live and stable. **Online booking is closed** — by the
> Square lock in code (production opens only with Square production credentials, see §2)
> and by configuration (§3). The 2026-10-13 review's code findings are fixed in the
> "review follow-ups" release (§1, #62); Square deposits are the second release (§2, #63).
> Both are live since 2026-10-13; production online booking stays locked until Square
> production credentials are set.
>
> **Deploys:** merge to `main`; GitHub Actions tests and deploys. Runs on `main` queue
> (never cancel mid-flight); a queued run is superseded by a newer one, so the newest commit
> deploys last. A head commit message containing a skip-CI marker (`[skip ci]` and friends)
> runs nothing at all — check the squash body before merging, and that a `push` run appears
> after. Local `vercel --prod` is refused by `scripts/production-build-guard.mjs`.

Work top to bottom. The order in §3 is **load-bearing**.

---

## 0. Current state (verified 2026-10-12/13, not assumed)

| Area | State |
|---|---|
| Tests / `tsc` / lint / audit | All green — 1,284 tests with release 1 and 1,644 with release 2 (1,057 before); CI also replays migrations on PostgreSQL 18 and runs the integration, booking-lifecycle and HTTP suites |
| Online booking | **CLOSED** — `SiteSettings.bookingEnabled=false`, plus the Square lock |
| Notifications | `NOTIFICATIONS_ENABLED=false` — customers get no booking email yet |
| Calendar sync | `CALENDAR_SYNC_ENABLED=true`; Fresha inbound OK for all 4 stylists |
| Fresha outbound confirmed | Funky ✅ Ivan ✅ **Lox ❌ Shania ❌** — blocks the go-live gate **and** staff approvals |
| Treatwell | Active stylists `receivesBookings=false` (accepted blind spot: Treatwell has no export feed) |
| Housekeeping | `HOUSEKEEPING_ENABLED` unset, so it is **on** since release 1 (it runs unless set to `false`; the privacy notice's retention periods depend on it). First run 03:15 UTC on 2026-10-14; checked before the deploy, production had nothing for it to close or remove (no pending requests, no expired rows) |
| Operations diagnostics | Last run 2026-09-20, **never passed** |
| Neon | Free plan (100 CU-h/month, overrun **suspends** the database until next month); Oct 1–12 used 17.6 CU-h (~45/month pace); 6-hour restore history |
| Crons (UTC) | reminders `0 8` (+ daily ops alert), notifications `*/30 8-19`, calendar-sync `*/30` (staff hours ±15 min), housekeeping `15 3` |
| Migrations | 22 applied — release 2's deploy added `20261013120000_square_deposits` on 2026-10-13 (additive only; no drift afterwards). The preview database has it too |
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
- Deploy pipeline: concurrency (main queues; the newest commit deploys last), pinned Vercel CLI,
  optional Neon snapshot before migrations (needs `NEON_API_KEY` secret + `NEON_PROJECT_ID`
  variable in GitHub).
- Daily "needs attention" email to the salon (failed emails, failing jobs, dead feeds, waiting
  requests, housekeeping switched off) — sent from the 08:00 UTC reminders run, so only while
  notifications are on.
- Monochrome confirmation email and admin controls; click-to-load map; image optimizer limited
  to local files; translated Operations messages, share-card alt text, placeholders and delete
  errors; settings cache 24 h; Prisma cold-start timeouts; no anonymous `/api/session` calls.

---

## 2. Square deposits (release 2)

Design: `docs/superpowers/specs/2026-10-13-square-deposits-design.md`. **Runbook — what the site
does at each step, env vars, sandbox setup and tests, go-live, operations:
`docs/square-payments-setup.md`.** Customer terms: `/booking-terms`; privacy notice updated for
Square and payment records.

- [x] Code merged and deployed (#63, 2026-10-13). Production has the new payment tables,
      deposits are off by default, and `/api/webhooks/square` answers 404 until Square is
      configured.
- [x] Preview database: `20261013120000_square_deposits` applied on 2026-10-13 (runbook §7;
      `prisma migrate deploy`, no drift afterwards).
- [ ] Developer: sandbox setup on **Preview** only (runbook §3 — free Square Developer account, UK
      test account, Vercel Protection Bypass for Automation + an alias for the webhook URL;
      `PREVIEW_EMAIL_ALLOWLIST` = your own address **before** notifications go on there, because the
      preview database holds real customers), then the sandbox acceptance checklist (runbook §4).
      **2026-10-14:** the application was created in the salon's own Square account, so the same app
      will later give the production credentials (runbook §5). Its sandbox Default Test Account is
      United Kingdom / GBP. All seven `SQUARE_*` variables are set on Preview (Production has none).
      The sandbox webhook subscription is saved for `harbour-hair-sandbox.vercel.app`; it uses its
      own Protection Bypass secret, the one with the note "Square sandbox webhook". "Send test
      event" returned 200. Preview also has its own `PREVIEW_EMAIL_ALLOWLIST` and its own values for
      `NOTIFICATIONS_ENABLED=true`, `CRON_SECRET` and `CALENDAR_SYNC_ENABLED=true`. Production's
      values are unchanged, and these Preview-only values are removed again after §4.
      On the preview database only: booking is on, deposits are 20%, and "takes bookings" is unticked
      on the stylists' calendar connections, since crons do not run on previews.
      **§4 progress:** the approve test's hold is done (a £7.40 hold, with request email and
      database matching Square); the duplicate-webhook check passed. The rest of §4 is still open.
      **Later 2026-10-14 acceptance:** authorization, double-click protection, staff capture,
      settled-payment re-check, staff decline/release, customer full refund through COMPLETED,
      actual payment/refund webhook HTTP 200, declined card and failed verification were checked
      against the preview and Square. **2026-10-15 continuation:** the narrow CSP fix is deployed
      to the sandbox alias; a real challenge after an 80-second wait and frictionless SCA passed.
      Customer withdrawal, signed duplicate/older webhook replay, expiry/lapse plus individual
      reconciliation, direct Square cancellation, staff-kept deposit and actual inbox receipt
      were checked, as were external settlement UI/audit and individual re-check (scoped fixture).
      Node 24 full suite (1,646) and local PG18 integration/lifecycle checks pass.
      **15 Oct daytime:** live cross-tab and two-account races preserved one booking/hold;
      the losing hold was released. Fourth wrong-token refusal and valid-token recovery passed,
      as did approved daily housekeeping (settled/kept rows preserved, no duplicate refund).
      The CSP fix and both UI fixes are merged (#64). **15 Oct re-run on main's code** (local
      production build, sandbox Square, clean Chrome): 3-D Secure, frictionless, slot-loss
      notice, capture, refund and settle-outside in an open dialog, withdrawal, decline, the
      CVV/ZIP/expiry cards and the decline limit all pass. The Chrome card-form failure is a
      hidden page (Square cannot start in a background tab); fixed in #65. On #65's code the
      kill switch (no Square call, traced) and the expired hold (approval refused, request
      lapsed, hold released by reconciliation) also pass. Left: a person's card run on the
      Preview of main, real phones. Production remains gated. Full report:
      `readme/square-acceptance-2026-10-14.md` (screenshots kept outside the public repo).
- [x] Owner: Square seller account in the salon's legal name (UK, GBP, identity checks, bank).
      Identity checks are complete and the payout bank account is linked (checked 2026-10-14).
      The account's own card rate is still to be confirmed (runbook §8).
- [ ] Production credentials — **only once the sandbox acceptance checklist (runbook §4) has
      passed on a Preview deployment**. S1–S4 are built: S3 captures a hold on approval, releases
      it on decline, withdrawal, lapse or expiry, and refunds cancellations; S4 (the Square webhook
      and the daily reconciliation) follows up a payment whose outcome was unclear, a failed
      release and a refund left pending. Production application in the **salon's** Square
      account; the seven
      `SQUARE_*` variables on Production only (`SQUARE_PAYMENTS_ENABLED=true`,
      `SQUARE_ENVIRONMENT=production`, application ID `sq0idp-…`, access token, Leeds location ID,
      webhook signature key,
      `SQUARE_WEBHOOK_NOTIFICATION_URL=https://www.harbourhair.co.uk/api/webhooks/square`) —
      runbook §2 and §5.
- [ ] Webhook subscription at exactly that URL (www, no trailing slash): `payment.created`,
      `payment.updated`, `refund.created`, `refund.updated`.
- [x] Admin → Site Settings → Deposits: on, 50%, minimum £0; Admin → Services & Pricing: a fixed
      £15 override (their full price) on Consultation and on Consultation & Patch Test. Set in
      production on 2026-10-15; nothing is charged until Square production credentials unlock booking.
- [ ] One real low-value test booking in production (approve, then cancel → refund) — runbook §5.

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

- [x] Deposit amount (decided 2026-10-15): 50% of the price for every service booked directly;
      £15 to book either consultation, which is now that consultation's full price (the general
      Consultation went from free to £15).
- [x] No-show (decided 2026-10-16): the deposit is never refunded. `/booking-terms` says so (en + zh),
      and Admin → Schedule's cancel dialog starts at "keep" once a confirmed visit's time has passed.
- [ ] Late cancellation (under 24 hours): not decided. `/booking-terms` says the salon "may keep" the
      deposit, and that a salon cancellation is refunded in full — confirm or reword
      (`legal.bookingTerms.cancelling`, en + zh).
- [ ] **Late-arrival auto-cancel (shipped OFF).** First brief the staff: while a customer is at the
      salon they tap **Arrived** (Admin → Schedule arrivals panel or the booking dialog; Mark completed
      and walk-ins count as arrived). Then switch the rule on in Admin → Settings: from then on a
      confirmed booking not marked Arrived 15 minutes after its start is cancelled, its deposit kept as
      for a no-show, and the customer is emailed 30 minutes later; Restore (within 24 hours) undoes it.
      Only bookings that start after the switch is turned on are affected. Apply the
      `20261016120000_late_arrival_auto_cancel` migration to the preview database by hand as well.
- [ ] Staff approval time (holds expire after 7 days; aim for same-day replies).
- [ ] Legal entity name and retention periods for the privacy notice (payment records: 6 years)
      and the booking terms.
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
      the privacy notice says "up to 6 years". The same applies to deposit payment records
      (`PaymentAttempt` / `PaymentRefund`, "up to 6 years after the payment"; a refund row blocks
      deleting its attempt). Account-event records are already deleted by housekeeping.
