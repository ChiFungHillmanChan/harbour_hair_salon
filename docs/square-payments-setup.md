# Square deposits: runbook (sandbox → production)

How the website takes booking deposits through Square, how to set it up and test it in
Square **Sandbox**, how to go live, and what staff do day to day.

- **Design (decisions and reasons):** `docs/superpowers/specs/2026-10-13-square-deposits-design.md`.
- **Customer-facing rules:** `/booking-terms` (`legal.bookingTerms` in `src/i18n/messages/*/legal.ts`).
  Privacy: `/privacy` (Square, payment records, retention).
- **Build status (13 October 2026):** S1 (tables, deposit policy, quote, lock, CSP), S2 (the
  request places a hold), S3 (capture on approval; release on decline, withdrawal, lapse or
  expiry; refunds) and S4 (webhook, reconciliation, "Re-check payment", alert) are built. This
  runbook describes the complete flow and marks each part with its phase, **(S2)**–**(S4)**.
  The money-safety review fixes of the same day (refund retries, credentials per environment,
  lapsing taken deposits and gone holds, unanswered captures, staff keeps, lost booking answers,
  card-decline budgets) are described in place, marked **(review)**; the second round (Square
  setup refusals are not declines, in-salon refunds, bounded refund retries and "Mark refund as
  settled outside the website", a hold Square shows taken, the 12-hour lapse grace) is marked
  **(review 2)**.
  **Production credentials may be set once the sandbox acceptance list (§4) has passed on the
  release candidate** (CLAUDE.md), then §5.
- Square facts below were checked against Square's documentation on **13 October 2026**. The
  gateway pins Square API version **2026-09-16** (`SQUARE_API_VERSION`,
  `src/app/services/square-gateway.ts`). The 2026-09-16 Cantonese plan is superseded; do not
  execute it.

---

## 1. What the website does, step by step

Square's *delayed capture* is the whole model: a card **authorization** is a hold (money
reserved, not taken); **capture** turns it into a payment; **cancel** releases a hold; only a
captured payment can be **refunded**. Holds are created with `autocomplete: false` and
`delay_action: CANCEL`, so a hold nobody captures is released by Square at its
`delayed_until` — at most **7 days** for online card payments — and is never charged by itself.

### 1.1 Quote (before the card form)
- The deposit is `calculateDepositPence` on the server's quote for the booking, and only while
  Admin → Site Settings → **Deposits** is on. A service's own override (Admin → Services & Pricing
  → **Online deposit**: empty = salon policy, `0` = none, otherwise a fixed amount capped at the
  price) wins; otherwise the salon's whole percent of the quoted price, unless that price is below
  the salon's minimum. Free services never take one.
- `previewBookingQuote` shows the price, "Deposit now" and "Pay the rest in the salon". Deposit
  `0` ⇒ the old no-payment flow, no card form. Bookings entered by staff never take a deposit.

### 1.2 Customer sends the request — hold (S2)
1. The usual gates (booking open, verified email, rate limits, 2-hour notice, slot pre-check).
   Nothing reaches Square if one refuses. **(review)** So does the card-decline budget: after
   Square has declined 3 deposit cards for one account, or 5 from one client address, within 24
   hours, no further card attempt is made from it (`PAYMENT_UNAVAILABLE`, "call the salon") —
   card testing gets a few tries a day, not six an hour. Only real declines count
   (`depositDeclineAccountLimiter` / `depositDeclineIpLimiter`, `lib/rate-limit.ts`): Square
   refusing the **card** — HTTP 400 or 402, nothing else (the gateway never reads Square's error
   text). **(review 2)**
2. A `PaymentAttempt` row is written **before** Square is called (`INITIATED`).
3. Square `CreatePayment` runs outside any database transaction: idempotency key
   `dep_<attempt key>`, `reference_id` = the attempt id, a note naming the service, date and time
   (no personal data).
   - Approved ⇒ `AUTHORIZED` with Square's payment id and `delayed_until`.
   - Declined or not verified (HTTP 400 / 402) ⇒ `FAILED`; the customer is told nothing was booked
     or charged, and it counts against the decline budget.
   - **(review 2)** Refused because of the **website's own Square setup** — 401 (access token), 403
     (permissions), 404 (location) or any other 4xx ⇒ `FAILED` with `PAYMENT_SETUP_REFUSED`; the
     customer is told online payment is unavailable (call the salon), nothing is counted against
     their decline budget, the function log names the HTTP status once per instance, and Admin →
     Operations and the daily email raise it as a configuration problem (never as card declines).
     A request that never passed the gateway's own checks is "never sent" (`PAYMENT_NOT_SENT`).
   - No usable answer ⇒ `UNKNOWN`; the site cancels by idempotency key at once and tells the
     customer nothing was booked and any hold is released. A new key is never used for the same
     submission.
4. The booking transaction creates the `PENDING` appointment and links the attempt. If the time
   was taken meanwhile, nothing is booked and the hold is released (`VOIDED`; if that call fails
   the attempt stays `AUTHORIZED` for reconciliation, and Square releases it at expiry anyway).
   **(review)** An error that is not a refusal — a dropped connection, whose booking may have
   committed — re-reads the attempt first: tied to its appointment ⇒ answered as booked, the hold
   kept; not tied ⇒ released as above; unreadable ⇒ left for reconciliation and the customer is
   asked to look in My Bookings (`PAYMENT_PENDING`).
5. Repeats never keep a second hold: the same submission replays its first answer; the same
   request made again is answered "already requested" before the card is touched (a repeat only
   caught inside the booking transaction releases its hold).
6. The request email mentions the hold; the done screen says it is only taken if the salon confirms.

### 1.3 Staff approve — capture (S3)
1. The hold must still be valid (`AUTHORIZED`, `delayed_until` in the future); otherwise approval is
   refused (`DEPOSIT_HOLD_EXPIRED`).
2. Only one admin can win: `AUTHORIZED → CAPTURING` inside the approval's checks.
3. Square `GetPayment` (must be `APPROVED`, same amount and reference) → `CompletePayment` with
   its version token.
   - Failure ⇒ back to `AUTHORIZED` (or `EXPIRED` if Square says the hold was cancelled); not approved.
   - No clear answer ⇒ asked again; still unclear ⇒ `CAPTURE_UNKNOWN`, "try again in a minute"
     (the retry starts by asking Square, so it never captures twice).
4. Still free ⇒ `CONFIRMED` + `CAPTURED` + confirmation email (deposit paid, remainder due).
   The time was lost in between (rare) ⇒ booking cancelled, full refund (`SLOT_LOST`), customer
   and salon told.

### 1.4 Decline, lapse, or the customer withdraws — release (S3)
The booking change commits first, then Square `CancelPayment` ⇒ `VOIDED`. A failed release is
left for reconciliation; Square releases the hold at expiry in any case.
**(review)** A capture nobody saw finish (`CAPTURE_UNKNOWN`, or `CAPTURING` an approval left)
refuses every closing — decline, cancel, mark completed, the customer's cancel — with "still being
processed and checked with Square … try again in a few minutes" until it has been quiet for **2
minutes** (`CAPTURE_STALE_MS`): a capture that timed out can still land at Square, and releasing on
an earlier read could let it take money from a closed booking. After that it is settled from
Square's word first. Confirming again needs no wait (it reads Square first and never takes twice).

### 1.5 The hold expires (S3)
Square cancels it at `delayed_until`. The notifications run lapses a `PENDING` request whose hold
has expired — the request-lapsed email, with its own opening line ("we couldn't confirm your booking
request … while the hold on your card was still valid", `emails.requestLapsed.introHoldExpired`) —
and approval is refused. **(review)** The same happens at once to a request whose hold is gone for
another reason — dropped by Square (`EXPIRED`) or released by the website (`VOIDED`) — so it never
blocks its slot until its time has passed.
Staff should answer requests the same day; a request also lapses once its appointment has passed.
**(review)** If its deposit was taken (or its capture is unclear) and nobody confirmed it, the lapse
step settles it with Square and closes it like a staff decline: `CANCELLED`, a full refund (reason
`REQUEST_LAPSED`, sent to Square after the commit) and the request-lapsed email saying the deposit is
being refunded. **(review 2)** Only the **daily housekeeping run** does this, and only once the
appointment **ended at least 12 hours earlier** (`TAKEN_DEPOSIT_LAPSE_GRACE_MS`); the half-hourly
notifications run never does. Until then staff **mark it completed** if the customer came (the
deposit is kept towards the bill) or **decline** it (refunded) — Operations, the daily email and
"Re-check payment" say so.

### 1.6 Cancelling a confirmed booking — refund (S3)
- Customer, online, at least 24 hours before: full refund.
- Staff: the cancel dialog offers **"Refund the £X deposit"**, ticked by default; untick to keep it
  for a late cancellation or no-show (the `/booking-terms` policy line). **(review)** A keep is
  recorded on the deposit (`KEPT`), so nothing later reports it as unexplained or refunds it as a
  late capture.
- A `PaymentRefund(REQUESTED)` row is written in the cancellation transaction; Square
  `RefundPayment` runs after commit with that row's idempotency key. Refunds are usually `PENDING`
  first and reach `COMPLETED` (or `FAILED` / `REJECTED`) through the webhook or reconciliation.
  Pending and failed refunds are shown as such.
- **(review)** Every request for a refund is the same request — the payment, the amount and the
  row's key, no free-text reason (a reworded reason after a deploy would make Square refuse the
  retry as `IDEMPOTENCY_KEY_REUSED`). The first send is claimed (`REQUESTED → SUBMITTING`) before
  Square is called; only Square refusing that first send records `FAILED`. A retry Square refuses
  (say, after the access token changed) stays `UNKNOWN` — the first send may have refunded — and is
  listed for staff; a `SUBMITTING` row whose sender went quiet for 2 minutes is retried as
  `UNKNOWN`. `FAILED` is the only state that makes a deposit refundable again.
- **(review 2)** Every retry is dated on its row (`updatedAt` = last tried), so the daily batch —
  least recently tried first — rotates through all of them instead of re-asking the same twenty.
  Retries stop **7 days** after the refund was requested (`REFUND_RETRY_WINDOW_MS`; a refund never
  sent, `REQUESTED`, is always safe to send and never given up on): it becomes **`UNRESOLVED`** —
  still counted against the deposit (never refunded twice automatically), never sent again by the
  daily run or "Re-check payment", listed for staff on Operations and in the daily email. Square's
  own refund notice can still record its answer.
- **(review 2)** **Mark refund as settled outside the website** (booking dialog, next to "Re-check
  payment", administrators only, audited `PAYMENT.REFUND_SETTLED_OUTSIDE`): once staff have refunded
  the customer themselves — in the Square Dashboard or in cash — a refund Square has not confirmed
  (`REQUESTED`, `UNKNOWN`, `UNRESOLVED`, or `SUBMITTING` whose sender went quiet) becomes
  `SETTLED_EXTERNALLY`: counted against the deposit, shown as refunded, never sent to Square again.
  The confirm question names the amount; it cannot be undone from the website.
- Completed appointments keep the deposit (it counts towards the bill). A reschedule keeps the
  deposit attached to the booking.

### 1.7 Webhook — `POST /api/webhooks/square` (S4)
- Not configured (no usable Square configuration here) ⇒ `404`. Body over 64 KB ⇒ `413`.
  Signature (`x-square-hmacsha256-signature`, HMAC-SHA256 of the **configured** notification URL
  followed by the raw body — never the request's Host) wrong ⇒ `401`. Not a Square event ⇒ `400`.
  None of these touches the database.
- Square notifies **every** payment on the account. Event types other than `payment.created`,
  `payment.updated`, `refund.created`, `refund.updated`, events for another location (**(review
  2)** including one whose object the site cannot read but which names its location), and
  payments without a deposit reference (a sale on the salon's card reader) are answered `200`
  without opening the database (CLAUDE.md, Neon compute budget). A refund carries no reference, so
  **(review 2)** a refund at this location whose payment is none of the site's deposits (refunded on
  the card reader) is looked up once and settled at once (`NOT_OURS`): never listed as unmatched,
  never in the daily email, never re-read by the daily run.
- Each remaining `event_id` is stored once (`SquareWebhookEvent`), so duplicates are no-ops.
- `payment.*` updates the matching attempt (by payment id or `reference_id`; same environment,
  location and amount), forward only: `APPROVED` never changes a status (it may be older than what
  the site knows); `COMPLETED` records a capture nobody saw finish as `CAPTURED`; `CANCELED` /
  `FAILED` ⇒ `EXPIRED` while its request is open (the lapse step then closes it), `VOIDED` once
  closed or never booked. A capture an approval is still making is left to that approval.
  `refund.*` updates the matching refund (by Square id, or the one unanswered — or `UNRESOLVED` —
  refund of that payment and amount), forward only; a refund staff settled outside the website is
  never overwritten (Square refunding it too stays listed, for them to see). Unmatched events — a
  refund of one of the site's deposits that no refund row matches, made in the Square Dashboard
  say — are recorded (open) and answered `200`.
- When a notice says Square **holds** money no booking wants (an authorization that landed after
  the site gave up on it, a hold whose release failed) or has **taken** money the site believed
  held or released, the event stays open and — after Square has been answered — the site reads the
  payment afresh and acts on that: releases the hold, or refunds a deposit taken after its booking
  closed in full (`LATE_CAPTURE`). If that does not finish, the daily run does it.
- It never changes a booking — only payment rows.
- The project firewall must never challenge or deny this path: it is pinned as reachable in
  `src/app/lib/vercel-firewall-rules.test.ts` (see `infra/vercel-firewall/README.md`).

### 1.8 Reconciliation, "Re-check payment" and the alert (S4)
- **Daily housekeeping (03:15 UTC), after the request lapses:** anything younger than 15 minutes
  is left alone. Captures nobody saw finish (`CAPTURE_UNKNOWN`, or `CAPTURING` claimed long ago) ⇒
  `GetPayment` through S3's settle: taken ⇒ `CAPTURED` (flagged if its request is not confirmed —
  staff confirm or decline), still held ⇒ `AUTHORIZED`, dropped ⇒ `EXPIRED`. `AUTHORIZED` holds
  whose booking is missing or not `PENDING` (a failed release, a lapse that ran out of time) ⇒
  `GetPayment` ⇒ cancel ⇒ `VOIDED`. Holds recorded `EXPIRED` by their date alone (a lapse or
  closing after `delayed_until`, Square not asked) ⇒ `GetPayment` once: released if Square still
  holds them, refunded in full if a capture landed after all. `INITIATED`/`UNKNOWN` authorizations with no booking ⇒ cancel by
  idempotency key **every day for 7 days** (Square answers `{}` even when nothing has landed yet,
  and a slow authorization can still land), then `VOIDED`; one whose Square id is known is
  settled from `GetPayment` at once. `REQUESTED`/`UNKNOWN` refunds, and `SUBMITTING` ones whose
  sender went quiet, ⇒ asked again with the row's own key and payload (Square returns the original
  refund; a refusal leaves it `UNKNOWN`, the try dated on the row so the batch rotates), until 7
  days after the refund was requested ⇒ `UNRESOLVED`, for staff **(review 2)**; `PENDING` refunds
  over an hour old ⇒ `GetRefund`. A deposit Square took after its booking closed or was never made ⇒
  recorded `CAPTURED` and refunded in full (`LATE_CAPTURE`) — never one staff kept (`KEPT`).
  **(review 2)** One Square took while the site still records a hold (`AUTHORIZED`) on a request
  still open ⇒ recorded `CAPTURED`, flagged "taken, request not confirmed": declining it then
  refunds it at once (with the refund email) and confirming still finishes without taking it again.
  Open notifications ⇒ `GetPayment` and the same rules. Only this deployment's Square environment
  and location are asked about.
- **Admin → Schedule → booking → "Re-check payment"** does the same for one booking, at once, and
  says what is true now (held, released, taken, refund pending/completed/failed, …). Audited. A
  refund handed to staff (`UNRESOLVED`) or settled by them (`SETTLED_EXTERNALLY`) is reported, never
  sent again — staff may already have refunded the customer by hand (review 2).
- **Daily "needs attention" email** (sent from the 08:00 UTC reminders run, only while
  notifications are on) and **Admin → Operations → Payments needing attention** list what still
  needs a person: deposits waiting for Square for over an hour, money taken for an unconfirmed
  request or on a cancelled booking with no refund and no keep recorded, unreleased holds, failed
  or rejected refunds, refunds Square has not confirmed (including a retry Square refused),
  **(review 2)** refunds the website stopped retrying after 7 days (`UNRESOLVED`, until staff settle
  them), automatic late-capture refunds and notifications that matched nothing. **(review)**
  Operations also shows how many cards were declined in the last 24 hours; the email raises that
  only from 5 (card testing). **(review 2)** Deposits Square refused in the last 24 hours because of
  the website's own setup (401/403/404) are shown, and emailed from one, as a configuration problem.
- No new cron: webhooks are a handful per booking and reconciliation rides the existing daily run
  (CLAUDE.md, Neon compute budget).

### 1.9 States

| `PaymentAttempt.status` | Meaning | Moves on by |
|---|---|---|
| `INITIATED` | Row written; Square has not answered yet | The submission; reconciliation after 15 min (⇒ `UNKNOWN`) |
| `AUTHORIZED` | Hold on the card | Approve (capture), decline/lapse/withdraw (release), Square at expiry, reconciliation (release once its booking is missing or not `PENDING`) |
| `CAPTURING` | An approval is capturing | That approval; after 2 minutes the next approval, closing or re-check |
| `CAPTURED` | Deposit taken | Refunds; `KEPT` when staff keep it on cancelling |
| `FAILED` | Declined or not verified (HTTP 400/402, `PAYMENT_DECLINED`), refused by the website's own Square setup (401/403/404…, `PAYMENT_SETUP_REFUSED`), or never sent (`PAYMENT_NOT_SENT`) — nothing held | Final |
| `UNKNOWN` | No usable answer from Square | Cancel by key, daily for 7 days ⇒ `VOIDED`; at once once Square's answer is known |
| `VOIDED` | Hold released by the website | Final (a hold Square still shows is released again) |
| `EXPIRED` | Square released the hold (at `delayed_until`, or earlier) | Final; an open request with it lapses |
| `CAPTURE_UNKNOWN` | Capture outcome unclear | Approval retry at once; closing / lapse / re-check / daily run (`GetPayment`) once quiet for 2 minutes; webhook |
| `KEPT` | Taken, booking cancelled, staff kept it (booking terms) | Final; never refunded by the website |

`PaymentRefund.status`: `REQUESTED` → `SUBMITTING` (first send claimed) → `PENDING` → `COMPLETED` |
`FAILED` | `REJECTED`, or `UNKNOWN` (no usable answer, a refused retry, or a send whose sender went
quiet: retried with the same key, never made `FAILED` by a refusal). **(review 2)** `UNRESOLVED`:
still unconfirmed 7 days after it was requested — no longer retried, counted, listed for staff
(Square's own notice can still move it on). `SETTLED_EXTERNALLY`: staff refunded the customer
another way and pressed "Mark refund as settled outside the website" — final, counted, never sent.
Only `FAILED` and `REJECTED` make a deposit refundable again. Reasons: `CUSTOMER_CANCELLED`,
`STAFF_CANCELLED`, `SLOT_LOST`, `LATE_CAPTURE` (Square took a deposit after its booking closed or
was never made: refunded in full automatically), `REQUEST_LAPSED` (taken for a request nobody
confirmed before its appointment ended: refunded in full by the daily run 12 hours after it ended).
The reason stays on the row; Square is never sent it. `lastError` only ever holds the website's own
catalogued sentences (`services/operations-messages.ts`), never Square's text. **(review 2)** Several
of them are also state keys (the code finds rows by their exact text): never reword one in place —
`operations-messages.test.ts` pins them (`STATE_KEY_SENTENCES`); add a new key and a migration instead.

---

## 2. Environment variables

| Variable | Vercel **Preview** (sandbox) | Vercel **Production** | Notes |
|---|---|---|---|
| `SQUARE_PAYMENTS_ENABLED` | `true` | `true` — only once §4 has passed | Anything but `true` ⇒ no Square call at all |
| `SQUARE_ENVIRONMENT` | `sandbox` | `production` | Unset means `sandbox` |
| `SQUARE_APPLICATION_ID` | `sandbox-sq0idb-…` | `sq0idp-…` | A prefix that does not match the environment is rejected |
| `SQUARE_ACCESS_TOKEN` | Sandbox access token | The salon account's production access token | **Secret.** Server only |
| `SQUARE_LOCATION_ID` | A UK (GBP) sandbox location | The salon's Leeds location | |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | The sandbox subscription's key | The production subscription's key | **Secret** |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | The preview URL with the bypass parameter (§3 step 6) | `https://www.harbourhair.co.uk/api/webhooks/square` | Byte for byte the URL registered in Square |

Rules:

- **Testing on Preview also needs `PREVIEW_EMAIL_ALLOWLIST`** (not a Square variable): your own
  address, set before notifications are switched on there and removed afterwards — §3 step 8.
- **Sandbox values on Preview only; production values on Production only.** Nothing Square-related
  in Vercel's Development environment (local `pnpm dev` may use sandbox values in an uncommitted
  `.env.local`; webhooks cannot reach a laptop). **(review)** Enforced in code:
  `usableSquareConfig` (`lib/online-booking-lock.ts`) uses production credentials only in a
  production build and sandbox credentials only everywhere else. Production values on a preview
  (any branch, on a copy of the production database) or in development count as no configuration —
  no card form, `PAYMENT_UNAVAILABLE`, webhook `404`, nothing reconciled — and the function log
  says so once.
- **The lock.** A production build opens online booking only when `parseSquareConfig` succeeds with
  `environment === 'production'` (`isOnlineBookingLockedForPayments`, `lib/online-booking-lock.ts`).
  Sandbox credentials on Production keep booking locked and are never used to take a deposit.
  Previews are exempt from the lock, which is why the sandbox works there.
- **Every value is validated** (no spaces, no `[SENSITIVE]`, `<…>`, `REPLACE_ME` or `CHANGE_ME`
  placeholders; HTTPS URL without credentials or `#`). A bad value counts as "not configured": the
  site stays locked/closed rather than erroring, and the function log names the field once
  ("Invalid Square configuration: SQUARE_APPLICATION_ID"), never the value.
- **Secret variables are write-only.** Preview and Production variables are Secret by default:
  they cannot be read back, and `vercel env pull` / the GitHub Actions build see a placeholder.
  That is fine — the code reads Square configuration only when a request needs it, never at build
  time. Keep the token, the signature key and the Preview URL (it carries the bypass secret)
  Secret; the other four can be added with `--no-sensitive` so they can be read back and checked.
- **Exact URL.** Square signs the URL as registered, query string included. Copy it from the
  subscription page; same scheme and host spelling, no trailing slash, no spaces or newline.
  Prefer `--value` or the dashboard over `echo … |` (shell history, trailing newline):
  `vercel env add SQUARE_LOCATION_ID preview --value "L…" --no-sensitive --yes`; for secrets run
  `vercel env add SQUARE_ACCESS_TOKEN production` and paste at the prompt.
- **Env changes reach the runtime only with a new deployment.** Preview: re-run the PR's
  "Deploy Preview" job or push a commit. Production: merge to `main`, or re-run the latest `main`
  "CI/CD Pipeline" run in GitHub Actions (a Vercel-side redeploy or local `vercel --prod` is refused
  by `scripts/production-build-guard.mjs`).

---

## 3. Sandbox setup (developer, once)

1. **Square Developer account** — free at <https://developer.squareup.com>. No seller account or
   identity checks are needed for the sandbox, and sandbox payments never charge a real card.
2. **Application** — Developer Console → create an application (e.g. "Harbour Hair website").
   For the sandbox it can live in the developer's own account. (Production is different: §5.)
3. **A UK test account** — Square created a default sandbox test account with the developer
   account; check its country under **Sandbox test accounts**. If it is not the United Kingdom:
   **New sandbox test account** → a name, country **United Kingdom**, tick "Automatically create
   authorizations for all my current apps" → **Create**.
4. **Credentials** — application → toggle **Sandbox** at the top:
   - Application ID: **Credentials** → Sandbox Application ID (`sandbox-sq0idb-…`).
   - Access token: for the default test account, **Credentials** → Sandbox Access token. For an
     extra test account: **OAuth** → "Test account authorizations" → the account → Authorization
     details. These OAuth tokens expire (re-copy it when the sandbox starts answering `401`).
   - Location ID: **Locations**, or ask the API and take the `ACTIVE` location with
     `"country": "GB"` and `"currency": "GBP"`:
     ```bash
     curl -s https://connect.squareupsandbox.com/v2/locations \
       -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" -H "Square-Version: 2026-09-16"
     ```
5. **Preview database** — apply the pending migrations first (§7); every preview deploy of this work
   fails until `20261013120000_square_deposits` is in the preview database.
6. **A webhook URL the sandbox can reach.** Previews sit behind Vercel Deployment Protection, and
   Square cannot log in:
   1. Vercel → Project → Settings → **Deployment Protection** → **Protection Bypass for
      Automation** → create a secret. Regenerating or deleting it breaks every URL that contains it
      (update the Square subscription and the env var together).
   2. Give the preview under test a stable name. Previews here are CLI deployments made by GitHub
      Actions (Vercel's own Git builds are off), and each one gets its own address. Alias the one
      you are testing — and re-run this after every new preview deployment you want webhooks to
      reach:
      ```bash
      vercel alias set <preview-deployment-url> <your-alias>.vercel.app   # any free name
      ```
   3. The URL to register is
      `https://<your-alias>.vercel.app/api/webhooks/square?x-vercel-protection-bypass=<secret>`.
   4. Developer Console → application → **Sandbox** → **Webhooks** → **Subscriptions** → **Add
      subscription**: a name, that URL, API version **2026-09-16** (the gateway's), events
      `payment.created`, `payment.updated`, `refund.created`, `refund.updated` → **Save**. Open it
      → **Signature Key** → **Show** → copy.
7. **Preview env vars** — set the seven variables of §2 for **Preview** (all preview deployments,
   not one branch), with `SQUARE_WEBHOOK_NOTIFICATION_URL` pasted from the subscription page.
   Redeploy the preview, then re-alias it (step 6.2).
8. **Open booking on the preview.** The preview runs the same gate as production
   (`assertOnlineBookingReady`, `lib/booking-maintenance.ts`), against the preview database —
   which is a copy of production **with real customers' data**:
   - **First** set `PREVIEW_EMAIL_ALLOWLIST` on Preview to your own address (comma-separated full
     addresses and/or `@domain` entries, e.g. `you@example.com`). On a preview deployment
     (`VERCEL_ENV=preview`) every email the site sends — booking mail, reminders, review requests,
     the outbox backlog, the daily alert — goes only to recipients on that list; everything else is
     dropped as if sent (one log line, no address, never retried), and with the variable unset a
     preview sends nothing at all (`lib/preview-email.ts`, `sendPreparedEmail`). The preview
     database is a copy of production, so without the list the notifications run would email real
     customers.
   - Then `NOTIFICATIONS_ENABLED=true` on Preview. Point Preview's `SALON_NOTIFY_EMAIL` at your own
     mailbox, use only test accounts whose mailbox you own, and never approve, decline or cancel a
     copied real customer's booking.
   - When testing is over, remove `NOTIFICATIONS_ENABLED` and `PREVIEW_EMAIL_ALLOWLIST` from Preview
     (and redeploy).
   - Admin → Operations → run the diagnostics **on the preview** (Preview needs `EMAIL_FROM`,
     `RESEND_API_KEY`, `SALON_NOTIFY_EMAIL` or `EMAIL_REPLY_TO`, the Redis credentials and
     `CRON_SECRET`).
   - Calendar gate: crons do not run on previews, so imported feeds go stale after 90 minutes. On
     the preview, either run Admin → Integrations' manual sync before each session or untick
     "receives bookings" on the preview's connections (preview database only).
   - Admin → Site Settings (on the preview): booking on; Deposits on with a percent and minimum.
9. **Smoke test** — the subscription page's "Send test event" should get `200` (Square's sample
   payment names no deposit reference, so it is acknowledged without being stored; a signed
   payment event for this location with a deposit reference is stored, and listed under Admin →
   Operations if it matches nothing). `401` from the route = signature or URL mismatch; `404` =
   Square is not configured on that deployment; a Vercel login redirect = the bypass parameter is
   wrong or missing.

---

## 4. Sandbox acceptance checklist

Square's sandbox test values (GBP needs a valid postcode, e.g. `LS1 6DX`; any future expiry; CVV
`111`, Amex `1111`):

| Card | Result |
|---|---|
| `4111 1111 1111 1111` (Visa) | Approved |
| `4800 0000 0000 0004` (Visa) | Strong Customer Authentication, no challenge |
| `4310 0000 0020 1019` (Visa EU) | 3-D Secure **challenge**: enter `123456` |
| `4811 1100 0000 0008` (Visa) | No challenge, verification **fails** |
| `4000 0000 0000 0002` | Declined |
| CVV `911` / postcode `99999` / expiry `01/40` | CVV / postcode / expiry incorrect |

See each result on the website **and** in Square (Developer Console → Sandbox test accounts →
**Square Dashboard** next to the account → Transactions). Record the date, the preview URL and
commit, and the Square payment ids.

- [ ] **Approve ⇒ capture.** Request with `4111…`: `PENDING`, deposit held, request email mentions
      the hold; Square shows the payment authorized. Approve in Admin → Schedule: `CONFIRMED`,
      `CAPTURED`, confirmation email with deposit paid and remainder; Square shows it completed. The
      later `payment.updated` webhook changes nothing.
- [ ] **Decline ⇒ release.** Decline a new request: `VOIDED`, Square shows it cancelled, customer
      emailed. Same for a customer withdrawing a pending request in My Bookings.
- [ ] **Declined card** (`4000 0000 0000 0002`) and **failed verification** (`4811…0008`): "card
      declined or could not be verified", nothing booked, attempt `FAILED`, nothing held.
- [ ] **3-D Secure challenge** (`4310…1019`, code `123456`): the challenge shows and the request
      goes through. Keep DevTools → Console open throughout: there must be **no** "Refused to frame",
      "Refused to load" or "violates the following Content Security Policy directive" message. If
      there is, add the blocked origin to the matching directive in `next.config.ts` (and
      `src/app/lib/square-csp.test.ts`), redeploy and repeat. Also try `4800…0004` (frictionless),
      and once wait a full minute in the challenge before entering the code: it must still go
      through (the page allows a card check up to 11 minutes, `SQUARE_TOKENIZE_TIMEOUT_MS`, because
      a real bank challenge runs at the customer's pace).
- [ ] **Expired hold** (Square will not let you wait 7 days):
      (a) on a test request, set the hold's expiry into the past in the preview database —
      `UPDATE "PaymentAttempt" SET "delayedUntil" = (now() at time zone 'utc') - interval '1 minute'
      WHERE "appointmentId" = '<appointment id>';` — then approval must be refused ("hold expired");
      run the notifications job on the preview (only with `PREVIEW_EMAIL_ALLOWLIST` set to your own
      address, §3 step 8: this run also sends any reminders, review requests and backlog due on the
      copied data) —
      `curl -H "Authorization: Bearer $CRON_SECRET" -H "x-vercel-protection-bypass: $BYPASS" https://<alias>.vercel.app/api/cron/notifications`
      — and the request must lapse with its email and the hold released.
      (b) On another test request, cancel the authorized payment directly in the sandbox —
      `curl -X POST https://connect.squareupsandbox.com/v2/payments/<payment id>/cancel -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" -H "Square-Version: 2026-09-16" -H "Content-Type: application/json"`
      — the webhook must move the attempt to `EXPIRED`/`VOIDED` and approval must be refused.
- [ ] **Double submit.** Double-click "Request booking – pay £X deposit if confirmed", and resubmit
      from a second tab: one
      booking, one hold in Square; a second hold, if one was made, is released.
- [ ] **Two customers racing.** Two test accounts, same stylist and time, submit together: one
      `PENDING` booking with a hold; the other is told the time has gone and holds nothing (or has
      its hold released).
- [ ] **Webhook duplicates and order.** Re-send a signed event twice and an older one late (below):
      the second copy is a no-op (one `SquareWebhookEvent` row); an `APPROVED` `payment.updated`
      sent after capture leaves the attempt `CAPTURED`.
- [ ] **Refund pending → completed.** Customer cancels a confirmed booking at least 24 hours ahead:
      refund requested, then pending, then completed (webhook or "Re-check payment"); Square lists
      the refund. Staff cancel with "Refund" unticked: deposit kept, no refund in Square.
- [ ] **Reconciliation.** Call the housekeeping job on the preview (as the notifications call
      above, `/api/cron/housekeeping`): nothing already settled changes; anything left pending by
      the tests above is settled or still listed in Admin → Operations.
- [ ] **Kill switch.** `SQUARE_PAYMENTS_ENABLED=false` on Preview + redeploy: a service that owes a
      deposit cannot be booked online ("Online payment isn't available"), and no Square call is made.
- [ ] **(review 2) A wrong access token is not a card decline.** Set `SQUARE_ACCESS_TOKEN` on Preview
      to a revoked or mistyped sandbox token, redeploy, and request a booking more than three times
      with `4111…`: each time "Online payment isn't available — call the salon", the attempt is
      `FAILED` with "Square refused the deposit request because of the Square setup …", Admin →
      Operations shows the setup refusals (not declines), the function log names HTTP 401 once, and
      the account is never refused for "too many declines". Put the right token back and redeploy.
- [ ] **(review 2) Mark refund as settled outside the website.** On a refund that is still
      unconfirmed (stop the webhook delivery, or cancel a confirmed test booking while the sandbox
      refund call is blocked), refund it in the sandbox Square Dashboard, then press the button on the
      booking: the confirm question names the amount, the refund reads "Settled outside the website",
      the deposit shows as refunded, the audit log has `PAYMENT.REFUND_SETTLED_OUTSIDE`, and the
      next housekeeping run sends nothing for it.

Re-sending a signed webhook (the body is any real `payment.updated` or `refund.updated` event —
Square's API reference shows examples — with your sandbox ids and a fresh `event_id`; sign the
exact bytes you send):

```bash
URL='<exactly SQUARE_WEBHOOK_NOTIFICATION_URL>'
KEY='<sandbox signature key>'
SIG="$(node -e 'const c=require("node:crypto"),f=require("node:fs");process.stdout.write(c.createHmac("sha256",process.argv[1]).update(process.argv[2]).update(f.readFileSync(process.argv[3])).digest("base64"))' "$KEY" "$URL" event.json)"
curl -sS -X POST "$URL" -H 'Content-Type: application/json' -H "x-square-hmacsha256-signature: $SIG" --data-binary @event.json
```

---

## 5. Production go-live checklist

Only once §4 has passed on the release candidate (S1–S4 merged and deployed).

**Owner**
- [ ] A Square **seller** account in the salon's legal name (the merchant of record), United
      Kingdom, GBP; identity checks complete; payout bank account added; the Leeds location
      (Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX) can take card payments.
- [ ] The deposit policy (§1.1) and the late-cancellation / no-show line on `/booking-terms`
      (`legal.bookingTerms.cancelling.lateOrNoShow`, en + zh; the booking page repeats it before the
      card form, `booking.deposit.lateOrNoShow`) — change both if the rule differs. Staff can only
      keep a whole deposit or refund all of it, so the line must not promise anything in between.
      Keep the percentage proportionate: Admin → Site Settings warns above 50%.

**Developer, signed in to the Developer Console with the salon's Square account**
- [ ] The production application must belong to the **salon's** account: the code uses one
      personal access token, which acts as that account. (A developer-owned app would need OAuth,
      which is not built.)
- [ ] Application → **Production**: Credentials → Application ID (`sq0idp-…`) and Production Access
      token (full access to the salon's Square account — treat it like a bank password);
      Locations → the Leeds location ID (GB, GBP).
- [ ] **Webhooks → Subscriptions → Add subscription** (Production): URL exactly
      `https://www.harbourhair.co.uk/api/webhooks/square` — `https`, `www`, no trailing slash, no
      query. The bare domain and `harbourhairsalon.vercel.app` redirect to `www`, and Square treats
      any non-2xx answer, a redirect included, as a failed delivery. API version 2026-09-16;
      events `payment.created`, `payment.updated`, `refund.created`, `refund.updated`. Copy the
      Signature Key.
- [ ] Vercel **Production** env: the seven variables of §2. Then deploy (re-run the latest `main`
      "CI/CD Pipeline" run if there is no new merge).
- [ ] Admin → Site Settings no longer says booking is locked until Square production credentials
      are configured. "Send test event" on the production subscription gets `200`.
- [ ] Admin → Site Settings → Deposits: on, percent, minimum. Admin → Services & Pricing → the
      per-service overrides.
- [ ] Open booking in the order of `LAUNCH.md` §3, then one **real** booking on the owner's card:
      give one service a temporary fixed deposit of £0.01 (Square's minimum), request it, approve
      (Square shows the payment completed), cancel at least 24 hours ahead (refund pending, then
      completed in Square), and put the override back. Square keeps its fee (about 25p) even after
      the refund.
- [ ] For the first week, check Admin → Operations and the daily email for payments needing
      attention, and compare with the Square Dashboard.

---

## 6. Operations (staff)

**What staff see.** Admin → Schedule shows each booking's deposit (held, taken, released, refund
pending, refunded, or needing attention). **Approve** takes the deposit; **Decline** releases it;
**Cancel** on a confirmed booking offers "Refund the £X deposit" (ticked; untick to keep it for a
late cancellation or no-show, as the booking terms allow); **Mark completed** releases a hold that
was never taken (collect the full price in the salon — the confirm question says so) and keeps a
taken deposit towards the bill; **Re-check payment** asks Square again; **Mark refund as settled
outside the website** (shown next to it only for a refund Square has not confirmed) records that you
refunded the customer yourself, so the website never sends that refund (review 2).
Admin → Operations lists payments needing attention, and so does the daily "needs attention" email.
Customers see their deposit's state in My Bookings and in their emails.

**Answer requests the same day.** A hold lasts at most 7 days and cannot be captured after it
ends: the request lapses and the customer has to book again.

**A payment that looks stuck or unknown**
1. Open the booking in Admin → Schedule and press **Re-check payment** (next to its deposit). It
   asks Square at once, releases a hold nothing needs, retries a refund with its original key,
   follows a pending one and settles a capture whose outcome was unclear, then says what is true
   now. "Pending" usually just needs time; the daily housekeeping run (03:15 UTC) re-checks
   everything open.
2. Still unresolved: find the payment in the Square Dashboard (Transactions — the note reads
   "Booking deposit: <service> on <date> at <time> (salon time)") and compare amount and state.
3. By case (Admin → Operations → **Payments needing attention** names each):
   - **Waiting for an answer from Square** (an authorization or a capture nobody heard back about):
     re-check later. An authorization with no booking is cancelled by its key every day until any
     hold would have expired (7 days); the customer is never charged for it.
   - **Taken, request not confirmed:** confirm the request (the deposit is not taken twice). Once
     its appointment has passed (it can no longer be confirmed), **mark it completed** if the
     customer came — the deposit is kept towards the bill — or **decline** it — the deposit is
     refunded in full. Do it the same day: **12 hours after the appointment ends** the daily run
     (03:15 UTC) closes it and refunds the deposit by itself (review 2).
   - **Hold not released yet** (the request closed, or nothing was booked): reconciliation keeps
     releasing it; Square releases it at its expiry anyway and the customer is never charged.
   - **Taken after the booking closed:** refunded in full automatically (reason "Taken after the
     booking closed"); nothing to do unless that refund fails. Consider telling the customer.
   - **Taken on a cancelled booking: no refund, no keep recorded:** a keep is recorded since the
     review (`KEPT`), so this is unexpected: check what happened; refund it in the Square Dashboard
     if the customer is owed it.
   - **Refund failed or rejected:** refund the customer another way (Square Dashboard, or cash in
     the salon) and note it on the booking. Never refund the same money in both places.
   - **Refund not confirmed by Square:** it is asked again with the same key (which can only ever
     return the same refund). If it is still listed the next day, Square may be refusing the retry
     (for example after the access token changed) although the first request went through: check
     the payment in the Square Dashboard — it may already be refunded — before refunding anything
     by hand.
   - **(review 2) Not confirmed by Square after 7 days** (`UNRESOLVED`): the website has stopped
     asking. Check the payment in the Square Dashboard. If it shows the refund, or once you have
     refunded the customer there or in cash, open the booking in Admin → Schedule and press **Mark
     refund as settled outside the website** (it asks first, naming the amount). The refund then
     reads "Settled outside the website", the deposit shows as refunded and nothing is sent to
     Square again. Use the same button for any refund Square has not confirmed that you settled by
     hand. If Square later reports a refund for it as well, that notice is listed under
     "Square notifications that matched nothing" — check for a double refund.
   - **(review 2) Square refused deposit payments because of the website's setup** (401, 403 or
     404 — the access token, its permissions or the location): customers who owe a deposit are
     told to call the salon until it is fixed; nothing was held or charged, and it is never counted
     as card declines. Check the seven `SQUARE_*` variables in Vercel (§2, and that the token
     belongs to the salon's account and has not been revoked), then redeploy.
   - **Card declines (Operations, and the email from 5 a day):** a few are ordinary. A run of them
     can be someone testing stolen cards; the website already stops card attempts from the same
     account (3) or address (5) for a day. Check the Square Dashboard for anything unusual.
   - **A Square notification that matched nothing:** identify the payment from its Square ID, note
     and amount; if a customer was charged without a booking, refund it in the Square Dashboard.
     (Refunds of the salon's own card-reader sales are not listed here: their payment is none of
     the website's deposits, so they are settled at once — review 2.)
4. Never edit payment or booking status in the database by hand — "Mark refund as settled outside
   the website" is the recorded, audited way to close a refund you settled yourself.

**Stopping**
- To stop new online bookings: Admin → Site Settings → booking off. Holds already placed are still
  captured or released by staff actions, and customers can still cancel.
- `SQUARE_PAYMENTS_ENABLED=false` stops every Square call. Emergency use only: in production it
  also locks online booking, existing holds can then be neither captured nor released by the
  website (Square releases them at expiry), and refunds wait until it is back on.

---

## 7. Preview database

Previews never migrate (only production builds run `prisma migrate deploy`), so every PR's
"Deploy Preview" fails until the preview database (Neon `harbour-hair-preview-lhr`, a copy of
production with real customer data) has the new tables. Apply `20261013120000_square_deposits` —
and anything else pending — before the preview of this work can deploy:

```bash
tmp="$(mktemp -d)"
vercel env pull "$tmp/preview.env" --environment=preview --yes   # the preview DB vars are readable Config
read_var() { grep "^$1=" "$tmp/preview.env" | cut -d= -f2- | tr -d '"'; }
export POSTGRES_URL="$(read_var POSTGRES_URL)" POSTGRES_URL_NON_POOLING="$(read_var POSTGRES_URL_NON_POOLING)"
printf '%s\n' "$POSTGRES_URL" "$POSTGRES_URL_NON_POOLING" | grep -o 'ep-[a-z0-9-]*' | sort -u
#   ↑ must be the PREVIEW endpoint (ep-snowy-fire-…), never production's — stop here otherwise
pnpm exec prisma migrate status --schema prisma/vercel/schema.prisma
pnpm exec prisma migrate deploy --schema prisma/vercel/schema.prisma
rm -rf "$tmp"; unset POSTGRES_URL POSTGRES_URL_NON_POOLING
```

---

## 8. Fees

Square advertises these standard UK online card rates for Online Checkout and the eCommerce API:

| Card | Advertised processing rate |
| --- | --- |
| UK-issued | 1.4% + 25p |
| Non-UK-issued | 2.5% + 25p |

Illustrative UK-card fees, calculated from that advertised rate:

| Deposit collected | Fee | Net received | Fee as percentage of deposit |
| --- | --- | --- | --- |
| £10 | £0.39 | £9.61 | 3.90% |
| £15 | £0.46 | £14.54 | 3.07% |
| £50 | £0.95 | £49.05 | 1.90% |
| £100 | £1.65 | £98.35 | 1.65% |

The fixed 25p weighs heavily on small deposits. Square does not return its processing fee when a
payment is refunded, so a refunded deposit still costs the fee. Confirm the account's own rate
before launch. The UK card minimum is **£0.01**; a zero deposit means no payment at all, never a
zero-value authorization. Amounts are integer pence, currency `GBP`.

---

## 9. Square API facts the gateway relies on

| Operation | Square request | Notes |
| --- | --- | --- |
| Authorize | `POST /v2/payments` | Card token, stable `idempotency_key` (≤ 45 chars), `amount_money` in GBP pence, location, `reference_id` (≤ 40 chars), `autocomplete: false`, `delay_action: "CANCEL"`. |
| Retrieve payment | `GET /v2/payments/{payment_id}` | Current state before capture and to resolve an unclear outcome. |
| Capture | `POST /v2/payments/{payment_id}/complete` | `APPROVED` payments only; the gateway sends the retrieved `version_token`, never another amount. |
| Release | `POST /v2/payments/{payment_id}/cancel` | Cancels an `APPROVED` payment; not a refund. |
| Release by key | `POST /v2/payments/cancel` | When the payment id was never received. Its empty success also occurs when nothing matched, so on its own it proves nothing about a known payment. |
| Refund | `POST /v2/refunds` | Captured (`COMPLETED`) payments only; durable refund idempotency key; no `location_id` on a linked refund; reason ≤ 192 chars. |
| Retrieve refund | `GET /v2/refunds/{refund_id}` | Follows `PENDING` to `COMPLETED`, `FAILED` or `REJECTED`. |

- Sandbox base URL `https://connect.squareupsandbox.com`, production `https://connect.squareup.com`;
  credentials and objects are not interchangeable between them.
- A timeout or malformed answer after a submission has an **unknown** outcome: recover with the
  same key, never a new one.
- Online (card-not-present) holds default to 7 days; at `delayed_until` Square applies
  `delay_action` (here `CANCEL`).
- Refunds: one year from the payment, at most 20 per payment; the payment stays `COMPLETED` after a
  full refund. Square tells sellers a refund can take up to 4–14 working days to reach the customer
  (7–10 business days in its developer documentation); the booking terms say "most banks 5–10
  working days; some take up to 14".
- Webhooks: any `2xx` acknowledges; anything else is retried with back-off for up to 24 hours;
  events can arrive more than once and in any order; `event_id` identifies a delivery.
- Card form: Web Payments SDK card fields, Strong Customer Authentication through
  `card.tokenize(verificationDetails)` (amount as `"12.50"`, `GBP`, `CHARGE`, customer-initiated,
  not seller-keyed, billing contact from the account); the older separate `verifyBuyer()` is not
  used. The page needs a secure context and the CSP in `next.config.ts`.

---

## 10. Verification

`pnpm test:square` runs the Square suites; `pnpm test` runs everything. Unit tests with fake
gateways prove the request shapes, state transitions and refusals; they cannot prove credentials,
Strong Customer Authentication, webhook delivery or recovery against Square — that is §4.

## Sources

- Square: [Sandbox](https://developer.squareup.com/docs/devtools/sandbox/overview) ·
  [Sandbox test values](https://developer.squareup.com/docs/devtools/sandbox/payments) ·
  [Sandbox test accounts and tokens](https://developer.squareup.com/docs/testing/create-and-authorize-sandbox-account) ·
  [Developer Console](https://developer.squareup.com/docs/devtools/developer-dashboard) ·
  [Access tokens](https://developer.squareup.com/docs/build-basics/access-tokens) ·
  [Delayed capture](https://developer.squareup.com/docs/payments-api/take-payments/card-payments/delayed-capture) ·
  [Refund payments](https://developer.squareup.com/docs/payments-api/refund-payments) ·
  [Webhooks](https://developer.squareup.com/docs/webhooks/overview) ·
  [Subscribe](https://developer.squareup.com/docs/webhooks/step2subscribe) ·
  [Validate signatures](https://developer.squareup.com/docs/webhooks/step3validate) ·
  [Webhooks in production](https://developer.squareup.com/docs/webhooks/movetoprod) ·
  [Take a card payment](https://developer.squareup.com/docs/web-payments/take-card-payment) ·
  [Web Payments CSP](https://developer.squareup.com/docs/web-payments/content-security-policy) ·
  [CreatePayment](https://developer.squareup.com/reference/square/payments/create-payment) ·
  [CompletePayment](https://developer.squareup.com/reference/square/payments-api/complete-payment) ·
  [CancelPayment](https://developer.squareup.com/reference/square/payments-api/cancel-payment) ·
  [CancelPaymentByIdempotencyKey](https://developer.squareup.com/reference/square/payments-api/cancel-payment-by-idempotency-key) ·
  [RefundPayment](https://developer.squareup.com/reference/square/refunds/refund-payment) ·
  [Payment minimums](https://developer.squareup.com/docs/payment-minimums) ·
  [UK pricing](https://squareup.com/gb/en/pricing) ·
  [UK fee schedule](https://squareup.com/gb/en/legal/general/fees) ·
  [UK refunds help](https://squareup.com/help/gb/en/article/5615)
- Vercel: [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) ·
  [Generated URLs](https://vercel.com/docs/deployments/generated-urls) ·
  [Alias a preview with the CLI](https://vercel.com/kb/guide/how-to-alias-a-preview-deployment-using-the-cli) ·
  [`vercel env`](https://vercel.com/docs/cli/env)
