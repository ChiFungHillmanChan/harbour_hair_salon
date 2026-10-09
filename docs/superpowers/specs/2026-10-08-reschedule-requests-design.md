# Customer reschedule requests — design

**Status:** approved in conversation 2026-10-08, awaiting written-spec review
**Origin:** 2026-10-08 adversarial booking review, finding W3
**Depends on:** PR #59 (merge first — both touch `scripts/verify-booking-lifecycle.ts`)

## 1. Problem

Today a customer's self-service reschedule (`rescheduleAppointment` in
`src/app/actions/booking.ts`) moves a CONFIRMED booking straight to the new time:

- it stays CONFIRMED, so no member of staff reviews the new time — unlike a new
  online booking, which lands PENDING and needs approval;
- the new time is checked against Fresha data that may be up to 90 minutes old
  (`CALENDAR_FRESHNESS_MINUTES`), so a Fresha sale made since the last import can
  be double-booked;
- only the customer is emailed (`email-service.ts:75-79` sends `RESCHEDULE` to the
  customer alone), although three comments (`rate-limit.ts:152`,
  `booking.ts:577`, `booking.ts:607`) say "both sides" are emailed.

The salon's priority is consistency (no double-booked chair) over instant
self-service.

## 2. Decisions (owner, 2026-10-08)

| # | Question | Decision |
|---|---|---|
| D1 | What happens on a customer reschedule? | It becomes a **request** that staff approve. |
| D2 | Original vs requested time while waiting | **Original stays CONFIRMED; requested time is NOT held.** Approval re-checks it. |
| D3 | Unanswered requests | **Lapse automatically** once the requested time is < 24 h away; customer gets one email. |
| D4 | Customer actions while waiting | **Withdraw or replace**; one open request per booking. |
| D5 | Storage | **Two nullable fields on `Appointment`.** No new table, no new status. |
| D6 | Fresha refresh before staff approval | Refresh the stylist's feeds if older than **5 minutes**, then every stylist's feeds older than 30 minutes (as today) — for reschedule approvals **and** new-booking approvals. *(Amended 2026-10-09; see §8.)* |

Rejected: holding the requested slot (needs slot/feed changes everywhere);
releasing the original (a decline would lose the customer's booking); a
`RESCHEDULE_REQUESTED` status (≈12 status checks would each need to treat it as
confirmed-at-the-original-time — high double-booking risk); a separate
`RescheduleRequest` table (history is already in the audit log).

## 3. Data model

Add to `model Appointment` in **all three** schemas (`prisma/vercel`,
`prisma/dev`, `prisma/prod`), each with its own migration:

```prisma
/// Requested new start (UTC instant, like `date`). Null = no open request.
rescheduleRequestedDate DateTime?
/// When the open request was made; also its identity for emails and races.
rescheduleRequestedAt   DateTime?

@@index([rescheduleRequestedDate])
```

Invariant: both fields are null, or both are set. `status` is untouched by every
request transition, so slot computation, reminders, the outbound iCal feed and
every `status`-based query keep seeing the original time.

## 4. Lifecycle

| Event | Actor | Preconditions | Effect |
|---|---|---|---|
| Request | customer | see §5 | set both fields |
| Replace | customer | open request; see §5 | overwrite both fields |
| Withdraw | customer | owner; open request | clear both fields |
| Approve | staff | see §6 | `date := rescheduleRequestedDate`, clear fields |
| Decline | staff | open request | clear fields |
| Lapse | system (notifications cron) | `rescheduleRequestedDate < now + 24 h`, or original `date < now` | clear fields |
| Cancel booking | customer or staff | existing rules | also clear fields |

**Expired is derived, not stored.** A request whose `rescheduleRequestedDate` is
< 24 h away is treated as expired everywhere (cannot be approved, shows
"expired") from that instant; the cron only does the clean-up and email.
*(Amended 2026-10-09.)* A request is equally moot once the booking's
**original** `date` has passed (`isRescheduleRequestMoot`): it shows as expired,
is not counted, and approval is refused with `RESCHEDULE_REQUEST_EXPIRED`.

**Concurrency.** Every transition runs in `runSerializableWithRetry` and writes
with a conditional `updateMany` on
`{ id, status: 'CONFIRMED', date, rescheduleRequestedAt }` (the values read in the
same transaction). Withdraw-vs-approve, replace-vs-decline, lapse-vs-approve:
exactly one wins; the loser gets `RESCHEDULE_REQUEST_CHANGED`.

**Audit.** Each transition appends an audit event:
`APPOINTMENT.RESCHEDULE_REQUESTED`, `…_REPLACED`, `…_WITHDRAWN`, `…_APPROVED`,
`…_DECLINED`, `…_LAPSED`, metadata `{ from, to, requestedAt }`.

**`notificationVersion`** is bumped **only on approve** (the time actually
changes). Request, replace, withdraw, decline and lapse leave it alone, so queued
reminders and the original confirmation stay valid.

## 5. Customer flow

### UI (`src/components/appointments/AppointmentCard.tsx`, `RescheduleModal.tsx`)

- CONFIRMED booking > 24 h away, no open request: button **"Request a new time"**
  opens the existing picker (`fetchSlots`). Success text: *"Request sent. Your
  current time stays booked until the salon confirms."*
- Open request: banner *"You asked to move this to {date} {time} — waiting for the
  salon."* with **Change requested time** (re-opens the picker → replace) and
  **Withdraw request**.
- Expired (derived, not yet cleaned): *"Your request to move to {date} {time}
  expired. Your original time stands."* No request actions until cleared; a new
  request is allowed if the original is still > 24 h away (it overwrites).
- Cancel works as today.
- All strings in `src/i18n/messages/{en,zh}/appointments.ts`.

### `requestReschedule(appointmentId, dateStr, time)` — replaces `rescheduleAppointment`

Order matters: cheap refusals before DB work, rate limits after every refusal.

1. `isBookingEnabled()` → else `MAINTENANCE`.
2. `verifySession()`; `isValidSalonDate`/`isValidSalonTime` → `INVALID_DATE_TIME`.
3. Load appointment (narrow select); owner check → `APPOINTMENT_NOT_FOUND`.
4. `status === 'CONFIRMED'` → else `RESCHEDULE_ONLY_CONFIRMED`.
5. Original > 24 h away → else `RESCHEDULE_TOO_LATE`.
6. Resolve salon time → UTC; NaN → `INVALID_DATE_TIME`; ≤ now → `RESCHEDULE_PAST`.
7. **Requested time > 24 h away** → else new code `RESCHEDULE_REQUEST_TOO_SOON`.
8. Requested == current `date`, or == open `rescheduleRequestedDate` → `{ success: true }`,
   no write, no email.
9. `checkStylistHours` for the new date; patch-test re-check against the new date.
10. Rate limits: existing `rescheduleLimiter` (per user) and
    `appointmentRescheduleLimiter` (per appointment) → `TOO_MANY_RESCHEDULES`.
11. Serializable transaction:
    - `assertOnlineBookingReady(tx)`;
    - `assertAppointmentSlotAvailable(tx, appointment, newDate)` — refuses a slot
      that is already taken; it is **not** held afterwards;
    - conditional write of both fields (§4);
    - enqueue `RESCHEDULE_REQUEST_RECEIVED` and `SALON_RESCHEDULE_ALERT`;
    - audit (`…_REQUESTED` or `…_REPLACED`).
12. After commit: `after(dispatchAppointmentNotifications)`, revalidate
    `/appointments` and `/admin` in all locales. No `invalidateStylistIcalFeed()`
    (outbound feed unchanged).

### `withdrawRescheduleRequest(appointmentId)`

Session; owner; open request (else `RESCHEDULE_REQUEST_CHANGED`); conditional
clear in a Serializable transaction; audit `…_WITHDRAWN`; revalidate. No email,
no rate limit, **not** gated by `isBookingEnabled` (withdrawing reduces work and
must work even while booking is closed).

### `cancelAppointment`

Additionally clears `rescheduleRequestedDate`/`At` in the same write. Its existing
CANCELLATION email is unchanged.

## 6. Staff flow

### UI

- `/admin` stats: new card **"Reschedule requests"** (count of open,
  non-expired requests), amber when > 0, next to "Awaiting approval".
- Below the pending list in `ScheduleCalendar`: one row per open request —
  *"{customer} · {service} · {stylist}: **{old} → {new}** (asked {relative})"* with
  **Approve** / **Decline**. Expired rows show "Expired", no Approve.
- Calendar grid: the original appointment gets a small "move requested" badge;
  `AppointmentDialog` shows the request with the same two buttons. No ghost block
  at the requested time.
- Data: `getAdminCalendarData` adds one query
  `appointment.findMany({ where: { status: 'CONFIRMED', rescheduleRequestedDate: { not: null } }, take: 50, orderBy: { rescheduleRequestedAt: 'asc' } })`
  with an explicit `select` (customer name/phone, service name, stylist name,
  `date`, both request fields).
- Strings in `src/i18n/messages/{en,zh}/adminSchedule.ts`.

### `decideRescheduleRequest(appointmentId, decision: 'APPROVE' | 'DECLINE', requestedAt: string)`

Admin only (`session.role === 'ADMIN'` → else `NOT_AUTHORISED`). Not gated by the
online-booking lock (consistent with all admin actions).

**APPROVE**

1. Outside the transaction: `refreshCalendarFeedsBeforeApproval(stylistId)`
   (see §8). Never throws.
2. Serializable transaction:
   - row is CONFIRMED and `rescheduleRequestedAt` equals `requestedAt` → else
     `RESCHEDULE_REQUEST_CHANGED`;
   - requested time > 24 h away → else `RESCHEDULE_REQUEST_EXPIRED`;
   - `checkCalendarBookingReadiness(tx)` → else `CALENDAR_SETUP_NEEDED`;
   - stylist hours and patch test for the requested date;
   - `assertAppointmentSlotAvailable(tx, current, requestedDate)` → on failure the
     admin sees new code `RESCHEDULE_SLOT_TAKEN` (*"That time is no longer free.
     Decline the request or call the customer."*); the request stays open;
   - conditional update: `date := requested`, clear both fields,
     `reminderSent: false`, Treatwell sync status as the old reschedule did,
     `notificationVersion: { increment: 1 }`;
   - enqueue existing `RESCHEDULE` (with `{ oldDate }`); audit `…_APPROVED`.
3. After commit: `invalidateStylistIcalFeed()` (Fresha must see the new time),
   dispatch notifications, revalidate.

**DECLINE**

Serializable transaction: same `requestedAt` check; conditional clear; enqueue
`RESCHEDULE_DECLINED`; audit `…_DECLINED`. No free-text reason.

## 7. Notifications

New `AppointmentEmailKind`s (`src/app/services/email-content.ts`), English and
Chinese copy in `src/i18n/messages/{en,zh}/emails.ts`, rendered with the existing
React Email layout:

| Kind | Recipient | Locale | Content |
|---|---|---|---|
| `RESCHEDULE_REQUEST_RECEIVED` | customer | `notificationLocale` | request received; original stays booked until confirmed |
| `SALON_RESCHEDULE_ALERT` | `getSalonNotifyAddress()` | salon locale | customer, phone, service, stylist, old → new, link to `/admin` |
| `RESCHEDULE_DECLINED` | customer | `notificationLocale` | could not move; original {date} stands; phone number |
| `RESCHEDULE_LAPSED` | customer | `notificationLocale` | could not confirm in time; original stands |

Approval reuses `RESCHEDULE`. Withdraw sends nothing.

**Payload / event key.** Request-kind payloads carry `requestedDate` and
`requestedAt` (ISO). Event keys include `requestedAt`, so a replacement creates new
keys; Resend's `Idempotency-Key = eventKey` still prevents duplicates.
`email-service.ts` routes `SALON_RESCHEDULE_ALERT` to the salon address like
`SALON_ALERT`. Placeholder (walk-in) customer emails are skipped as today.

**`isCurrent` rules** (`notification-outbox-service.ts`), in addition to the
existing version/date check:

| Kind | Sends only if |
|---|---|
| `RESCHEDULE_REQUEST_RECEIVED`, `SALON_RESCHEDULE_ALERT` | status CONFIRMED, `rescheduleRequestedAt` == payload `requestedAt`, requested time > now |
| `RESCHEDULE_DECLINED`, `RESCHEDULE_LAPSED` | status CONFIRMED, `rescheduleRequestedAt` != payload `requestedAt` (that request is closed), appointment `date` > now |

## 8. Fresha refresh before approval (D6)

*Amended 2026-10-09 (final review).* The first version of this section
replaced the all-stylist refresh with a target-stylist-only one. That broke
approvals outside staff hours: `checkCalendarBookingReadiness` requires
**every** active receiving stylist's feed to have succeeded within 90 minutes,
and the scheduled import pauses outside staff hours, so any evening Confirm or
Approve failed `CALENDAR_SETUP_NEEDED` once another stylist's feed went stale.

One helper in `calendar-sync-service.ts`, the only one both approval paths call:

```ts
refreshCalendarFeedsBeforeApproval(stylistId: string, opts?: { now?: Date; db?; fetchFeed? })
```

It checks `CALENDAR_SYNC_ENABLED` before any database read, never throws, and
returns the concatenated results of:

1. `syncCalendarFeeds({ stylistId, staleBefore: now - APPROVAL_REFRESH_MINUTES })`
   (5 minutes) — the approved stylist's recent Fresha sales;
2. `syncCalendarFeeds({ staleBefore: now - CALENDAR_POLL_MINUTES })` (30 minutes,
   all stylists) — the old `refreshStaleCalendarFeeds` predicate (never
   succeeded, older than the cutoff, or last attempt failed), which keeps the
   all-stylist freshness gate passable.

`syncCalendarFeeds` gains an optional `stylistId` filter. Callers:

- `decideRescheduleRequest` APPROVE;
- `updateAppointmentStatus(…, 'CONFIRMED')` for new PENDING bookings.

Cost: one Fresha fetch for the approved stylist when its feed is over 5 minutes
old, plus one per other feed only when that feed is over 30 minutes old (in
staff hours the half-hourly import keeps them fresher than that). Each fetch has
an 8 s timeout; the admin's request already wakes Neon, so no extra wake.

## 9. Automatic lapse

In `runNotificationCron` (`notification-cron-service.ts`), after its existing
lock is claimed and before dispatch:

```ts
const due = await db.appointment.findMany({
  where: { status: 'CONFIRMED', OR: [
    { rescheduleRequestedDate: { lt: addHours(now, 24) } },
    { date: { lt: now }, rescheduleRequestedDate: { not: null } }, // amended 2026-10-09
  ] },
  select: { id: true, date: true, updatedAt: true, rescheduleRequestedDate: true, rescheduleRequestedAt: true },
  take: 50,
});
```

Inside each transaction the row is re-read with the same narrow `include` the
cancel/reschedule paths pass to `enqueueAppointmentNotification` (user
email/name/phone, stylist name, service id/name/price/duration) before enqueueing.

For each: Serializable transaction → conditional clear (§4) → enqueue
`RESCHEDULE_LAPSED` → audit `…_LAPSED`. *(Amended 2026-10-09.)* A request whose
original `date` has already passed is cleared and audited the same way, but no
`RESCHEDULE_LAPSED` is queued (there is no point emailing about a visit that
already happened). Re-running is a no-op (the conditional
clear finds nothing). The route's `NOTIFICATIONS_ENABLED` kill-switch stays above
the first DB call. No new cron and no extra Neon wake (same tick).

Known limit: the notifications cron runs `*/30 8-19` UTC, so a request that
lapses overnight gets its email the next morning; the site and admin already
treat it as expired at the 24 h mark.

## 10. Errors and copy

New `booking` codes in `src/i18n/messages/{en,zh}/errors.ts`:
`RESCHEDULE_REQUEST_TOO_SOON`, `RESCHEDULE_REQUEST_CHANGED`,
`RESCHEDULE_REQUEST_EXPIRED`, `RESCHEDULE_SLOT_TAKEN`.

Fix the three misleading comments (`rate-limit.ts:152`, `booking.ts:577`,
`booking.ts:607`) to describe the request flow.

## 11. Testing (TDD — each test written and seen failing first)

Unit (`node:test`, fakes honour `where.dayOfWeek` and patch-test rules, and assert
reads happen inside the transaction):

- `requestReschedule`: every refusal code in §5 order; both no-op cases send no
  email and spend no rate limit; refused attempts spend no rate limit; replace
  overwrites and enqueues new keys; slot already taken → `SLOT_UNAVAILABLE`;
  stylist day off → `STYLIST_OFF_THAT_DAY`; patch test too soon on the new date →
  `PATCH_TEST_TOO_SOON`.
- `withdrawRescheduleRequest`: owner only; clears; no email; works while booking
  is closed.
- `cancelAppointment` clears an open request.
- `decideRescheduleRequest`: approve happy path (date moved, fields cleared,
  version bumped, `RESCHEDULE` queued, feed invalidated); slot taken → request
  stays open + `RESCHEDULE_SLOT_TAKEN`; stale `requestedAt` →
  `RESCHEDULE_REQUEST_CHANGED`; expired → `RESCHEDULE_REQUEST_EXPIRED`; decline →
  date unchanged, `RESCHEDULE_DECLINED` queued; non-admin refused.
- `refreshCalendarFeedsBeforeApproval`: that stylist's connections at 5 minutes,
  then every stylist's at 30; kill-switch; never throws. Both approval paths use it.
- `isCurrent`: table-driven over the four new kinds × (open, replaced, withdrawn,
  approved, cancelled).
- Lapse: only < 24 h requests; idempotent on re-run; kill-switch before any DB call.
- Email copy: en + zh snapshots of subject/greeting/key lines for the four kinds.
- `use-server-exports.test.ts` still passes (new actions are async exports).

Real PostgreSQL (`scripts/verify-booking-lifecycle.ts`, CI):

- request → withdraw;
- request → Fresha import now covers the requested slot → approve refused →
  decline (original intact);
- request → approve → `date` moved, outbound ICS moved;
- concurrent approve vs withdraw → exactly one succeeds.

## 12. Migration and rollout

- Migrations: one per schema folder (`prisma/vercel/migrations`,
  `prisma/dev/migrations`, `prisma/prod/migrations`); CI replays Postgres and
  SQLite and checks drift.
- Production: applied by `vercel-build` (`prisma migrate deploy`) on deploy.
- **Preview DB** (`harbour-hair-preview-lhr`, real customer data): apply the same
  migration with `prisma migrate deploy` and the preview env, **with the owner's
  go-ahead**, or every PR's "Deploy Preview" fails.
- Ship as its own PR after #59 is merged (rebase this branch on main).
- Customer-invisible until online booking opens (Square lock); staff UI only
  appears when a request exists.
- Update `readme/structure.md` (new actions/helper) and CLAUDE.md "Key
  Conventions" (reschedule is a staff-approved request).

## 13. Out of scope

- Holding the requested slot; per-stylist booking closure; free-text decline
  reasons; reschedule-request history UI (audit log only).
- Staff direct moves in Admin (unchanged).
- The other 2026-10-08 review findings (W4–W6 tests, INFO batch).
