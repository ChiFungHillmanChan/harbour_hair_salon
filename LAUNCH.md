# Launch checklist — Harbour Hair Salon

Last verified against production: **2026-11-09** (Admin → Operations, Settings and Integrations,
`/book` open and closed, `main` @ `665a732`; §3.9). Before that, **2026-11-03**, calendars only. That day Lox was linked to
Fresha both ways (§3.3), and the Treatwell and Fresha links and the Vercel logs of the busy feeds
were checked. The last wider check was on **2026-10-25** (read-only: the Vercel Production variable
names, `/book` showing the closed notice, `/api/health` up, `main` @ `a0bf849` deployed; then the
Operations diagnostics, Neon usage and the Square Dashboard for the owner's §3 replies). The full
read-only check and production-readiness review were on 2026-10-13 (`main` @ `def37c4`).

> **Status:** the public site is live and stable. **Online booking is closed to the public**
> by configuration (§3). The Square lock in code is open: production credentials were set on
> 2026-10-18 (§2), so beta testers (Admin → Settings → Beta testers) book and pay real deposits.
> Public booking was opened on 2026-11-09 at 13:23 and closed again at 13:48 by the owner (§3.9).
> The 2026-10-13 review's code findings are fixed in the "review follow-ups" release (§1, #62);
> Square deposits are the second release (§2, #63). Both are live since 2026-10-13.
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
| Online booking | **CLOSED** — `SiteSettings.bookingEnabled=false`, plus the Square lock. *2026-10-18:* the Square lock is open (production credentials, §2); only beta testers can book. *2026-11-09:* opened at 13:23, closed again by the owner at 13:48, no bookings in between (§3.9) |
| Notifications | `NOTIFICATIONS_ENABLED=false` — customers get no booking email yet. *2026-11-08:* `true` on Production, deployed with #97 (§3.5) |
| Calendar sync | `CALENDAR_SYNC_ENABLED=true`; Fresha inbound OK for all 4 stylists |
| Fresha outbound confirmed | Funky ✅ Ivan ✅ **Lox ❌ Shania ❌** — blocks the go-live gate **and** staff approvals. *2026-10-18:* Lox's and Shania's "takes bookings" are off in Admin (Shania's switched off that day), so the gate no longer checks them; Lox's gap and Shania's status: §3.3. *2026-11-03:* **Lox ✅**, two-way, and its "takes bookings" is ticked (§3.3). Shania is unchanged: not sold on Fresha |
| Treatwell | Active stylists `receivesBookings=false` (accepted blind spot: Treatwell has no export feed). *2026-11-03:* Treatwell fetches Funky's, Ivan's and Lox's busy feeds every 5 minutes with 200, and its external blocks for 3–8 November match the website feeds exactly. Its bookings reach the website only as red `TW` copies in HarbourHair, made by staff. Fresha's bookings did not reach Treatwell at all: fixed by Treatwell's own URL (§3.3c) |
| Housekeeping | `HOUSEKEEPING_ENABLED` unset, so it is **on** since release 1 (it runs unless set to `false`; the privacy notice's retention periods depend on it). First run 03:15 UTC on 2026-10-14; checked before the deploy, production had nothing for it to close or remove (no pending requests, no expired rows) |
| Operations diagnostics | Last run 2026-09-20, **never passed**. *2026-10-25:* 5 of 6 pass; only Notification delivery fails, as it must until §3.5 (§3.7). *2026-11-09, 12:33:* all 6 pass |
| Neon | Free plan (100 CU-h/month, overrun **suspends** the database until next month); Oct 1–12 used 17.6 CU-h (~45/month pace); 6-hour restore history. *2026-10-25:* Oct 1–25 used 37.17 CU-h (~47/month pace); the preview database 2.30 (§3.1) |
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
  from sign-in and registration. **Owner to confirm** the legal entity name and retention periods
  (the name is confirmed as it stands, 2026-10-25: §4).
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
  variable in GitHub; both set 2026-10-27, so it runs on every production deploy).
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
- [x] Developer: sandbox setup on **Preview** only (runbook §3 — free Square Developer account, UK
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
      values are unchanged.
      **2026-10-17/18:** §4 passed on `main` 13dbe8f: all 13 items on a local production build, plus
      the owner's short check on the Preview (3-D Secure, Square's own webhooks, a refund, a
      decline; `readme/square-acceptance-2026-10-14.md`). Afterwards, Preview
      `NOTIFICATIONS_ENABLED` was set to `false` (switched off, not deleted; owner, 2026-10-17).
      `PREVIEW_EMAIL_ALLOWLIST`, `CRON_SECRET` and the sandbox `SQUARE_*` values stay, for the next
      check. The Square account holding the application is named **FaithArkLtd**: before §5 the
      owner confirms it is the salon's own business account.
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
      The account's own card rate, read in the Square Dashboard on 2026-10-25: "API 1.40% + £0.25"
      (runbook §8).
- [x] Production credentials — set 2026-10-18 on the owner's word, after §4 passed (2026-10-17/18).
      Five non-secret values by CLI, the access token and signature key by the owner (Production
      only; the team's "Separate Production Secret Values" rule keeps them off Preview, which now has
      no Square token or key until the sandbox ones are re-added). Location `LMDPK9XXXTJEM`
      (named "FaithArkLtd" in the Square Dashboard on 2026-10-25, address 2 Chapel Street, Leeds: the
      owner may rename it and use the salon's address there, since card statements show it). S1–S4 are built: S3 captures a hold on approval, releases
      it on decline, withdrawal, lapse or expiry, and refunds cancellations; S4 (the Square webhook
      and the daily reconciliation) follows up a payment whose outcome was unclear, a failed
      release and a refund left pending. Production application in the **salon's** Square
      account; the seven
      `SQUARE_*` variables on Production only (`SQUARE_PAYMENTS_ENABLED=true`,
      `SQUARE_ENVIRONMENT=production`, application ID `sq0idp-…`, access token, Leeds location ID,
      webhook signature key,
      `SQUARE_WEBHOOK_NOTIFICATION_URL=https://www.harbourhair.co.uk/api/webhooks/square`) —
      runbook §2 and §5.
- [x] Webhook subscription at exactly that URL (www, no trailing slash): `payment.created`,
      `payment.updated`, `refund.created`, `refund.updated`. Created 2026-10-18 ("Harbour Hair
      website", API 2026-09-16); "Send test event" → 200.
- [x] Admin → Site Settings → Deposits: on, 50%, minimum £0; Admin → Services & Pricing: a fixed
      £15 override (their full price) on Consultation and on Consultation & Patch Test. Set in
      production on 2026-10-15; nothing is charged until Square production credentials unlock booking.
- [x] One real low-value test booking in production (approve, then cancel → refund) — runbook §5.
      2026-10-18, through beta booking (#81, tester `hillmanchan709@gmail.com`): a £0.01 override on
      Short Over Ears; hold → live `payment.created` → the owner approved (CAPTURED) → the customer
      cancelled (refund requested; Square's `refund.created`/`refund.updated` processed; refund
      PENDING at the time of writing, as real-card refunds are; the owner confirms it COMPLETED
      in the Square Dashboard) → four tester emails sent. *2026-10-25:* the refund is COMPLETED in
      the database since 2026-10-19, and the Square Dashboard shows it as "Refund via API",
      deducted. The override is kept on purpose for
      beta testers; remove it before booking opens (§3.8). Public booking stays closed until §3.

---

## 3. Opening online booking — the order matters

`assertOnlineBookingReady` (`src/app/lib/booking-maintenance.ts`) fails closed.

- [ ] **3.1 Upgrades before customers arrive.** Neon → Launch (pay-as-you-go, ~US$5–15/month: about US$5 at the 2026-10 pace of ~48 CU-hours,
      more as traffic grows;
      7-day restore); Resend → Pro (an online booking sends 3 emails since the short set of
      2026-10-18 — salon alert, confirmation, usually a reminder — plus any change or
      cancellation; free is 100/day); Vercel Spend
      Management US$10 **alerts only** (never pause production).
      *Owner, 2026-11-08: Neon stays on Free* (this replaces the upgrade above): Nov 1–8 used 12.68
      CU-h, about 48 per 30 days, and about 65 is expected once booking is open, against 100. Going
      over suspends the database, so it is re-measured a week after opening (§3.9 step 7).
      *Owner, 2026-10-25:* Neon has no need to move yet: Oct 1–25 used 37.17 CU-h, a pace of about
      47 a month against the free 100 (the preview database used 2.30). Upgrade at public launch,
      in Vercel (Storage → the Neon integration → Settings → Change Configuration). That switches
      **every** database in the integration, and it also holds 8 of the developer's other projects
      (about 20 CU-h a month between them). Launch costs US$0.106 per CU-h: about US$5–6 a month for
      Harbour, about US$8 for the whole integration. Resend stays on Free for now.
      *2026-11-03 (read in the Neon console, read-only):* Nov 1–3 used 3.21 CU-h on production, a
      pace of about 39 a month (the 5-minute Fresha watch added nothing visible); the whole
      integration used 4.94 (about 60 a month). With public booking, expect about 50–70 CU-h a month
      for production, about 85 if the compute stays awake through opening hours. That is close to
      the free 100, and going over **suspends** the database until the 1st. Launch at that pace:
      about US$4–9 a month for Harbour, about US$6–11 for the whole integration. Vercel the same day:
      US$1.04 of the US$20 Pro credit used in the cycle to Nov 24 (Harbour US$0.47).
- [x] **3.2 Treatwell decision.** It cannot be synced (no export feed). Recommended: close it.
      Otherwise copy every Treatwell booking into Fresha at once, or accept the risk.
      *Owner, 2026-10-25:* Treatwell stays as it is: the risk is accepted (the blind spot in §0).
- [x] **3.3 Fresha (facts corrected 2026-10-18, live data; Lox done 2026-11-03, below).** Funky and Ivan: Fresha sells them,
      inbound sync on, outbound subscription confirmed — two-way, done. **Lox:** the owner says
      Fresha does sell Lox, but in Admin → Integrations Lox's "This provider takes bookings" is
      unticked (`receivesBookings=false`) **and** Fresha has not subscribed to Lox's website busy feed
      (`outboundConfirmedAt` null) — two separate gaps. The owner has **paused any Lox change**
      ("don't touch Lox for now", 2026-10-18): until Lox's feed is linked in Fresha and both are
      set, a website booking with Lox does not block Lox on Fresha, so staff check Fresha before
      confirming a Lox request. Still open for Fresha support: why Lox's blocked times are not
      exported. **Shania:** not sold on Fresha (owner); her "This provider takes bookings" was
      switched off in Admin (2026-10-18), and she is hidden from the website anyway — nothing to link.
      *2026-10-25:* Lox is still paused. The Fresha side needs the salon's Fresha login, which the
      developer does not have. Production read that day: Lox has a feed token, inbound is on and
      fresh, `receivesBookings=false`, `outboundConfirmedAt` null, so it is safe to resume. **Keep
      this order:** if "takes bookings" is ticked before outbound is confirmed,
      `evaluateSyncCoverage` fails closed and beta booking closes with it.
      1. Fresha → Team → Lox → Edit → Settings → Linked calendars → Link a calendar → Other
         calendars → "Import events from an external calendar". Paste Lox's busy-feed URL from
         Admin → Integrations (it carries a secret token: paste it, never post it anywhere), choose
         "Time and duration only", save.
      2. Wait until the Vercel logs of the current production deployment show Fresha fetching
         `/api/ical/<Lox's stylist id>` with 200 (about every 15 minutes).
      3. Admin → Integrations → confirm outbound for Lox / FRESHA.
      4. Last, tick "This provider takes bookings", then check that beta booking is still open.

      Never press "generate token" for Lox: it changes the feed URL Fresha holds and clears
      `outboundConfirmedAt`.

      *Done 2026-11-03 (GMT), with the owner's OK.* The developer drove the salon's signed-in
      Chrome, and the owner pasted every URL.
      - **Before:** Fresha had no import on Lox, only two exports. Shania's own profile imports
        Shania's feed. That is harmless, because her Fresha "Calendar bookings" is off, and it is
        kept. No profile held another stylist's URL. Treatwell's links for Funky, Ivan and Lox each
        hold their own stylist's URL, and Treatwell allows one external calendar per staff member.
      - **Lox's Fresha export replaced** (owner's choice, because its URL appeared in a tool
        output that session). The new export includes "Blocked times". It was saved as Lox / FRESHA's
        inbound feed at 11:22, and "Test and sync" read 1 feed with 0 failed and 16 upserted. The
        old export was removed at 11:32. A third export, unread since 2026-09-29, is kept (owner).
        Fresha's settings API reports `blocked-time-sync-enabled: true` on every Lox export, so the
        open question above ("why Lox's blocked times are not exported") no longer matches Fresha's
        setting. The feed's content was not read.
      - **Steps 1–4:** the Fresha import was saved at 11:25 with "Time and duration only". Fresha
        accepted it: the 422 of 2026-09-19 did not recur. Vercel logs show `hackney/1.25.0`
        fetching Lox's feed with 200 at 11:25:27 and 11:25:59, and Lox's Fresha calendar shows
        the imported blocks. Outbound was confirmed at 11:28. "Takes bookings" was ticked and saved
        at 11:29, and Integrations still showed "Calendar setup checks pass".
      - **Not rotated:** Lox's website busy-feed URL (with its token) appeared in a screenshot that
        session. Treatwell and Fresha both hold it. To rotate it later, first untick "takes
        bookings" for Lox / FRESHA, then re-paste the new URL in Treatwell and Fresha, confirm
        outbound, and tick it again.
- [x] **3.3b Google Calendar** — ON since 2026-10-16, on the HarbourHair diary since 2026-10-17. Original steps: Follow
      `docs/google-calendar-setup.md`: Google Cloud service account, the "Harbour website bookings"
      calendar shared with it, the five `GOOGLE_CALENDAR_*` variables on Vercel **Production only**,
      redeploy, Admin → Integrations → Sync now, then the §4 test (a booking appears; `Ivan: test`,
      with the name exactly as in Admin → Stylists, blocks Ivan only). After the merge apply the preview-database migration
      `20261016150000_google_calendar_sync` by hand (`pnpm db:vercel:deploy` with the preview env).
- [ ] **3.3c Treatwell holds each stylist's Treatwell URL** (shipped 2026-11-03, owner's choice).
      Before it, a Fresha booking never reached Treatwell: Treatwell imports only the website's
      busy feed, and that feed never carries Fresha's time (it would loop back into Fresha). The
      same URL with `&for=treatwell` adds the stylist's Fresha bookings and blocked time. Treatwell
      exports nothing back, so it cannot loop. Admin → Integrations → each stylist → "For
      Treatwell" shows it.
      1. For Funky, Ivan and Lox in Treatwell Connect, replace the linked external calendar with
         that stylist's Treatwell URL (Treatwell allows one per staff member). The owner pastes it.
      2. Check: Vercel logs show `Apache-HttpClient` fetching `/api/ical/<id>` with 200 and the
         stylist's Fresha blocks appear in Treatwell. Never paste the Treatwell URL into Fresha.
      3. Fresha keeps the plain URL. Nothing in Admin changes: no rotation, and the "takes
         bookings" ticks stay as they are.
- [ ] **3.4 Second admin account** (Admin → Users). *Owner, 2026-10-25:* to be added later.
- [x] **3.5 Environment, then redeploy** (env changes only reach the runtime after a deploy):
      leave `HOUSEKEEPING_ENABLED` unset (on), then `NOTIFICATIONS_ENABLED=true` (sends real email);
      `SALON_NOTIFY_EMAIL` if salon alerts should not go to `EMAIL_REPLY_TO`.
      *Owner, 2026-10-25:* set later. Nothing old goes out when it is: the queue's four PENDING
      deliveries (a confirmation and three reschedules, 2026-10-16) all belong to one test booking
      that is cancelled and in the past, so the outbox skips them (`isCurrent`), and housekeeping
      clears them 30 days after they were queued.
      *2026-11-08:* done. `NOTIFICATIONS_ENABLED=true` on Production (Config type), deployed with
      #97 (`665a732`).
- [x] **3.6 Square** — §2 complete (production keys, webhook and a real £0.01 test, 2026-10-18).
      Checked in the Square Dashboard on 2026-10-25: card rate "API 1.40% + £0.25"; location
      `LMDPK9XXXTJEM` is named "FaithArkLtd", 2 Chapel Street, Leeds; the £0.01 refund shows
      "Refund via API", deducted (COMPLETED in the database since 2026-10-19). Square Appointments
      Plus (£29) ended on 2026-10-17 and has no payment method attached.
- [ ] **3.7 Run Admin → Operations diagnostics LAST.** The report is invalidated by changes to
      `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SALON_NOTIFY_EMAIL`, `RESEND_API_KEY`, `CRON_SECRET`,
      `NOTIFICATIONS_ENABLED`, `POSTGRES_URL`, `DATABASE_URL` or the Redis credentials.
      *2026-10-25, 16:06 London:* run as a dry check. Booking email settings, scheduled-job
      authentication, the database, the Resend sender domain and Redis pass; Notification delivery
      fails, as it must until §3.5. All five scheduled jobs succeeded that day and none has ever
      failed; no payment needs attention. Run it again after §3.5, less than 24 hours before §3.8.
      *2026-11-09, 12:33 London:* all six pass after §3.5, and no payment needs attention. Left
      unticked because a report only counts for 24 hours: run it again if booking reopens later.
- [ ] **3.8 Admin → Settings → turn booking on.** Never write `bookingEnabled` straight into the
      database. **First** remove the £0.01 test deposit on "Short Over Ears - Wash, Haircut & Blow
      Dry" (Admin → Services & Pricing → that service → empty "Deposit for this service"; kept on
      purpose for beta testers since 2026-10-18), and decide whether to keep the beta tester list
      (it no longer matters once booking is open to everyone). *Owner, 2026-10-25:* both stay for
      now. *2026-11-09:* the £0.01 test deposit is removed (empty after a reload, so the service
      follows the 50% policy); the beta tester list stays. Booking was switched on at 13:23 and
      off again at 13:48 at the owner's request.
- [ ] **3.9 Opening day: Monday 2026-11-09** (owner's decision, 2026-11-03). In this order, each
      step confirmed with the owner as it is done:
      1. §3.3c done (Treatwell holds the Treatwell URLs), and Admin → Integrations still passes.
      2. Vercel spend alert US$10, alerts only. Neon stays on Free (owner, 2026-11-08).
      3. §3.5 `NOTIFICATIONS_ENABLED=true` on Vercel Production, then a deploy (merge to `main`).
      4. §3.7 diagnostics: all pass, and less than 24 hours before step 5.
      5. §3.8 remove the £0.01 test deposit, then Admin → Settings → turn booking on.
      6. §5 checks the same day. Resend stays on Free (100 emails a day, about 30 bookings).
      7. A week after opening (2026-11-16): re-measure Neon (`docs/agents/neon-budget.md`). If the
         month is heading past about 85 CU-h, move to Launch (a paid change: confirm the cost first).

      *Progress, 2026-11-09:* step 1: Admin → Integrations passes; the owner skipped the check that
      Treatwell holds the Treatwell URLs. Step 2 is not done: Vercel has a team budget of US$50
      with Pause on, and the owner has not chosen whether to change it. Steps 3 and 4 are done
      (diagnostics 12:33). Step 5 was done at 13:23 and undone at 13:48 by the owner; reopening may
      be 2026-11-10, not yet fixed, and needs step 4 again if the report is older than 24 hours by
      then. Step 6: while open, `/book` signed out went to sign-in and signed in showed real times
      from 11 November; the one real booking in §5 has not been made. Step 7 counts from the day
      booking really opens.

      Online booking stays open overnight (owner decision 2026-11-08), so step 5 does not have to
      wait for the morning's first feed import. Once booking is on, a **failed** Operations
      diagnostics run closes it until a run passes (the button says so), and the salon gets one
      email a day while booking is on but closed.

---

## 4. Business decisions — owner input needed

- [x] Deposit amount (decided 2026-10-15): 50% of the price for every service booked directly;
      £15 to book either consultation, which is now that consultation's full price (the general
      Consultation went from free to £15).
- [x] No-show (decided 2026-10-16): the deposit is never refunded. `/booking-terms` says so (en + zh),
      and Admin → Schedule's cancel dialog starts at "keep" once a confirmed visit's time has passed.
- [x] Late cancellation (decided 2026-10-18): a customer cancelling a confirmed booking **48 hours
      or more** before it starts gets the deposit back in full; **less than 48 hours** (or a no-show),
      it is kept; a salon cancellation is refunded in full. Customers may still cancel online until 24
      hours before — My Bookings says the deposit is kept before they confirm, and the website keeps
      it automatically (`KEPT`, `DEPOSIT_REFUND_NOTICE_HOURS`). For a customer who phones to cancel
      inside 48 hours, staff untick "Refund the £X deposit" in the cancel dialog. `/booking-terms`
      (no more "may keep"), the booking page, My Bookings and the emails say so in en + zh.
      **Reschedule inside 48 hours (option A, decided 2026-10-18):** a move the customer asks for less
      than 48 hours before the booking keeps the deposit non-refundable at the new time
      (`depositLockedAt`); it still counts towards the bill if they come.
- [x] Customer emails — the short set (decided 2026-10-18): confirmation, cancellation (a declined
      request too), reschedule, reschedule declined/lapsed, request lapsed, late-arrival cancellation
      and the reminder — the reminder only for a booking confirmed at least 24 hours before it starts.
      The "request received", "reschedule request received" and review-invitation emails are switched
      off (not deleted: `RETIRED_CUSTOMER_EMAIL_KINDS`). The salon's alerts are unchanged. The privacy
      notice says so.
- [ ] **Late-arrival auto-cancel (shipped OFF).** First brief the staff: while a customer is at the
      salon they tap **Arrived** (Admin → Schedule arrivals panel or the booking dialog; Mark completed
      and walk-ins count as arrived), and when a customer phones to say they're running late they tap
      **Arrived** (or move the booking) — the terms only cancel customers who didn't let us know. Then
      switch the rule on in Admin → Settings: from then on a confirmed booking not marked Arrived 15
      minutes after its start is cancelled, its deposit kept as for a no-show, and the customer is
      emailed 30 minutes later; Restore (within 24 hours) undoes it. Only bookings made and starting
      after the switch is turned on are affected, and never one with an open reschedule request. (The
      `20261016120000_late_arrival_auto_cancel` migration is on the preview database: it is current
      through `20261018200000_deposit_locked_at`.)
- **Consultation credit, "From £X" prices and Styling (2026-10-16, owner):**
  - [x] Styling (the 7 blow-dry services) is booked directly, without a consultation: a production
        data change on 2026-10-16 (`requiresConsultation=false`, audited `SERVICE.UPDATE`). The repo's
        price catalog, consultation backfill and seed match it. Colouring and Perms keep the consultation.
  - [ ] **Brief the staff — the till note:** a paid consultation's fee (£15) comes off the treatment it
        was for if that is booked within 6 months, once. The website applies it **automatically only for
        treatments staff book in Admin → Schedule** (the booking dialog offers it, ticked). For a
        treatment booked through Fresha, Treatwell or by phone without going through Admin, the website
        cannot see it: **deduct the consultation fee at the till**.
  - [x] After merging, apply the `20261016140000_consultation_credit` migration to the **preview
        database** by hand (as for every migration: previews never migrate), or every PR's "Deploy
        Preview" fails. Done long since: the preview database is current through
        `20261018200000_deposit_locked_at`.
- [ ] Staff approval time (holds expire after 7 days; aim for same-day replies).
- [ ] Legal entity name and retention periods for the privacy notice (payment records: 6 years)
      and the booking terms. *Owner, 2026-10-25:* the name stays as written. FaithArkLtd (the
      Square account) and Harbour Hair Salon are the same company. The retention periods are still
      to be confirmed.
- [ ] Minimum notice for online requests (default 2 hours).

---

## 5. After booking opens — verify, do not assume

- [ ] `/book` signed out → sign-in redirect; signed in → real slots.
- [ ] One real booking: the salon alert arrives (customers get no "request received" email since
      2026-10-18); admin approval captures the deposit; confirmation email with calendar links;
      Fresha shows the block within ~10 minutes; cancelling 48 hours or more ahead frees the slot
      and refunds (inside 48 hours the deposit is kept).
- [ ] Watch Neon CU-hours for 48 h (Neon operations log `start_compute` / `suspend_compute`).

**Rollback:** Admin → Settings, switch booking off. It fails closed; customers can still cancel.

---

## 6. Deferred — not blocking launch

- [x] **Fresha watch + Google mirror** (built 2026-10-26, on since 2026-10-27): the separate
      "Fresha（自動同步）" Google calendar is shared with the service account, and
      `GOOGLE_FRESHA_MIRROR_CALENDAR_ID` and `FRESHA_WATCH_ENABLED=true` are set on Vercel Production
      (`docs/google-calendar-setup.md` §9).
  - [ ] Staff stop hand-copying Fresha bookings into HarbourHair (a red copy takes a walk-in chair).
  - [ ] Check Neon's CU-hours on 2026-11-03, a week in (`docs/agents/neon-budget.md`).
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
