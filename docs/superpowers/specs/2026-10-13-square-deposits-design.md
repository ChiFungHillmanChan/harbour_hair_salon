# Square deposits — design (2026-10-13)

Supersedes the 2026-09-16 plan for implementation purposes. `docs/square-payments-setup.md`
remains the reference for Square API behaviour; this file decides how the website uses it.

## Goal

Online booking requests take a card deposit through Square, so the salon can open
self-service booking. The code is complete and testable in Square **Sandbox** before the
salon has a Square account; production needs only credentials (env vars), a webhook
subscription and the owner's deposit amounts.

## Decisions

| Topic | Decision |
|---|---|
| When money moves | **Authorize** at request time (`autocomplete:false`, `delay_action:CANCEL`), **capture** when staff approve, **void** when the request is declined / lapses / the hold expires, **refund** when a confirmed booking is cancelled. |
| Card form | Square Web Payments SDK card fields; SCA via `card.tokenize(verificationDetails)` (amount as `"12.50"`, `currencyCode:'GBP'`, `intent:'CHARGE'`, `customerInitiated:true`, `sellerKeyedIn:false`, billingContact from the account). No `verifyBuyer()`. Card data never touches our server. |
| Deposit policy | Admin → Settings: `depositsEnabled` (default **false**), `depositPercent` (whole %, 0–100), `depositMinimumServicePence` (services cheaper than this need none). Per service (Admin → Services): `depositOverridePence` — empty = salon %, `0` = never, `N` = fixed N pence (capped at the price). Amount = `calculateDepositPence` on the **server quote** (`quote.amountPence`). |
| Which bookings | Customer self-service requests only. Staff-entered bookings never take a deposit. Deposit 0 ⇒ the existing no-payment flow. |
| Refunds | Declined / lapsed / expired request: void (no charge). Customer cancels a confirmed booking online (≥24 h, existing rule): **full refund**. Staff cancel a confirmed booking: refund by default, staff may keep it (late cancellation / no-show). Completed: kept (counts toward the bill). Reschedules keep the deposit attached. |
| Hold expiry | Square cancels an uncaptured online-card authorization at `delayed_until` (≤7 days). Approval after that is refused; the notifications cron lapses PENDING requests whose hold has expired (same REQUEST_LAPSED email). |
| Production lock | `isOnlineBookingLockedForPayments(env)`: in a production build (not preview) booking stays closed unless `parseSquareConfig(env)` returns a config with `environment === 'production'`. Sandbox credentials can never open production. Parse errors ⇒ locked. `SQUARE_DEPOSITS_WIRED` becomes `true` (the code path exists). |
| No gateway | If a booking's deposit > 0 and no usable Square config exists (or sandbox in production), `submitBooking` refuses (`PAYMENT_UNAVAILABLE`) — fail closed, no booking without the deposit. |
| Kill switch | `SQUARE_PAYMENTS_ENABLED !== 'true'` ⇒ no Square calls at all (existing `parseSquareConfig`). |
| Neon cost | No new cron. Webhooks are a handful per booking. Reconciliation rides the existing daily housekeeping run and an admin "Re-check payment" button. |

## Data model (all three Prisma schemas + migrations)

```prisma
model PaymentAttempt {
  id                String    @id @default(cuid())   // also Square reference_id (≤40 chars)
  userId            String?
  user              User?        @relation(fields: [userId], references: [id], onDelete: SetNull)
  attemptKey        String                         // client UUID for this card submission
  idempotencyKey    String    @unique              // Square CreatePayment key (≤45 chars)
  appointmentId     String?   @unique
  appointment       Appointment? @relation(fields: [appointmentId], references: [id], onDelete: SetNull)
  status            String    @default("INITIATED")
  // INITIATED → AUTHORIZED → CAPTURING → CAPTURED (→ KEPT: staff kept it on cancelling)
  //           ↘ FAILED (declined)   AUTHORIZED ↘ VOIDED | EXPIRED
  //           ↘ UNKNOWN (no answer; voided by key, then VOIDED)   CAPTURING ↘ CAPTURE_UNKNOWN
  environment       String                         // sandbox | production
  locationId        String
  amountPence       Int
  currency          String    @default("GBP")
  quoteAmountPence  Int                            // price the deposit was taken from
  policyJson        String                         // percent / minimum / override used
  requestJson       String                         // serviceId, stylist choice, date — the request fingerprint
  squarePaymentId   String?   @unique
  delayedUntil      DateTime?
  authorizedAt      DateTime?
  capturedAt        DateTime?
  voidedAt          DateTime?
  lastError         String?                        // our own fixed codes only, never provider text
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  refunds           PaymentRefund[]
  @@unique([userId, attemptKey])
  @@index([status, createdAt])
}

model PaymentRefund {
  id              String   @id @default(cuid())
  attemptId       String
  attempt         PaymentAttempt @relation(fields: [attemptId], references: [id], onDelete: Restrict)
  idempotencyKey  String   @unique
  squareRefundId  String?  @unique
  amountPence     Int
  status          String   @default("REQUESTED") // REQUESTED, SUBMITTING, PENDING, COMPLETED, FAILED, REJECTED, UNKNOWN
  reason          String                          // CUSTOMER_CANCELLED | STAFF_CANCELLED | SLOT_LOST | LATE_CAPTURE | REQUEST_LAPSED
  requestedById   String?                         // admin user id; null = customer / system
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([status, createdAt])
}

model SquareWebhookEvent {
  eventId     String    @id
  type        String
  objectId    String?
  receivedAt  DateTime  @default(now())
  processedAt DateTime?
}
```

`SiteSettings`: `depositsEnabled Boolean @default(false)`, `depositPercent Int @default(0)`,
`depositMinimumServicePence Int @default(0)`. `Service`: `depositOverridePence Int?`.
No personal data in payment rows beyond the user link (erasure anonymises the user; the
money record stays — legal obligation).

## Flows

### Quote (shown before the card form)
`previewBookingQuote(serviceId)` (server action, public-availability rate limit) returns
`{ amountPence, depositPence, remainderPence }` from `quoteForNewBooking` + settings + service
override. The wizard tokenizes for exactly `depositPence` and sends `expectedDepositPence`;
`submitBooking` recomputes and refuses `QUOTE_CHANGED` on any difference (customer re-reviews).

### Submit (deposit > 0)
1. Existing gates, validation, rate limits, verified email, minimum notice.
2. `attemptKey` (UUID v4 from the client, regenerated for every new card tokenization).
   Existing attempt for (user, attemptKey) ⇒ replay its outcome; never authorize twice.
3. Existing same-customer/service/time PENDING|CONFIRMED appointment ⇒ success, no charge (F1).
4. Non-locking slot pre-check ⇒ `SLOT_UNAVAILABLE` before any money moves.
5. Insert `PaymentAttempt(INITIATED)` (short transaction).
6. `gateway.authorize` **outside** any transaction (`reference_id = attempt.id`, note with
   service + date, no PII).
   - OK ⇒ `AUTHORIZED` (+ `squarePaymentId`, `delayedUntil`).
   - `provider_error` ⇒ `FAILED`; customer: card declined / not verified, nothing booked.
   - `unknown_outcome` / `invalid_response` ⇒ `UNKNOWN`; best-effort
     `cancelByIdempotencyKey`; customer: "we couldn't confirm the payment, nothing was
     booked; any hold is released automatically". Never a new key for the same submission.
7. `createBooking` serializable transaction (unchanged checks) also links the attempt
   (`appointmentId`). Slot lost ⇒ commit nothing, then `gateway.cancel` ⇒ `VOIDED`
   (failure ⇒ stays `AUTHORIZED`, housekeeping voids it; Square auto-cancels at worst).
8. Emails: REQUEST_RECEIVED mentions the hold.

### Approve (staff) — capture
1. Existing pre-approval feed refresh. Attempt must be `AUTHORIZED` with `delayedUntil` in
   the future (else refuse `DEPOSIT_HOLD_EXPIRED`).
2. Serializable tx #1: existing checks (PENDING, readiness, slot); conditional
   `AUTHORIZED → CAPTURING` (only one admin wins).
3. Outside tx: `getPayment` (must be `APPROVED`, amount/reference match) → `capture(versionToken)`.
   - Failure ⇒ back to `AUTHORIZED` (or `EXPIRED` if Square says CANCELED); approval refused.
   - Unknown ⇒ `getPayment` again: COMPLETED ⇒ continue; otherwise `CAPTURE_UNKNOWN`, refused,
     "try again in a minute" (a retry starts with `getPayment`).
4. Serializable tx #2: still PENDING and slot free ⇒ CONFIRMED + `CAPTURED` + CONFIRMATION
   email. Slot lost in between (rare) ⇒ CANCELLED + `PaymentRefund(SLOT_LOST)` full, refund
   after commit, customer told, admin told.

### Decline / lapse / customer cancels a request — void
Status change commits first; then `gateway.cancel` ⇒ `VOIDED` (failure ⇒ left for housekeeping).

### Cancel a confirmed booking — refund
Customer online (≥24 h): full refund. Staff: `refundDeposit` flag (UI default on). The
`PaymentRefund(REQUESTED)` row is written in the cancellation transaction; `gateway.refund`
runs after commit with the row's idempotency key; status follows the response, then webhooks /
reconciliation to a terminal state. Pending/failed refunds are shown honestly.

### Webhook `POST /api/webhooks/square`
Not configured ⇒ 404. Raw body → `verifySquareWebhookSignature` with the configured key and
exact URL → 401 on mismatch. Zod-parse; `SquareWebhookEvent` insert dedupes (`event_id`).
`payment.*`: match attempt by `squarePaymentId` or `reference_id`; forward-only status moves
(`APPROVED` never overwrites `CAPTURED`; `CANCELED` ⇒ `EXPIRED`/`VOIDED`). `refund.*`: match by
`squareRefundId`; forward-only. Unmatched ⇒ recorded, 200. Booking state is never changed here.

### Reconciliation
Housekeeping (daily): `INITIATED`/`UNKNOWN` > 15 min, no appointment ⇒ `cancelByIdempotencyKey`
⇒ `VOIDED`; orphan `AUTHORIZED` > 15 min ⇒ cancel; `REQUESTED`/`UNKNOWN` refunds ⇒ retry with the
same key; `PENDING` refunds ⇒ `getRefund`; `CAPTURE_UNKNOWN` ⇒ `getPayment`. Admin
"Re-check payment" does the same for one appointment. The daily ops alert lists anything still
unresolved.

**As built (S4, 2026-10-13)** — refinements from the money-safety review, kept in
`docs/square-payments-setup.md` §1.7–1.8:
- The webhook drops event types it does not act on, other locations and payments without a
  deposit reference (in-salon card-reader sales) before the database is opened — Square notifies
  every payment on the account (Neon compute budget).
- Notices move payment rows only where Square's word is final (COMPLETED / CANCELED / FAILED);
  APPROVED never changes a status. When a notice says Square holds money no booking wants, or took
  money the site believed held or released, the event stays open and the site reads Square afresh
  after answering (`after()`), then releases the hold or refunds in full; the daily run picks up
  what did not finish.
- "Orphan" holds are `AUTHORIZED` attempts whose appointment is missing or not `PENDING` (a failed
  release, a lapse that ran out of time) — not only those with no appointment.
- `UNKNOWN` authorizations are cancelled by key every day for 7 days (cancel-by-key answers `{}`
  even when nothing has landed yet), then settled `VOIDED`.
- A deposit Square took after its booking closed or was never made is recorded `CAPTURED` and
  refunded in full with reason `LATE_CAPTURE`; one taken for a request still `PENDING` is left to
  staff (confirming keeps it, declining refunds it) and flagged.
- Every gateway comes from the guarded configuration (`createSquareGateway` has no default).

**As built (money-safety review fixes, 2026-10-13)** — no schema change (status columns are plain
strings; only the Prisma comments list the new values):
- **Refunds (W1).** The Square request is only the payment, the amount and the row's key — no
  free-text reason — so a retry after any deploy is the identical request. The first send is
  claimed `REQUESTED → SUBMITTING` before Square is called; only a refusal of that provably first
  send records `FAILED`. A refusal of a retry (`UNKNOWN`, or a `SUBMITTING` row whose sender went
  quiet for 2 minutes, taken over as `UNKNOWN`) keeps it `UNKNOWN`, untouched, so the attention list
  and daily email keep showing it. `SUBMITTING` counts in the refundable remainder, is matched by
  refund notices and is retried by reconciliation and "Re-check payment".
- **Credentials per environment (W2).** `usableSquareConfig`: production credentials only in a
  production build, sandbox credentials only everywhere else (previews, development, tests).
- **Lapse (W3, W4).** Once its appointment has ended, a request whose deposit was taken or whose
  capture is unclear is settled with Square (only once quiet for 2 minutes) and closed like a staff
  decline: `CANCELLED`, a full refund with reason `REQUEST_LAPSED` (sent after the commit), the
  request-lapsed email saying the deposit is being refunded. A request whose hold is gone —
  `EXPIRED` or `VOIDED` — lapses at once with the hold-ended wording.
- **Unanswered captures and keeps (I1).** `CAPTURE_UNKNOWN`, like `CAPTURING`, is settled only once
  quiet for `CAPTURE_STALE_MS` (2 minutes); closings refuse `DEPOSIT_IN_PROGRESS` until then (a
  timed-out CompletePayment can still land). Confirming again may retry at once. Staff keeping a
  deposit on cancelling records `CAPTURED → KEPT`; the display, refundable remainder,
  reconciliation (never a late-capture refund), attention list and Operations all read it.
- **Lost booking answers (I3).** A non-refusal error from the booking transaction re-reads the
  attempt: tied to its appointment ⇒ answered as booked, hold kept; not tied ⇒ released; unreadable
  ⇒ left for reconciliation, customer told `PAYMENT_PENDING`.
- **Card testing (I4).** A decline budget (`lib/rate-limit.ts` `createFailureLimiter`, never fails
  open): 3 declined deposit cards per account or 5 per address in 24 hours, checked before an
  attempt is written or Square is asked (`PAYMENT_UNAVAILABLE`). Operations counts the last day's
  declines; the daily email raises them from 5.

**As built (review round 2, 2026-10-13)** — no schema change:
- **Setup refusals are not declines (W-A).** Only HTTP 400/402 is a card decline. 401/403/404 and any
  other 4xx are the website's own Square setup: `FAILED` + `PAYMENT_SETUP_REFUSED`, the customer is
  told `PAYMENT_UNAVAILABLE`, no decline budget is used, the log names the status once per
  instance, and Operations / the daily email raise it as a configuration problem.
- **In-salon refunds (W-B).** Events the schema cannot read are dropped before the database when they
  name another location; a refund whose payment is none of our attempts is processed at once
  (`NOT_OURS`), never listed or re-read.
- **Refund retries (W-C).** Each retry is dated on its row (the daily batch rotates); 7 days after the
  refund was requested a sent one becomes `UNRESOLVED` (counted, never resent, listed for staff,
  still matched by Square's notices). Staff record a refund they settled themselves with the audited
  "Mark refund as settled outside the website" ⇒ `SETTLED_EXTERNALLY` (counted, final).
- **A hold Square shows taken (I-D)** on a still-PENDING request is recorded `CAPTURED` + flagged, so a
  decline refunds it at once.
- **Lapse grace (I-E).** A taken deposit on an unconfirmed request is lapsed and refunded only by the
  daily housekeeping run, 12 hours after its appointment ended (staff may mark it completed first).
- **State-key sentences (I-F)** are pinned in `operations-messages.test.ts`.

## UI and copy (en + zh)
- Wizard review step: price, deposit now, remainder in salon, refund rules, link to
  `/booking-terms`; Square card form only when deposit > 0; errors in plain language.
- `/booking-terms` page (ISR, both languages): deposit, cancellation ≥24 h, late cancellation /
  no-show, declined requests, refunds timing (5–10 working days), contact.
- Emails: REQUEST_RECEIVED (hold), CONFIRMATION (deposit paid, remainder), CANCELLATION
  (refunded / hold released / kept), REQUEST_LAPSED (hold released).
- My appointments: deposit status line. Admin schedule: deposit chip, approve = capture, cancel
  dialog with "Refund the £X deposit", "Re-check payment". Admin → Settings: deposit policy.
  Admin → Services: per-service override. Operations: payments needing attention.
- Privacy notice: Square as payment processor (card data handled by Square; we keep amounts,
  status and Square IDs).
- CSP (from Square's CSP guide): script-src/frame-src/style-src `https://web.squarecdn.com`
  `https://sandbox.web.squarecdn.com`; connect-src already `https:`; font-src
  `https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net`.

## Phases
1. **S1 Foundation:** schema + migrations, settings/service fields + admin UI, deposit quote
   service + `previewBookingQuote`, production lock tied to config, CSP. Tests.
2. **S2 Submit:** attempt service, submitBooking integration, card form + wizard step, copy,
   REQUEST_RECEIVED. Tests with a fake gateway.
3. **S3 Lifecycle:** approve/capture, decline/lapse/expiry void, cancel/refund (customer + staff),
   appointment + admin UI, emails. Tests.
4. **S4 Webhook + reconciliation:** route, event store, housekeeping, re-check, ops alert,
   Operations section, firewall allow-list. Tests.
5. **S5 Docs + legal:** `/booking-terms`, privacy notice, `docs/square-payments-setup.md` runbook
   (sandbox → production), CLAUDE.md, LAUNCH.md.

## Acceptance (needs credentials — owner/developer)
Sandbox: approve/capture, decline/void, declined card, 3-D Secure challenge card, expired hold,
double submit, two customers racing for a slot, webhook duplicates/out-of-order, refund
pending→completed. Then production credentials + webhook, one real £0.01-policy test booking.
