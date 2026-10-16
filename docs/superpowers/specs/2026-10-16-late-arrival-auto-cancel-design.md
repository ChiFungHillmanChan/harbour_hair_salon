# Late arrivals: automatic cancellation — design

**Status:** design approved in conversation 2026-10-16, awaiting written-spec review
**Origin:** owner request 2026-10-16: "for people who are late for 15 minutes +, cancel his booking"
**Related:** `2026-10-13-square-deposits-design.md` (deposit closing), no-show rule
(owner, 2026-10-16: a no-show's deposit is never refunded)

## 1. Problem

The salon wants a customer who is 15 minutes or more late to lose the booking,
so the chair can go to someone else (Fresha re-sells it through the busy feed).
Today nothing records whether a customer has arrived, so the website cannot
tell a late customer from one sitting in the chair. Staff can only cancel by
hand, and the admin dialog already starts at "keep the deposit" once the visit
time has passed.

## 2. Decisions (owner, 2026-10-16)

| # | Question | Decision |
|---|---|---|
| D1 | Manual button, automatic, or terms only? | **Automatic.** |
| D2 | How does the website know the customer came? | **Staff tap "Arrived"** on the admin board / booking dialog. "Mark completed" counts as arrived. A staff booking whose start is not after the moment it was entered (a walk-in) is arrived on creation. |
| D3 | When does the cancellation run? | **On the existing calendar-sync cron** (`*/30`, staff hours only): no extra Neon wake. A booking is cancelled between 15 and 45 minutes after its start. |
| D4 | Undo | **Restore within 24 hours** of the automatic cancellation. |
| D5 | Deposit and notice | **As a no-show: the deposit is kept** (`KEPT`), and the customer is emailed (en/zh). The booking terms and the confirmation/reminder emails state the rule. |
| D6 | Rollout | The feature ships **switched off**. The owner switches it on in Admin → Settings after telling staff to tap "Arrived". |

Rejected: a new 15-minute cron (≈ +14 CU-h a month for 15 minutes' precision);
customer self check-in (needs a tablet left open); a delayed per-booking job
(QStash/Queues — new infrastructure for one rule).

## 3. Data model

All three schemas (`prisma/vercel`, `prisma/dev`, `prisma/prod`), one migration
each; the preview database gets the migration by hand (CLAUDE.md, "Preview
deployments").

```prisma
model Appointment {
  /// When staff recorded the customer as arrived. Null = not (yet) arrived.
  arrivedAt       DateTime?
  /// Set when the late-arrival rule cancelled this booking; cleared on restore.
  lateCancelledAt DateTime?
  @@index([status, arrivedAt, date])
}

model SiteSettings {
  /// Late-arrival auto-cancel: null = off. Otherwise only bookings that START
  /// after this instant are ever cancelled, so switching it on never reaches
  /// back to old bookings nobody marked arrived.
  lateAutoCancelSince DateTime?
}
```

`LATE_ARRIVAL_CANCEL_MINUTES = 15` and `LATE_ARRIVAL_LOOKBACK_MINUTES = 120` live
in `lib/booking-constants.ts`; the terms and emails read the 15 from there.

## 4. Behaviour

### 4.1 Arrival

- `markArrived(appointmentId, arrived: boolean)` — admin-only server action.
  Allowed for a CONFIRMED booking from 60 minutes before its start until the
  later of its end and its start + 120 minutes (the lookback, so a late customer
  on a short service can still be marked before the cron runs). `arrived=true` sets `arrivedAt=now` (only if null); `false` clears it.
  Audited `APPOINTMENT.ARRIVED` / `APPOINTMENT.ARRIVAL_CLEARED`. No email, no
  feed change.
- "Mark completed" sets `arrivedAt` when it is null (same transaction).
- A staff-entered booking created CONFIRMED with `date <= now` gets
  `arrivedAt = now` on creation.
- Moving a booking never changes `arrivedAt`.

### 4.2 Automatic cancellation

`cancelLateArrivals({ db, now })` in `services/late-arrival-cancel.ts`, called by
`/api/cron/calendar-sync` after the feed sync, in its own `try/catch`, recorded
as `BackgroundJobState('late-arrival-cancel')`. The route's existing kill-switch
(`CALENDAR_SYNC_ENABLED`) and staff-hours gate stay above it.

1. Read `SiteSettings.lateAutoCancelSince` from the row (not the day cache). Null → return.
2. Candidates: `status='CONFIRMED'`, `arrivedAt IS NULL`,
   `date > lateAutoCancelSince`, `date <= now - 15 min`,
   `date >= now - 120 min`. The lookback bounds the damage of a missed tick: a
   booking further back is left for staff, never cancelled late.
3. Each candidate in its own Serializable transaction (the pattern of
   `pending-request-lapse.ts`):
   - conditional update `WHERE id, status='CONFIRMED', arrivedAt IS NULL` →
     `status='CANCELLED'`, `lateCancelledAt=now`, `notificationVersion+1`;
     0 rows → skip (staff tapped Arrived meanwhile);
   - `planDepositForClosing(tx, id, { closing: 'CANCEL', refund: false,
     reason: <the RefundReason staff cancellations use>, requestedById: null, now })` → a taken deposit becomes `KEPT`;
     a capture in flight throws `DEPOSIT_IN_PROGRESS` → roll back, retry next tick;
   - queue the `LATE_CANCELLED` customer email with
     `nextAttemptAt = now + 30 min` (the restore grace, §4.3);
   - audit `APPOINTMENT.LATE_AUTO_CANCELLED` (actor null, metadata: minutes late,
     deposit outcome).
4. After commit: `settleDepositAfterCommit` (nothing to send for KEPT; kept for
   symmetry) and `invalidateStylistIcalFeedFromCron(stylistId)` so Fresha sees
   the chair free.
5. Result counts go to the job state; failures are logged with `describeFault`.

### 4.3 Restore

`restoreLateCancellation(appointmentId, options: { force?: boolean })` —
admin-only.

- Allowed when `status='CANCELLED'` and `lateCancelledAt` is within 24 hours.
- Clash check as for a staff move (other appointments and synced busy time).
  A clash returns the existing clash list; the dialog offers "Restore anyway"
  (`force`), because the customer is usually already in the chair.
- Serializable transaction: `status='CONFIRMED'`, `lateCancelledAt=null`,
  `arrivedAt=now`, `notificationVersion+1`; the deposit `KEPT → CAPTURED`
  (conditional) so it counts towards the bill again.
- The pending `LATE_CANCELLED` email is no longer current (§5) and is dropped
  unsent. If it had already gone, a `CONFIRMATION` email (with its calendar
  file) is queued so the customer's calendar matches.
- Audit `APPOINTMENT.LATE_CANCEL_RESTORED`; invalidate the stylist's feed.

### 4.4 Admin interface

- Booking blocks and the booking dialog: an **Arrived** toggle for CONFIRMED
  bookings (window as §4.1); an arrived booking shows a small "Arrived" mark.
- From 5 minutes after the start, a CONFIRMED booking not arrived shows
  "Not arrived — cancels automatically at HH:MM" (only while the setting is on).
- The schedule's today view lists those bookings above the grid.
- A late-cancelled booking (within 24 h) shows "Cancelled: arrived late" and a
  **Restore** button in the dialog.
- Admin → Settings: a checkbox "Cancel bookings automatically when the customer
  is 15+ minutes late and not marked Arrived". On sets `lateAutoCancelSince=now`;
  off sets null. Saved through the existing settings action and audit.

### 4.5 Customer-facing text (en + zh)

- `/booking-terms` → Cancelling: "If you are more than 15 minutes late and
  haven't let us know, we cancel your appointment so the time can go to another
  client, and we keep your deposit, as for a missed appointment. If you're
  running late, please call us." Keep `booking.deposit.lateOrNoShow` and
  `legal.bookingTerms.rights` consistent.
- Confirmation and reminder emails: one line with the same rule.
- New `LATE_CANCELLED` email: the appointment, that it was cancelled because the
  customer was more than 15 minutes late, the deposit kept (when there was one),
  the phone number; a `METHOD:CANCEL` calendar file.
- My Bookings: a cancelled booking with `lateCancelledAt` shows
  "Cancelled — more than 15 minutes late".

## 5. Notification outbox

New appointment email kind `LATE_CANCELLED` (customer). `isCurrent`:
`status === 'CANCELLED' && lateCancelledAt != null` and the payload's version is
the current one — so a restore inside the 30-minute grace drops it unsent.
`NOTIFICATIONS_ENABLED=false` (production today) holds it like every other
booking email.

## 6. Safety and money rules

- Never cancels a PENDING request, a pencil-in, an arrived or completed booking.
- Square is never called inside a transaction; KEPT needs no Square call.
- Reconciliation and the attention list already treat `KEPT` as deliberate; a
  restore returns the attempt to `CAPTURED`, the state of any confirmed booking
  with a taken deposit (verify in the plan that nothing keys on "was ever KEPT").
- The setting is off by default, and `lateAutoCancelSince` keeps old bookings
  out even when it is switched on.

## 7. Testing

- Unit (node:test, fake DB as the neighbouring tests): candidate selection
  (each boundary: 14/15 minutes, 120-minute lookback, `since`, arrived,
  PENDING); the conditional update losing to a concurrent Arrived; deposit KEPT;
  `DEPOSIT_IN_PROGRESS` skipped; email `nextAttemptAt`; restore inside/outside
  24 h, clash → force, KEPT → CAPTURED, email current/not current; markArrived
  window and auth; walk-in arrived on creation; settings toggle.
- Route: late-arrival runs after sync and never when the route is gated.
- i18n completeness; brand monochrome.
- Integration (`scripts/verify-booking-lifecycle.ts`, real PostgreSQL): a
  CONFIRMED booking with a taken deposit is late-cancelled (KEPT), restored
  (CAPTURED), and a concurrent Arrived wins.

## 8. Rollout

1. Merge → production deploy applies the migration; preview DB by hand.
2. Feature is off. Tell the owner: brief staff to tap **Arrived**, then switch
   it on in Admin → Settings.
3. Watch the job state in Admin → Operations for the first days.
