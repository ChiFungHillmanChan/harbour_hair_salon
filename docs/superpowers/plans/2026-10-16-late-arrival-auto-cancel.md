# Late-arrival auto-cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cancel a CONFIRMED booking automatically when its customer is 15+ minutes late and staff have not marked them arrived; deposit kept as a no-show; staff can restore within 24 h.

**Architecture:** Two nullable `Appointment` columns (`arrivedAt`, `lateCancelledAt`) and one `SiteSettings` switch (`lateAutoCancelSince`). A cron step (`services/late-arrival-cancel.ts`) rides the existing `*/30` calendar-sync route and closes each candidate in its own Serializable transaction, reusing `planDepositForClosing` (KEPT) and the notification outbox (new `LATE_CANCELLED` kind, delayed 30 min). Admin gets an arrivals panel, an Arrived toggle and Restore.

**Tech Stack:** Next.js 16 App Router (server actions), Prisma (PostgreSQL / SQLite / SQL Server schemas), node:test + tsx, Tailwind (monochrome), en + zh-HK messages.

**Spec:** `docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md`

## Global Constraints

- Every schema change goes into all three of `prisma/{vercel,dev,prod}/schema.prisma`, each with its own migration folder named `20261016120000_late_arrival_auto_cancel`.
- `LATE_ARRIVAL_CANCEL_MINUTES = 15`, `LATE_ARRIVAL_LOOKBACK_MINUTES = 120`, `LATE_CANCEL_EMAIL_DELAY_MINUTES = 30`, `LATE_CANCEL_RESTORE_HOURS = 24`, `ARRIVAL_EARLY_MINUTES = 60` — all in `src/app/lib/booking-constants.ts`.
- Only `CONFIRMED` bookings are ever auto-cancelled; never PENDING, arrived, COMPLETED.
- Square is never called inside a transaction; a taken deposit becomes `KEPT` (no Square call).
- Kill-switches stay above the first DB read; the late-arrival step runs inside the calendar-sync route AFTER its `CALENDAR_SYNC_ENABLED` and staff-hours gates.
- Every UI string in both `src/i18n/messages/en` and `zh` (`completeness.test.ts`). Monochrome only (`brand-monochrome.test.ts`): zinc/black/white, no blue/gold.
- Every fixed `lastError` string is catalogued in `services/operations-messages.ts` (test-enforced).
- Never use `[locale]` folders for tests (they never run): page tests live in `src/test/pages/`.
- Commit messages: never write a bracketed skip-ci marker. End each with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx`.
- Feature ships OFF (`lateAutoCancelSince = null`).

## Review Focus

1. A staff "Arrived" tap racing the cron tick → the tap must win (conditional update `arrivedAt: null`), booking stays CONFIRMED. (Task 4 test "concurrent arrival wins".)
2. Switching the setting on must never cancel old, never-marked bookings → `date > lateAutoCancelSince`. (Task 4 test "bookings before the switch-on are never touched".)
3. A capture in flight (`CAPTURING`/`CAPTURE_UNKNOWN`) → skipped this tick, retried, never cancelled half-way. (Task 4 test.)
4. Restore after the deposit was refunded or changed → refused (`LATE_CANCEL_NOT_RESTORABLE`). (Task 6 test.)
5. Notifications held while `NOTIFICATIONS_ENABLED=false` and released days later → a `LATE_CANCELLED` mail older than 24 h after the start is dropped. (Task 3 test.)

---

### Task 1: Schema, migrations and constants

**Files:**
- Modify: `prisma/vercel/schema.prisma`, `prisma/dev/schema.prisma`, `prisma/prod/schema.prisma` (model `Appointment`, model `SiteSettings`)
- Create: `prisma/vercel/migrations/20261016120000_late_arrival_auto_cancel/migration.sql`, same under `prisma/dev/migrations/` and `prisma/prod/migrations/`
- Modify: `src/app/lib/booking-constants.ts`
- Test: `src/app/lib/late-arrival-schema.test.ts` (new)

**Interfaces:**
- Produces: Prisma fields `Appointment.arrivedAt: Date | null`, `Appointment.lateCancelledAt: Date | null`, `SiteSettings.lateAutoCancelSince: Date | null`; constants listed in Global Constraints.

- [ ] **Step 1: Write the failing test** — `src/app/lib/late-arrival-schema.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const PROVIDERS = ['vercel', 'dev', 'prod'] as const;
const block = (schema: string, model: string) => {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${model} missing`);
  return match[0];
};

for (const provider of PROVIDERS) {
  test(`${provider} schema has the late-arrival columns, all nullable`, () => {
    const schema = readFileSync(`prisma/${provider}/schema.prisma`, 'utf8');
    assert.match(block(schema, 'Appointment'), /\n\s+arrivedAt\s+DateTime\?/);
    assert.match(block(schema, 'Appointment'), /\n\s+lateCancelledAt\s+DateTime\?/);
    assert.match(block(schema, 'SiteSettings'), /\n\s+lateAutoCancelSince\s+DateTime\?/);
  });
  test(`${provider} has the late-arrival migration`, () => {
    const file = `prisma/${provider}/migrations/20261016120000_late_arrival_auto_cancel/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    for (const column of ['arrivedAt', 'lateCancelledAt', 'lateAutoCancelSince']) assert.match(sql, new RegExp(column));
  });
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import tsx --test src/app/lib/late-arrival-schema.test.ts`
Expected: FAIL (columns and migrations missing).

- [ ] **Step 3: Edit all three schemas.** In `model Appointment`, right after `rescheduleRequestedAt   DateTime?`:

```prisma
  /// When staff recorded the customer as arrived. Null = not (yet) arrived.
  /// A CONFIRMED booking still null 15 minutes after its start is cancelled by
  /// the late-arrival rule while it is switched on (services/late-arrival-cancel.ts).
  arrivedAt           DateTime?
  /// Set when the late-arrival rule cancelled this booking; cleared on restore.
  lateCancelledAt     DateTime?
```

In `model SiteSettings`, after `depositMinimumServicePence`:

```prisma
  /// Late-arrival auto-cancel: null = off. Otherwise only bookings that START
  /// after this instant are ever cancelled, so switching it on never reaches
  /// back to old bookings nobody marked arrived.
  lateAutoCancelSince        DateTime?
```

- [ ] **Step 4: Generate each migration with Prisma's differ** (exact SQL per provider; no hand-written DDL). For each provider `P` in vercel/dev/prod, from the repo root:

```bash
git show HEAD:prisma/P/schema.prisma > /tmp/late-arrival-old-P.prisma   # use the scratchpad dir instead of /tmp
mkdir -p prisma/P/migrations/20261016120000_late_arrival_auto_cancel
pnpm exec prisma migrate diff --from-schema-datamodel <scratch>/late-arrival-old-P.prisma \
  --to-schema-datamodel prisma/P/schema.prisma --script \
  > prisma/P/migrations/20261016120000_late_arrival_auto_cancel/migration.sql
```

Expected content (vercel/PostgreSQL):

```sql
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "lateCancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "lateAutoCancelSince" TIMESTAMP(3);
```

For `prod` (SQL Server), wrap the generated statements in the same `BEGIN TRY BEGIN TRAN; … COMMIT TRAN; END TRY BEGIN CATCH IF @@TRANCOUNT > 0 BEGIN ROLLBACK TRAN; END; THROW END CATCH` frame as `prisma/prod/migrations/20261009120000_reschedule_requests/migration.sql`. For `dev` (SQLite) the differ emits `ALTER TABLE … ADD COLUMN … DATETIME;` per column.

- [ ] **Step 5: Constants** — append to `src/app/lib/booking-constants.ts`:

```ts
/**
 * Late arrivals (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md).
 * A CONFIRMED booking whose customer is not marked arrived this many minutes
 * after its start is cancelled by the calendar-sync cron while Admin →
 * Settings has the rule switched on. The booking terms and emails read it.
 */
export const LATE_ARRIVAL_CANCEL_MINUTES = 15;
/** Bookings that started longer ago than this are left for staff, never cancelled late (a missed cron tick). */
export const LATE_ARRIVAL_LOOKBACK_MINUTES = 120;
/** The late-cancel email waits this long, so a restore made meanwhile drops it unsent. */
export const LATE_CANCEL_EMAIL_DELAY_MINUTES = 30;
/** How long after the automatic cancellation staff may restore the booking. */
export const LATE_CANCEL_RESTORE_HOURS = 24;
/** "Arrived" can be recorded from this many minutes before the start. */
export const ARRIVAL_EARLY_MINUTES = 60;
```

- [ ] **Step 6: Regenerate the client and run the test**

Run: `pnpm db:vercel:generate && node --import tsx --test src/app/lib/late-arrival-schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma src/app/lib/booking-constants.ts src/app/lib/late-arrival-schema.test.ts
git commit -m "feat(late-arrival): schema, migrations and constants"
```

---

### Task 2: Pure late-arrival rules

**Files:**
- Create: `src/app/lib/late-arrival.ts` (client-safe, no imports beyond constants)
- Test: `src/app/lib/late-arrival.test.ts`

**Interfaces:**
- Consumes: constants from Task 1.
- Produces:
  - `lateCancelDueAt(start: Date | string): Date`
  - `isArrivalWindowOpen(start: Date | string, durationMin: number, now?: Date): boolean`
  - `isLateCancelCandidate(row: { status: string; arrivedAt: Date | string | null; date: Date | string }, since: Date | null, now?: Date): boolean`
  - `isLateCancelRestorable(lateCancelledAt: Date | string | null, now?: Date): boolean`
  - `lateCancelWindow(now: Date, since: Date): { gt: Date; gte: Date; lte: Date }` (Prisma `date` filter bounds: `gt` = since, `gte` = now − lookback, `lte` = now − 15 min)

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { isArrivalWindowOpen, isLateCancelCandidate, isLateCancelRestorable, lateCancelDueAt, lateCancelWindow } from './late-arrival';

const START = new Date('2099-09-01T10:00:00Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const SINCE = new Date('2099-08-01T00:00:00Z');
const row = (over: Partial<{ status: string; arrivedAt: Date | null; date: Date }> = {}) => ({ status: 'CONFIRMED', arrivedAt: null, date: START, ...over });

test('due 15 minutes after the start', () => {
  assert.equal(lateCancelDueAt(START).toISOString(), at(15).toISOString());
});

test('candidate only from minute 15 to minute 120, CONFIRMED, not arrived, after switch-on', () => {
  assert.equal(isLateCancelCandidate(row(), SINCE, at(14)), false);
  assert.equal(isLateCancelCandidate(row(), SINCE, at(15)), true);
  assert.equal(isLateCancelCandidate(row(), SINCE, at(120)), true);
  assert.equal(isLateCancelCandidate(row(), SINCE, at(121)), false);
  assert.equal(isLateCancelCandidate(row({ status: 'PENDING' }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row({ status: 'COMPLETED' }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row({ arrivedAt: at(5) }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row(), null, at(30)), false, 'switched off');
  assert.equal(isLateCancelCandidate(row(), at(1), at(30)), false, 'started before switch-on');
  assert.equal(isLateCancelCandidate(row(), START, at(30)), false, 'start equal to switch-on is not after it');
});

test('arrival window: 60 minutes before the start to the later of end and start+120', () => {
  assert.equal(isArrivalWindowOpen(START, 30, at(-61)), false);
  assert.equal(isArrivalWindowOpen(START, 30, at(-60)), true);
  assert.equal(isArrivalWindowOpen(START, 15, at(100)), true, 'short service: lookback keeps it open');
  assert.equal(isArrivalWindowOpen(START, 15, at(121)), false);
  assert.equal(isArrivalWindowOpen(START, 180, at(170)), true, 'long service: open until its end');
  assert.equal(isArrivalWindowOpen(START, 180, at(181)), false);
});

test('restorable for 24 hours after the automatic cancellation', () => {
  assert.equal(isLateCancelRestorable(null, at(30)), false);
  assert.equal(isLateCancelRestorable(at(30), at(30 + 24 * 60)), true);
  assert.equal(isLateCancelRestorable(at(30), at(30 + 24 * 60 + 1)), false);
});

test('query window bounds', () => {
  const now = at(30);
  assert.deepEqual(lateCancelWindow(now, SINCE), { gt: SINCE, gte: at(-90), lte: at(15) });
});
```

- [ ] **Step 2: Run** `node --import tsx --test src/app/lib/late-arrival.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/app/lib/late-arrival.ts`

```ts
// Pure and client-safe: the cron, the admin actions and the arrivals panel all
// decide "is this booking late enough to cancel?" the same way
// (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md).
import {
  ARRIVAL_EARLY_MINUTES, LATE_ARRIVAL_CANCEL_MINUTES, LATE_ARRIVAL_LOOKBACK_MINUTES, LATE_CANCEL_RESTORE_HOURS,
} from './booking-constants';

const MINUTE = 60_000;
const ms = (value: Date | string) => new Date(value).getTime();

/** When the rule cancels a booking nobody marked arrived. */
export function lateCancelDueAt(start: Date | string): Date {
  return new Date(ms(start) + LATE_ARRIVAL_CANCEL_MINUTES * MINUTE);
}

/** Staff may record (or clear) an arrival from an hour before the start until the later of its end and the lookback. */
export function isArrivalWindowOpen(start: Date | string, durationMin: number, now: Date = new Date()): boolean {
  const opens = ms(start) - ARRIVAL_EARLY_MINUTES * MINUTE;
  const closes = ms(start) + Math.max(durationMin, LATE_ARRIVAL_LOOKBACK_MINUTES) * MINUTE;
  return now.getTime() >= opens && now.getTime() <= closes;
}

/** Prisma `date` bounds for the cron's candidate query. */
export function lateCancelWindow(now: Date, since: Date): { gt: Date; gte: Date; lte: Date } {
  return {
    gt: since,
    gte: new Date(now.getTime() - LATE_ARRIVAL_LOOKBACK_MINUTES * MINUTE),
    lte: new Date(now.getTime() - LATE_ARRIVAL_CANCEL_MINUTES * MINUTE),
  };
}

export function isLateCancelCandidate(
  row: { status: string; arrivedAt: Date | string | null; date: Date | string },
  since: Date | null,
  now: Date = new Date(),
): boolean {
  if (!since || row.status !== 'CONFIRMED' || row.arrivedAt) return false;
  const window = lateCancelWindow(now, since);
  const start = ms(row.date);
  return start > window.gt.getTime() && start >= window.gte.getTime() && start <= window.lte.getTime();
}

export function isLateCancelRestorable(lateCancelledAt: Date | string | null, now: Date = new Date()): boolean {
  if (!lateCancelledAt) return false;
  return now.getTime() - ms(lateCancelledAt) <= LATE_CANCEL_RESTORE_HOURS * 60 * MINUTE;
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/app/lib/late-arrival.ts src/app/lib/late-arrival.test.ts && git commit -m "feat(late-arrival): pure timing rules"`

---

### Task 3: `LATE_CANCELLED` customer email

**Files:**
- Modify: `src/app/services/email-content.ts` (kind union ~L64; `calendarMethodFor` ~L198; new `case 'LATE_CANCELLED'` next to `CANCELLATION` ~L317)
- Modify: `src/app/services/notification-outbox-service.ts` (`enqueueAppointmentNotification` ~L111: new `notBefore` option; `isCurrent` ~L158)
- Modify: `src/i18n/messages/en/emails.ts`, `src/i18n/messages/zh/emails.ts` (new `lateCancelled` section after `cancellation`)
- Modify: `src/i18n/messages/en/adminOps.ts`, `zh/adminOps.ts` (`operations.deliveries.kind.LATE_CANCELLED`)
- Test: `src/app/services/email-content.test.ts`, `src/app/services/notification-outbox-service.test.ts`

**Interfaces:**
- Consumes: `LATE_ARRIVAL_CANCEL_MINUTES`.
- Produces: `AppointmentEmailKind` gains `'LATE_CANCELLED'`; `enqueueAppointmentNotification(db, kind, appointment, options & { notBefore?: Date })` writes `nextAttemptAt: notBefore` on create; `isCurrent` handles `LATE_CANCELLED`.

- [ ] **Step 1: Failing tests.** In `email-content.test.ts` add (reuse the file's existing appointment fixture helper — read the top of the file for its name; the CANCELLATION tests show the pattern):

```ts
test('LATE_CANCELLED says why, keeps the deposit wording, and removes the calendar entry', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const content = appointmentEmailContent('LATE_CANCELLED', /* fixture with a £15 deposit */ appointmentWithDeposit(), locale, { depositOutcome: 'KEPT' });
    assert.ok(content.intro.includes('15'), 'names the 15 minutes');
    assert.ok(content.footnotes.some((line) => line.includes('£15.00')), 'deposit kept sentence');
    assert.equal(calendarMethodFor('LATE_CANCELLED'), 'CANCEL');
  }
});
```

Also add `'LATE_CANCELLED'` to the list at `email-content.test.ts:259` (kinds WITH a calendar file).

In `notification-outbox-service.test.ts` add (follow the file's fake-db pattern):

```ts
test('LATE_CANCELLED waits for notBefore and is dropped once restored or stale', async () => {
  // 1. enqueue with notBefore = now + 30 min → the created row's nextAttemptAt equals notBefore.
  // 2. isCurrent (via dispatchPendingNotifications at now + 31 min):
  //    status CANCELLED + lateCancelledAt set + same version → sent;
  //    status CONFIRMED (restored, version bumped) → skipped;
  //    appointment date more than 24 h before "now" → skipped.
});
```

Write those three cases concretely with the file's existing helpers (`fakeDb`/`queue` — check its first 80 lines).

- [ ] **Step 2: Run** `pnpm test 2>&1 | tail -30` → the new tests FAIL.

- [ ] **Step 3: Implement.**

`email-content.ts`:

```ts
export type AppointmentEmailKind = 'REQUEST_RECEIVED' | 'SALON_ALERT' | 'CONFIRMATION' | 'CANCELLATION' | 'RESCHEDULE' | 'REMINDER' | 'REVIEW_REQUEST'
  | 'RESCHEDULE_REQUEST_RECEIVED' | 'SALON_RESCHEDULE_ALERT' | 'RESCHEDULE_DECLINED' | 'RESCHEDULE_LAPSED' | 'REQUEST_LAPSED'
  | 'LATE_CANCELLED';
```

In `calendarMethodFor`, `case 'LATE_CANCELLED': return 'CANCEL';` (it was always a confirmed booking). Add the content case right after `CANCELLATION`:

```ts
    case 'LATE_CANCELLED': {
      // The late-arrival rule cancelled a confirmed booking whose customer had
      // not arrived 15 minutes after the start (services/late-arrival-cancel.ts).
      const deposit = depositClosingNote(appointment, locale, options.depositOutcome);
      return {
        ...base,
        subject: t('lateCancelled.subject'),
        preview: t('lateCancelled.preview', { service, date }),
        eyebrow: t('lateCancelled.eyebrow'), title: t('lateCancelled.title'),
        intro: t('lateCancelled.intro', { date, time, minutes: LATE_ARRIVAL_CANCEL_MINUTES }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('date', date), labels('time', time), ...(deposit ? [deposit.row] : [])],
        callout: options.salonPhone ? { title: t('lateCancelled.calloutTitle'), body: t('lateCancelled.calloutBody', { phone: options.salonPhone }) } : undefined,
        cta: { label: t('lateCancelled.cta'), href: url(locale, '/book') },
        footnotes: [...(deposit ? [deposit.sentence] : []), t('calendar.cancelled'), t('lateCancelled.footnote')],
      };
    }
```

Import `LATE_ARRIVAL_CANCEL_MINUTES` from `@/app/lib/booking-constants`.

Messages — `en/emails.ts`, after `cancellation`:

```ts
  /** The late-arrival rule cancelled a confirmed booking. {minutes}: LATE_ARRIVAL_CANCEL_MINUTES. */
  lateCancelled: {
    subject: 'Your appointment was cancelled — Harbour Hair Salon',
    preview: 'Your appointment for {service} on {date} was cancelled',
    eyebrow: 'Appointment cancelled',
    title: 'We had to cancel your appointment.',
    intro: 'You hadn’t arrived {minutes} minutes after your appointment on {date} at {time}, so we cancelled it and gave the time to another client, as our booking terms say.',
    calloutTitle: 'Want to book again?',
    calloutBody: 'Call us on {phone} and we’ll find you another time.',
    cta: 'Book another time',
    footnote: 'If you think this is a mistake, please call the salon.',
  },
```

`zh/emails.ts` (same keys):

```ts
  lateCancelled: {
    subject: '你的預約已取消 — Harbour Hair Salon',
    preview: '你於 {date} 的 {service} 預約已取消',
    eyebrow: '預約已取消',
    title: '我們已取消你的預約。',
    intro: '你於 {date} {time} 的預約開始 {minutes} 分鐘後仍未到達，因此我們按預約條款取消了預約，並把時段讓給其他客人。',
    calloutTitle: '想重新預約？',
    calloutBody: '請致電 {phone}，我們會為你安排其他時間。',
    cta: '預約其他時間',
    footnote: '如你認為有誤，請致電髮廊。',
  },
```

`adminOps.ts` `operations.deliveries.kind`: en `LATE_CANCELLED: 'Late arrival — cancelled'`, zh `LATE_CANCELLED: '遲到取消'`.

`notification-outbox-service.ts`:
- signature: `options: AppointmentEmailOptions & { requestedAt?: Date; notBefore?: Date } = {}`
- create: `create: { eventKey, appointmentId: appointment.id, kind, payloadJson: JSON.stringify(payload), ...(options.notBefore ? { nextAttemptAt: options.notBefore } : {}) },`
- `isCurrent`: add `lateCancelledAt: true` to the select, then

```ts
    // Cancelled by the late-arrival rule and not restored; mail held back while
    // sending was switched off is dropped once it would arrive a day late.
    case 'LATE_CANCELLED': return current.status === 'CANCELLED' && current.lateCancelledAt !== null
      && now.getTime() - current.date.getTime() <= 24 * 3_600_000;
```

The cron passes `salonPhone` (read once per run, as `pending-request-lapse.ts` does with `readSalonPhoneForLapseNotice`); the existing whitelisted copy already carries `salonPhone` and `depositOutcome`.

- [ ] **Step 4: Run** `pnpm test 2>&1 | tail -15` → PASS (incl. `completeness.test.ts`).
- [ ] **Step 5: Commit** `git commit -am "feat(late-arrival): LATE_CANCELLED customer email (en/zh), delayed delivery"`

---

### Task 4: The cron step — `cancelLateArrivals`

**Files:**
- Create: `src/app/services/late-arrival-cancel.ts`
- Test: `src/app/services/late-arrival-cancel.test.ts`

**Interfaces:**
- Consumes: `lateCancelWindow`, constants (Tasks 1–2); `runSerializableWithRetry` (`./booking-service`); `planDepositForClosing`, `settleDepositAfterCommit`, `linkedDepositSelect` (`./deposit-lifecycle`); `enqueueAppointmentNotification` (`./notification-outbox-service`); `readSalonPhoneForLapseNotice` (`./request-lapse-notice`); `invalidateStylistIcalFeedFromCron` (`./stylist-ical-cache`); `changedTreatwellSyncStatus`, `getTreatwellApiConfiguration` (`./treatwell-api`); `appendAuditEvent` (`@/app/lib/audit`); `BookingError` (`./booking-errors`).
- Produces: `cancelLateArrivals(now: Date, options?: { limit?: number }): Promise<{ enabled: boolean; cancelled: number; skipped: number; failed: number }>`

- [ ] **Step 1: Write the failing test.** Copy the harness shape of `src/app/services/pending-request-lapse.test.ts:120-240` (in-memory `appointments`/`attempts` arrays, a `tx` object with `appointment.findMany/findUnique/updateMany`, `paymentAttempt`, `siteSettings.findUnique`, `auditEvent.create`; real `deposit-lifecycle` loaded with stubbed Square; a `runSerializableWithRetry` stub that snapshots and rolls back on throw; an `enqueueAppointmentNotification` stub recording `{ id, kind, version, depositOutcome, notBefore }`; `./stylist-ical-cache` stub counting `invalidateStylistIcalFeedFromCron` calls). Load the service with `loadServerModule('src/app/services/late-arrival-cancel.ts', { … })`. Tests (NOW = `2099-09-01T12:00:00Z`, `since` = `2099-08-01T00:00:00Z`):

```ts
test('switched off: reads only the settings row and cancels nothing', …)          // settings null → { enabled:false }, 0 appointment queries
test('cancels a CONFIRMED booking 15+ min late: KEPT deposit, delayed email, audit, feed', …)
  // booking date NOW-20min, CAPTURED £15 attempt → status CANCELLED, lateCancelledAt=NOW,
  // notificationVersion+1, attempt KEPT, enqueued LATE_CANCELLED with depositOutcome 'KEPT'
  // and notBefore = NOW+30min, audit APPOINTMENT.LATE_AUTO_CANCELLED actor null, 1 feed invalidation
test('14 minutes late, arrived, PENDING, COMPLETED, older than 120 min: untouched', …)
test('bookings that start before the switch-on are never touched', …)            // since = NOW-10min, date NOW-20min
test('a concurrent arrival wins', …)
  // hooks.onBeforeTransaction sets arrivedAt on the row → status stays CONFIRMED, cancelled 0, no email, no audit
test('a capture in flight is skipped and retried later', …)                       // attempt CAPTURING → skipped 1, row unchanged, attempt unchanged
test('one failing booking does not stop the rest', …)                              // enqueue throws for one id → failed 1, the other cancelled
test('no deposit: cancelled without deposit wording', …)                          // enqueued depositOutcome undefined
```

Write each with concrete rows and asserts in the same style as `pending-request-lapse.test.ts`.

- [ ] **Step 2: Run** `node --import tsx --test --conditions=react-server src/app/services/late-arrival-cancel.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/app/services/late-arrival-cancel.ts`

```ts
import 'server-only';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { lateCancelWindow } from '@/app/lib/late-arrival';
import { LATE_CANCEL_EMAIL_DELAY_MINUTES } from '@/app/lib/booking-constants';
import { runSerializableWithRetry } from './booking-service';
import { BookingError } from './booking-errors';
import { linkedDepositSelect, planDepositForClosing, settleDepositAfterCommit } from './deposit-lifecycle';
import { enqueueAppointmentNotification } from './notification-outbox-service';
import { readSalonPhoneForLapseNotice } from './request-lapse-notice';
import { invalidateStylistIcalFeedFromCron } from './stylist-ical-cache';
import { changedTreatwellSyncStatus, getTreatwellApiConfiguration } from './treatwell-api';

const lateInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true, treatwellExternalId: true } },
  service: { select: { id: true, name: true, price: true, duration: true, treatwellExternalId: true } },
  paymentAttempt: { select: linkedDepositSelect },
} as const;

/**
 * The late-arrival rule (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md),
 * run by the calendar-sync cron after its own gates: a CONFIRMED booking whose
 * customer staff have not marked arrived 15 minutes after its start is
 * cancelled, its taken deposit kept as for a no-show, the customer emailed 30
 * minutes later (a restore meanwhile drops the mail), and the stylist's busy
 * feed refreshed so Fresha can resell the chair. Each booking closes in its
 * own Serializable transaction behind a conditional write, so a staff
 * "Arrived" racing this run always wins.
 */
export async function cancelLateArrivals(
  now: Date,
  options: { limit?: number } = {},
): Promise<{ enabled: boolean; cancelled: number; skipped: number; failed: number }> {
  // The live row, never the day-cached settings: this closes bookings and keeps money.
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { lateAutoCancelSince: true } });
  const since = settings?.lateAutoCancelSince ?? null;
  if (!since) return { enabled: false, cancelled: 0, skipped: 0, failed: 0 };
  const window = lateCancelWindow(now, since);
  const due = await prisma.appointment.findMany({
    where: { status: 'CONFIRMED', arrivedAt: null, date: { gt: window.gt, gte: window.gte, lte: window.lte } },
    select: { id: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: options.limit ?? 50,
  });
  let cancelled = 0;
  let skipped = 0;
  let failed = 0;
  if (due.length === 0) return { enabled: true, cancelled, skipped, failed };
  const salonPhone = await readSalonPhoneForLapseNotice(prisma);
  const plans: Awaited<ReturnType<typeof planDepositForClosing>>[] = [];
  for (const { id } of due) {
    try {
      const done = await runSerializableWithRetry(async (tx) => {
        const current = await tx.appointment.findUnique({ where: { id }, include: lateInclude });
        if (!current || current.status !== 'CONFIRMED' || current.arrivedAt) return null;
        const api = getTreatwellApiConfiguration();
        const closed = await tx.appointment.updateMany({
          where: { id, status: 'CONFIRMED', arrivedAt: null, date: current.date },
          data: {
            status: 'CANCELLED',
            lateCancelledAt: now,
            notificationVersion: { increment: 1 },
            rescheduleRequestedDate: null,
            rescheduleRequestedAt: null,
            treatwellSyncStatus: changedTreatwellSyncStatus({
              apiReady: api.enabled && api.configured,
              treatwellBookingId: current.treatwellBookingId,
              stylistExternalId: current.stylist.treatwellExternalId,
              serviceExternalId: current.service.treatwellExternalId,
            }),
            treatwellSyncError: null,
          },
        });
        if (closed.count !== 1) return null;
        // A no-show keeps its deposit (owner policy 2026-10-16). A capture in
        // flight throws DEPOSIT_IN_PROGRESS: the whole closing rolls back and
        // the next run tries again.
        const money = await planDepositForClosing(tx, id, { closing: 'CANCEL', refund: false, reason: 'STAFF_CANCELLED', requestedById: null, now });
        const updated = await tx.appointment.findUnique({ where: { id }, include: lateInclude });
        if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
        const queued = await enqueueAppointmentNotification(tx, 'LATE_CANCELLED', { ...updated, paymentAttempt: money.paymentAttempt }, {
          salonPhone,
          ...(money.outcome ? { depositOutcome: money.outcome } : {}),
          notBefore: new Date(now.getTime() + LATE_CANCEL_EMAIL_DELAY_MINUTES * 60_000),
        });
        await appendAuditEvent({ actorUserId: null, action: 'APPOINTMENT.LATE_AUTO_CANCELLED', targetType: 'Appointment', targetId: id, metadata: {
          from: 'CONFIRMED', to: 'CANCELLED', start: current.date.toISOString(),
          minutesLate: Math.floor((now.getTime() - current.date.getTime()) / 60_000), notified: Boolean(queued),
          ...(money.outcome ? { deposit: money.outcome, depositPence: money.amountPence } : {}),
        } }, tx);
        return money;
      });
      if (done) { cancelled++; plans.push(done); } else skipped++;
    } catch (error) {
      if (error instanceof BookingError && error.code === 'DEPOSIT_IN_PROGRESS') { skipped++; continue; }
      console.error('Late-arrival cancellation failed:', { appointmentId: id, error: error instanceof Error ? error.name : 'unknown' });
      failed++;
    }
  }
  if (cancelled > 0) {
    try { invalidateStylistIcalFeedFromCron(); } catch (error) {
      console.error('Dropping the busy-feed cache after late cancellations failed:', error instanceof Error ? error.name : 'unknown');
    }
  }
  // KEPT needs no Square call; kept for symmetry with every other closing.
  for (const plan of plans) await settleDepositAfterCommit(prisma, plan);
  return { enabled: true, cancelled, skipped, failed };
}
```

Check `BookingError` exposes `.code` (read `services/booking-errors.ts:21-38`); if the property has another name, use it. Check `DepositPlan` fields `outcome`, `amountPence`, `paymentAttempt` (deposit-lifecycle.ts:198-209).

- [ ] **Step 4: Run** the test file → PASS. Then `pnpm test 2>&1 | tail -5`.
- [ ] **Step 5: Commit** `git commit -m "feat(late-arrival): cron step cancels CONFIRMED bookings 15+ min late"` (add both files).

---

### Task 5: Run it from the calendar-sync cron

**Files:**
- Modify: `src/app/api/cron/calendar-sync/route.ts`
- Modify: `src/app/services/operations-messages.ts` (+ `operations.messages.LATE_ARRIVAL_FAILED` in en/zh `adminOps.ts`)
- Test: `src/app/api/cron/calendar-sync/route.test.ts`

**Interfaces:**
- Consumes: `cancelLateArrivals` (Task 4).
- Produces: `BackgroundJobState` row `late-arrival-cancel`; route JSON gains `lateArrivals: { enabled, cancelled, skipped, failed } | { error: true }`.

- [ ] **Step 1: Failing tests** in `route.test.ts`:

```ts
test('runs the late-arrival step after the sync and records it', async () => {
  const { loadServerModule } = await import('../../../../test/load-server-module');
  const order: string[] = [];
  const jobs: Record<string, unknown>[] = [];
  const route = loadServerModule<{ GET: typeof GET }>('src/app/api/cron/calendar-sync/route.ts', {
    '@/app/services/calendar-sync-schedule': { isScheduledCalendarSyncOpen: async () => true },
    '@/app/lib/prisma': { backgroundJobState: {
      upsert: async ({ where }: { where: { name: string } }) => { jobs.push({ upsert: where.name }); return {}; },
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { jobs.push({ name: where.name, ...data }); },
    } },
    '@/app/services/calendar-sync-service': { syncCalendarFeeds: async () => { order.push('sync'); return []; } },
    '@/app/services/late-arrival-cancel': { cancelLateArrivals: async () => { order.push('late'); return { enabled: true, cancelled: 1, skipped: 0, failed: 0 }; } },
  });
  await withEnv({ CRON_SECRET: SECRET, CALENDAR_SYNC_ENABLED: 'true' }, async () => {
    const body = await (await route.GET(authedRequest())).json();
    assert.deepEqual(order, ['sync', 'late']);
    assert.equal(body.lateArrivals.cancelled, 1);
    assert.ok(jobs.some((job) => job.name === 'late-arrival-cancel' && job.lastSucceededAt instanceof Date));
  });
});

test('a failing late-arrival step never fails the sync response', async () => { /* cancelLateArrivals throws → status 200, job row lastError === OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED */ });
test('closed hours: neither the sync nor the late-arrival step runs', async () => { /* isScheduledCalendarSyncOpen false → 0 calls to either stub */ });
```

Add the `'@/app/services/late-arrival-cancel'` stub to the EXISTING enabled test (`an enabled failed sync persists…`) too, returning `{ enabled: false, cancelled: 0, skipped: 0, failed: 0 }`, and change its `writes[0]` lookup to the `calendar-sync` row if needed.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** In `operations-messages.ts` add the key (follow the file's existing shape):

```ts
  LATE_ARRIVAL_FAILED: 'The late-arrival check could not complete. Bookings were left as they were; it runs again with the next calendar sync.',
```

and the en/zh labels (`adminOps.operations.messages.LATE_ARRIVAL_FAILED`: zh `遲到檢查未能完成。預約保持不變，下次日曆同步會再檢查。`).

In `route.ts`, import `cancelLateArrivals` statically and `OPERATIONS_MESSAGES`; after the sync's `backgroundJobState.update` (inside the `try`, before `return`), add:

```ts
    const lateArrivals = await runLateArrivals(db);
    return NextResponse.json({ ok, results, lateArrivals }, { status: ok ? 200 : 502 });
```

and below `GET`:

```ts
/** Rides this cron (no extra Neon wake): its own job row, never fails the sync. */
async function runLateArrivals(db: Pick<PrismaClient, 'backgroundJobState'>) {
  const name = 'late-arrival-cancel';
  try {
    await db.backgroundJobState.upsert({ where: { name }, create: { name, lastStartedAt: new Date() }, update: { lastStartedAt: new Date() } });
    const result = await cancelLateArrivals(new Date());
    await db.backgroundJobState.update({ where: { name }, data: result.failed
      ? { lastFailedAt: new Date(), lastError: OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED, lastResultJson: JSON.stringify(result) }
      : { lastSucceededAt: new Date(), lastError: null, lastResultJson: JSON.stringify(result) } });
    return result;
  } catch (error) {
    console.error('Late-arrival step failed:', error instanceof Error ? error.name : 'unknown');
    try { await db.backgroundJobState.update({ where: { name }, data: { lastFailedAt: new Date(), lastError: OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED } }); } catch { /* DB down */ }
    return { error: true as const };
  }
}
```

Keep the `lastError` as a reference to `OPERATIONS_MESSAGES.LATE_ARRIVAL_FAILED` (the catalogue test scans literals; a reference is fine — check `operations-messages.test.ts` for how other code references keys).

- [ ] **Step 4: Run** `node --import tsx --test --conditions=react-server src/app/api/cron/calendar-sync/route.test.ts src/app/services/operations-messages.test.ts` → PASS; then `pnpm test 2>&1 | tail -5`.
- [ ] **Step 5: Commit** `git commit -am "feat(late-arrival): run the rule from the calendar-sync cron"`

---

### Task 6: Staff actions — Arrived, completed, walk-in, Restore

**Files:**
- Create: `src/app/actions/admin-arrivals.ts` (`'use server'`; async exports only)
- Modify: `src/app/actions/admin.ts` (COMPLETED branch data ~L592: set `arrivedAt` when null)
- Modify: `src/app/actions/admin-schedule.ts` (`createAppointmentByAdmin` create data ~L380: `arrivedAt`)
- Modify: `src/i18n/messages/en/errors.ts`, `zh/errors.ts` (`booking.ARRIVAL_WINDOW_CLOSED`, `booking.ONLY_CONFIRMED_ARRIVAL`, `booking.LATE_CANCEL_NOT_RESTORABLE`)
- Test: `src/app/actions/admin-arrivals.test.ts`, extend `src/app/actions/admin-appointment-status.test.ts` and `src/app/actions/admin-schedule.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers; `describeAdminMoveClashes` (`@/app/services/admin-move-clashes`, `MoveTarget = { appointmentId, stylistId, start, durationMin, userId, requiresPatchTest }`), `runSerializableWithRetry`, `invalidateStylistIcalFeed`, `appendAuditEvent`, `verifySession`, `getActionLocale`, `bookingErrorText`, `describeBookingError`.
- Produces:
  - `markArrived(appointmentId: string, arrived: boolean): Promise<{ success: true } | { success: false; error: string }>`
  - `restoreLateCancellation(appointmentId: string, options?: { force?: boolean }): Promise<{ success: true } | { success: false; error: string } | { success: false; clashes: MoveClash[] }>`

- [ ] **Step 1: Failing tests** (`admin-arrivals.test.ts`, fake db + stubs as in `admin-appointment-status.test.ts:22-87`, NOW `2099-09-01T12:00Z`):

```ts
test('non-admins are refused', …)                                         // NOT_AUTHORISED, no writes
test('marks a CONFIRMED booking arrived inside the window, audited', …)     // arrivedAt=NOW, audit APPOINTMENT.ARRIVED
test('clearing an arrival', …)                                             // arrivedAt=null, audit APPOINTMENT.ARRIVAL_CLEARED
test('outside the window or not CONFIRMED is refused', …)                  // date NOW+2h → ARRIVAL_WINDOW_CLOSED; PENDING → ONLY_CONFIRMED_ARRIVAL
test('restore within 24 h: CONFIRMED, arrived, KEPT→CAPTURED, version+1, audit', …)
test('restore refused after 24 h, without lateCancelledAt, or when the deposit is not KEPT', …) // LATE_CANCEL_NOT_RESTORABLE
test('restore with a clash returns the clashes unless forced', …)          // describeAdminMoveClashes stub returns 1 OVERLAP
test('the restored booking refreshes the busy feed', …)                    // invalidateStylistIcalFeed called once
```

In `admin-appointment-status.test.ts`: "marking completed records the arrival when it was missing" (updateMany data has `arrivedAt: NOW`), and "keeps an earlier arrival time" (no `arrivedAt` key when already set).
In `admin-schedule.test.ts`: "a walk-in whose start has passed is arrived on creation" (`arrivedAt` = now when `date <= now` and status CONFIRMED; absent for a future booking and for PENDING).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**

`errors.ts` (en, under `booking`):

```ts
    ARRIVAL_WINDOW_CLOSED: 'An arrival can be recorded from an hour before the appointment until it has finished.',
    ONLY_CONFIRMED_ARRIVAL: 'Only a confirmed booking can be marked as arrived.',
    LATE_CANCEL_NOT_RESTORABLE: 'This booking can no longer be restored. Create a new booking instead.',
```

zh:

```ts
    ARRIVAL_WINDOW_CLOSED: '只可以在預約開始前一小時至預約完結期間記錄到達。',
    ONLY_CONFIRMED_ARRIVAL: '只有已確認的預約可以標記為已到達。',
    LATE_CANCEL_NOT_RESTORABLE: '此預約已無法還原，請重新建立預約。',
```

`admin-arrivals.ts`:

```ts
'use server';

import prisma from '@/app/lib/prisma';
import { revalidatePath } from 'next/cache';
import { appendAuditEvent } from '@/app/lib/audit';
import { verifySession } from '@/app/lib/session';
import { isArrivalWindowOpen, isLateCancelRestorable } from '@/app/lib/late-arrival';
import { describeAdminMoveClashes, type MoveClash } from '@/app/services/admin-move-clashes';
import { runSerializableWithRetry } from '@/app/services/booking-service';
import { BookingError, bookingErrorText, describeBookingError } from '@/app/services/booking-errors';
import { invalidateStylistIcalFeed } from '@/app/services/stylist-ical-cache';
import { describeFault } from '@/app/lib/fault';
import { getActionLocale } from '@/i18n/request';
import { revalidateAllLocales } from '@/i18n/revalidate';

type Result = { success: true } | { success: false; error: string };

/** Staff record (or clear) that the customer is here: the late-arrival rule never cancels an arrived booking. */
export async function markArrived(appointmentId: string, arrived: boolean): Promise<Result> {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  try {
    const now = new Date();
    await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: { status: true, date: true, arrivedAt: true, durationAtBooking: true, service: { select: { duration: true } } },
      });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      if (current.status !== 'CONFIRMED') throw new BookingError('ONLY_CONFIRMED_ARRIVAL');
      if (!isArrivalWindowOpen(current.date, current.durationAtBooking ?? current.service.duration, now)) throw new BookingError('ARRIVAL_WINDOW_CLOSED');
      if (Boolean(current.arrivedAt) === arrived) return;
      const result = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'CONFIRMED', arrivedAt: current.arrivedAt },
        data: { arrivedAt: arrived ? now : null },
      });
      if (result.count !== 1) throw new BookingError('STALE');
      await appendAuditEvent({ actorUserId: session.userId, action: arrived ? 'APPOINTMENT.ARRIVED' : 'APPOINTMENT.ARRIVAL_CLEARED', targetType: 'Appointment', targetId: appointmentId }, tx);
    });
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Recording an arrival failed:', { appointmentId, ...describeFault(error) });
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/admin');
  return { success: true };
}

/**
 * Undo the late-arrival rule within 24 hours (usually: the customer is in the
 * chair and nobody tapped Arrived). The kept deposit counts towards the bill
 * again; the late-cancel email, if still waiting, is no longer current and is
 * dropped. A clash (Fresha may have resold the time) is reported unless forced.
 */
export async function restoreLateCancellation(
  appointmentId: string,
  options: { force?: boolean } = {},
): Promise<Result | { success: false; clashes: MoveClash[] }> {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  try {
    const now = new Date();
    const outcome = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          status: true, date: true, lateCancelledAt: true, stylistId: true, userId: true, durationAtBooking: true,
          service: { select: { duration: true } }, paymentAttempt: { select: { id: true, status: true } },
        },
      });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      const deposit = current.paymentAttempt;
      if (current.status !== 'CANCELLED' || !isLateCancelRestorable(current.lateCancelledAt, now) || (deposit && deposit.status !== 'KEPT')) {
        throw new BookingError('LATE_CANCEL_NOT_RESTORABLE');
      }
      const clashes = await describeAdminMoveClashes(tx, {
        appointmentId, stylistId: current.stylistId, start: current.date,
        durationMin: current.durationAtBooking ?? current.service.duration, userId: current.userId, requiresPatchTest: false,
      });
      if (clashes.length > 0 && !options.force) return { kind: 'clashes' as const, clashes };
      const restored = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'CANCELLED', lateCancelledAt: current.lateCancelledAt },
        data: { status: 'CONFIRMED', lateCancelledAt: null, arrivedAt: now, notificationVersion: { increment: 1 } },
      });
      if (restored.count !== 1) throw new BookingError('STALE');
      if (deposit) {
        const back = await tx.paymentAttempt.updateMany({ where: { id: deposit.id, status: 'KEPT' }, data: { status: 'CAPTURED' } });
        if (back.count !== 1) throw new BookingError('STALE');
      }
      await appendAuditEvent({ actorUserId: session.userId, action: 'APPOINTMENT.LATE_CANCEL_RESTORED', targetType: 'Appointment', targetId: appointmentId,
        metadata: { forced: Boolean(options.force && clashes.length), ...(deposit ? { deposit: 'CAPTURED' } : {}) } }, tx);
      return { kind: 'restored' as const };
    });
    if (outcome.kind === 'clashes') return { success: false, clashes: outcome.clashes };
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Restoring a late cancellation failed:', { appointmentId, ...describeFault(error) });
    return { success: false, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  invalidateStylistIcalFeed();
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  return { success: true };
}
```

`admin.ts` — in the plain-branch `data` object of `updateAppointmentStatus`:

```ts
          // Marking a visit completed means the customer came.
          ...(status === 'COMPLETED' && !current.arrivedAt ? { arrivedAt: now } : {}),
```

(`statusInclude` returns all scalar fields, so `current.arrivedAt` is available.)

`admin-schedule.ts` — in `createAppointmentByAdmin`'s `tx.appointment.create` data:

```ts
          // A walk-in entered once its start has come is here already: the
          // late-arrival rule must never cancel it.
          ...(status === 'CONFIRMED' && date.getTime() <= Date.now() ? { arrivedAt: new Date() } : {}),
```

- [ ] **Step 4: Run** the three test files → PASS; `pnpm test 2>&1 | tail -5`; `pnpm exec tsc --noEmit 2>&1 | grep -v colorMath | head`.
- [ ] **Step 5: Commit** `git commit -m "feat(late-arrival): Arrived, completed/walk-in arrival, and Restore actions"`

---

### Task 7: Admin → Settings switch

**Files:**
- Modify: `src/app/actions/admin-settings.ts` (schema ~L77, parse ~L99, upsert ~L158, audit ~L163)
- Modify: `src/app/services/site-settings-service.ts` (type ~L8-35, defaults ~L56, row type ~L78, `mapRow` ~L98)
- Modify: `src/components/admin/SiteSettingsForm.tsx` (new section after deposits ~L215)
- Modify: `src/i18n/messages/en/adminContent.ts`, `zh/adminContent.ts` (`settings.lateArrivals`)
- Test: `src/app/actions/admin-settings.test.ts` (extend; find the existing deposits test for the fake db)

**Interfaces:**
- Produces: `SiteSettings.lateAutoCancelSince: string | null` (ISO, for the form) on the mapped settings type; form field `lateAutoCancelEnabled` (checkbox).

- [ ] **Step 1: Failing tests:** saving with `lateAutoCancelEnabled=on` when the row has null sets `lateAutoCancelSince` to now; saving again keeps the earlier instant; saving without the box sets null; audit metadata includes `lateAutoCancel: true|false`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.**
  - Schema: `lateAutoCancelEnabled: z.boolean().default(false),` and parse `lateAutoCancelEnabled: formData.get('lateAutoCancelEnabled') === 'on',`.
  - In the transaction, before the upsert:

```ts
      const { lateAutoCancelEnabled, ...columns } = parsed.data;
      // Switching on records the instant: only bookings that start after it
      // are ever cancelled. Saving again keeps the original instant.
      const existing = await tx.siteSettings.findUnique({ where: { id: 'singleton' }, select: { lateAutoCancelSince: true } });
      const lateAutoCancelSince = lateAutoCancelEnabled ? existing?.lateAutoCancelSince ?? new Date() : null;
      await tx.siteSettings.upsert({
        where: { id: 'singleton' },
        update: { ...columns, lateAutoCancelSince },
        create: { id: 'singleton', ...columns, lateAutoCancelSince },
      });
```

    and add `lateAutoCancel: lateAutoCancelEnabled` to the audit metadata.
  - `site-settings-service.ts`: `lateAutoCancelSince: string | null;` on the type (doc: "ISO instant the late-arrival rule was switched on; null = off"), default `null`, row type `lateAutoCancelSince: Date | null`, mapRow `lateAutoCancelSince: row.lateAutoCancelSince?.toISOString() ?? null`.
  - Form section (same classes as the deposits section):

```tsx
      <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('settings.lateArrivals.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.lateArrivals.help', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</p>
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="lateAutoCancelEnabled" defaultChecked={settings.lateAutoCancelSince !== null}
            className="mt-1 h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-900" />
          <span>
            <span className="block text-sm font-medium text-zinc-900">{t('settings.lateArrivals.label', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</span>
            <span className="block text-xs text-zinc-500 mt-1">{t('settings.lateArrivals.explain')}</span>
          </span>
        </label>
      </section>
```

  - Messages en:

```ts
    lateArrivals: {
      title: 'Late arrivals',
      help: 'When this is on, a confirmed booking is cancelled automatically if the customer has not been marked Arrived {minutes} minutes after the start. The deposit is kept, as for a no-show, and the customer is emailed.',
      label: 'Cancel bookings automatically when the customer is {minutes}+ minutes late',
      explain: 'Before switching this on, make sure staff tap “Arrived” on the schedule when each customer comes in. Bookings that started before you switch it on are never cancelled. A cancelled booking can be restored for 24 hours from the schedule.',
    },
```

    zh:

```ts
    lateArrivals: {
      title: '遲到',
      help: '開啟後，已確認的預約如在開始 {minutes} 分鐘後仍未標記「已到達」，便會自動取消。訂金會按缺席處理不予退還，並會電郵通知客人。',
      label: '客人遲到 {minutes} 分鐘或以上時自動取消預約',
      explain: '開啟前，請確保員工在每位客人到達時於日程表按「已到達」。開啟前已開始的預約永遠不會被取消。已取消的預約可於 24 小時內在日程表還原。',
    },
```

- [ ] **Step 4: Run** → PASS (+ completeness).
- [ ] **Step 5: Commit** `git commit -am "feat(late-arrival): Admin → Settings switch (off by default)"`

---

### Task 8: Admin schedule — arrivals panel, dialog toggle, grid mark

**Files:**
- Create: `src/app/services/late-arrival-board.ts` (loader), `src/components/admin/LateArrivalPanel.tsx` (client component)
- Modify: `src/app/[locale]/admin/page.tsx` (load + render the panel above `ScheduleCalendar`)
- Modify: `src/app/services/admin-calendar-data.ts` (`calendarAppointmentSelect` + `serializeCalendarAppointment`: `arrivedAt`)
- Modify: `src/components/admin/AppointmentDialog.tsx` (`DialogTarget` edit: `arrivedAt?: string | null`, `durationMin` already there; toggle button in the footer)
- Modify: `src/components/admin/ScheduleCalendar.tsx` (`openEditor`: pass `arrivedAt`; grid mapping: `arrived: Boolean(appt.arrivedAt)`)
- Modify: `src/components/admin/ScheduleDayGrid.tsx`, `ScheduleWeekGrid.tsx` (`GridAppointment.arrived?: boolean`; show `t('arrivals.arrivedMark')` line)
- Modify: `src/i18n/messages/en/adminSchedule.ts`, `zh/adminSchedule.ts` (`arrivals` section)
- Test: `src/app/services/late-arrival-board.test.ts`

**Interfaces:**
- Consumes: `markArrived`, `restoreLateCancellation` (Task 6); `isArrivalWindowOpen`, `lateCancelDueAt` (Task 2).
- Produces: `getLateArrivalBoard(now?: Date): Promise<LateArrivalBoard>` where

```ts
export type LateArrivalBoard = {
  ruleOn: boolean;
  due: { id: string; date: string; customerName: string | null; stylistName: string; serviceName: string; cancelsAt: string | null }[];
  lateCancelled: { id: string; date: string; customerName: string | null; stylistName: string; serviceName: string; lateCancelledAt: string; customerEmailed: boolean }[];
};
```

- [ ] **Step 1: Failing loader test** (fake prisma via `loadServerModule`): rule off → `ruleOn:false`, `cancelsAt:null`; CONFIRMED not arrived starting NOW+30 → in `due`; NOW-200 → excluded; arrived → excluded; late-cancelled 3 h ago with a SENT `LATE_CANCELLED` delivery → `customerEmailed:true`; 25 h ago → excluded.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement the loader**

```ts
import 'server-only';
import prisma from '@/app/lib/prisma';
import { ARRIVAL_EARLY_MINUTES, LATE_ARRIVAL_LOOKBACK_MINUTES, LATE_CANCEL_RESTORE_HOURS } from '@/app/lib/booking-constants';
import { lateCancelDueAt } from '@/app/lib/late-arrival';

export type LateArrivalBoard = { /* as above */ };

/** Admin → Schedule's arrivals panel: who is due in (or late), and what the rule cancelled in the last day. */
export async function getLateArrivalBoard(now: Date = new Date()): Promise<LateArrivalBoard> {
  const minute = 60_000;
  const [settings, due, cancelled] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { lateAutoCancelSince: true } }),
    prisma.appointment.findMany({
      where: { status: 'CONFIRMED', arrivedAt: null, date: { gte: new Date(now.getTime() - LATE_ARRIVAL_LOOKBACK_MINUTES * minute), lte: new Date(now.getTime() + ARRIVAL_EARLY_MINUTES * minute) } },
      select: { id: true, date: true, user: { select: { name: true } }, stylist: { select: { name: true } }, service: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }], take: 50,
    }),
    prisma.appointment.findMany({
      where: { status: 'CANCELLED', lateCancelledAt: { gte: new Date(now.getTime() - LATE_CANCEL_RESTORE_HOURS * 60 * minute) } },
      select: { id: true, date: true, lateCancelledAt: true, user: { select: { name: true } }, stylist: { select: { name: true } }, service: { select: { name: true } },
        notifications: { where: { kind: 'LATE_CANCELLED', status: 'SENT' }, select: { id: true }, take: 1 } },
      orderBy: [{ lateCancelledAt: 'desc' }], take: 50,
    }),
  ]);
  const since = settings?.lateAutoCancelSince ?? null;
  return {
    ruleOn: Boolean(since),
    due: due.map((row) => ({
      id: row.id, date: row.date.toISOString(), customerName: row.user.name, stylistName: row.stylist.name, serviceName: row.service.name,
      // Only a booking the rule will actually reach shows a cancellation time.
      cancelsAt: since && row.date > since ? lateCancelDueAt(row.date).toISOString() : null,
    })),
    lateCancelled: cancelled.map((row) => ({
      id: row.id, date: row.date.toISOString(), customerName: row.user.name, stylistName: row.stylist.name, serviceName: row.service.name,
      lateCancelledAt: row.lateCancelledAt!.toISOString(), customerEmailed: row.notifications.length > 0,
    })),
  };
}
```

(Check the `NotificationDelivery` sent status literal in `notification-outbox-service.ts` — use the same string it writes on success.)

- [ ] **Step 4: Panel component** `src/components/admin/LateArrivalPanel.tsx` — `'use client'`; props `{ board: LateArrivalBoard }`; renders nothing when both lists are empty; otherwise a `section` (`rounded-lg border border-zinc-300 bg-white`) with:
  - heading `t('arrivals.title')`;
  - per `due` row: time (`formatSalonTime`), customer, stylist · service; when `cancelsAt` and its time has passed the start, `t('arrivals.cancelsAt', { time })` in bold; a button `t('arrivals.markArrived')` calling `markArrived(id, true)` then `router.refresh()`; errors via the page's existing `alert(res.error)` pattern;
  - per `lateCancelled` row: `t('arrivals.lateCancelled', { time })`, `customerEmailed ? t('arrivals.alreadyEmailed') : null`, and a `t('arrivals.restore')` button calling `restoreLateCancellation(id)`; on `{ clashes }` show `window.confirm(t('arrivals.restoreClash'))` and retry with `{ force: true }`.
  Monochrome classes only (`bg-zinc-900 text-white` primary button, `border-zinc-300` secondary).

  Messages en (`adminSchedule.arrivals`):

```ts
  arrivals: {
    title: 'Arrivals',
    markArrived: 'Arrived',
    clearArrived: 'Not arrived',
    arrivedMark: 'Arrived',
    cancelsAt: 'Not arrived — cancels automatically at {time}',
    lateCancelled: 'Cancelled at {time}: not arrived 15 minutes after the start',
    alreadyEmailed: 'The customer has already been emailed that it was cancelled — tell them it stands.',
    restore: 'Restore',
    restoreClash: 'This time now clashes with another booking or blocked time. Restore anyway?',
  },
```

  zh:

```ts
  arrivals: {
    title: '到達',
    markArrived: '已到達',
    clearArrived: '未到達',
    arrivedMark: '已到達',
    cancelsAt: '未到達 — 將於 {time} 自動取消',
    lateCancelled: '已於 {time} 取消：開始 15 分鐘後仍未到達',
    alreadyEmailed: '客人已收到取消電郵 — 請告訴客人預約仍然有效。',
    restore: '還原',
    restoreClash: '這個時段現在與其他預約或封鎖時段衝突。仍要還原嗎？',
  },
```

  (Use `{minutes}` from `LATE_ARRIVAL_CANCEL_MINUTES` instead of the literal 15 if the translator supports params here — it does; prefer `lateCancelled: 'Cancelled at {time}: not arrived {minutes} minutes after the start'`.)

- [ ] **Step 5: Wire it.** `admin/page.tsx`: add `getLateArrivalBoard()` to the page's `Promise.all` and render `<LateArrivalPanel board={board} />` immediately above `<ScheduleCalendar … />`. `admin-calendar-data.ts`: add `arrivedAt: true` to the select and `arrivedAt: row.arrivedAt?.toISOString() ?? null` to the serializer. `ScheduleCalendar.tsx`: in both grid mappings add `arrived: Boolean(appt.arrivedAt),`; in `openEditor` add `arrivedAt: appt.arrivedAt,`. Grids: `GridAppointment` gets `/** Staff marked the customer arrived. */ arrived?: boolean;` and inside the block text, after the service line: `{appt.arrived && <div className="font-semibold uppercase">{t('arrivals.arrivedMark')}</div>}`. `AppointmentDialog.tsx`: add `arrivedAt?: string | null;` to the edit target; in the footer before Close, for `isEdit && target.status === 'CONFIRMED' && isArrivalWindowOpen(target.date, target.durationMin)`:

```tsx
            <button type="button" disabled={saving} onClick={toggleArrived}
              className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50">
              {target.arrivedAt ? t('arrivals.clearArrived') : t('arrivals.markArrived')}
            </button>
```

  with

```tsx
  const toggleArrived = async () => {
    if (target.mode !== 'edit') return;
    setSaving(true);
    try {
      const { markArrived } = await import('@/app/actions/admin-arrivals');
      const result = await markArrived(target.appointmentId, !target.arrivedAt);
      if (result.success) onSaved(); else setError(result.error);
    } finally { setSaving(false); }
  };
```

  (`onSaved` is the dialog's existing success callback — check its prop name.)

- [ ] **Step 6: Run** `pnpm test 2>&1 | tail -5`, `pnpm exec tsc --noEmit 2>&1 | grep -v colorMath | head`, `pnpm lint`. Expected: green.
- [ ] **Step 7: Commit** `git commit -am "feat(late-arrival): arrivals panel, Arrived toggle and grid mark"` (add the new files).

---

### Task 9: Customer-facing text

**Files:**
- Modify: `src/i18n/messages/en/legal.ts` (`bookingTerms.cancelling` ~L157-173, `rights.body` ~L196), `zh/legal.ts` (~L140-145, ~L162)
- Modify: `src/app/[locale]/booking-terms/page.tsx` (~L85-90: render the new `lateArrival` line)
- Modify: `src/i18n/messages/en/emails.ts`, `zh/emails.ts` (`confirmation.footnote`/`footnoteWithDeposit`, `reminder.footnote`: append the late sentence, or add `common.lateArrival` and push it into the footnotes of CONFIRMATION and REMINDER in `email-content.ts`)
- Modify: `src/i18n/messages/en/appointments.ts`, `zh/appointments.ts` + `src/components/appointments/AppointmentCard.tsx` (~L96-101, ~L203): a late-cancelled card label
- Modify: `src/app/[locale]/appointments/page.tsx` (select `lateCancelledAt`)
- Test: `src/test/pages/booking-terms-page.test.ts`, `src/app/services/email-content.test.ts`, the AppointmentCard test if one exists (search `AppointmentCard`)

- [ ] **Step 1: Failing tests:** booking-terms page text contains the 15-minute sentence in both languages; CONFIRMATION and REMINDER footnotes include `common.lateArrival` text; a CANCELLED card with `lateCancelledAt` shows the late label.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** en `legal.bookingTerms.cancelling` — add after `late`:

```ts
      /** {minutes}: LATE_ARRIVAL_CANCEL_MINUTES. Applies while Admin → Settings has the rule on; the salon decided it 2026-10-16. */
      lateArrival: 'If you are more than {minutes} minutes late and haven’t let us know, we cancel your appointment so that the time can go to another client, and we keep your deposit, as for a missed appointment. If you’re running late, please call us.',
```

zh:

```ts
      lateArrival: '如你遲到超過 {minutes} 分鐘而沒有通知我們，我們會取消你的預約，把時段讓給其他客人，並按缺席處理不退還訂金。如會遲到，請致電我們。',
```

`rights.body` en: insert after "If you miss your appointment, we keep your deposit;": " the same applies if you are more than 15 minutes late;" — keep the sentence grammatical (rewrite the whole value; mirror in zh). Render `t('cancelling.lateArrival', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })` on the page after `late`.

Emails: `common.lateArrival` en `'Please arrive on time: if you are more than {minutes} minutes late without letting us know, we cancel the appointment and keep any deposit.'`; zh `'請準時到達：如遲到超過 {minutes} 分鐘而沒有通知我們，我們會取消預約，並不退還訂金。'`. In `email-content.ts` push `t('common.lateArrival', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })` as the first footnote of `CONFIRMATION` and `REMINDER`.

My Bookings: `appointments.status.LATE_CANCELLED` en `'Cancelled — more than 15 minutes late'`, zh `'已取消 — 遲到超過 15 分鐘'` (or use `{minutes}`); the page selects `lateCancelledAt`, the card picks that label when `status === 'CANCELLED' && lateCancelledAt`.

- [ ] **Step 4: Run** → PASS; also run `src/components/booking/DepositSummary.test.ts` and `admin-deposit.test.ts` (wording pins) and fix only what this task changed.
- [ ] **Step 5: Commit** `git commit -am "feat(late-arrival): booking terms, email and My Bookings wording (en/zh)"`

---

### Task 10: PostgreSQL lifecycle check, docs, full verification, PR

**Files:**
- Modify: `scripts/verify-booking-lifecycle.ts` (new section after the staff-cancel section ~L798-809)
- Modify: `CLAUDE.md` (Booking and operations rules: one bullet), `readme/structure.md` (new modules), `LAUNCH.md` (owner step: brief staff, then switch on)

- [ ] **Step 1: Lifecycle script section** — on the real PostgreSQL test DB: set `SiteSettings.lateAutoCancelSince` to 1 day ago; create a CONFIRMED booking starting 20 min ago with a CAPTURED deposit attempt (reuse the script's deposit helpers); run `cancelLateArrivals(new Date())`; assert CANCELLED, `lateCancelledAt` set, attempt KEPT, one `LATE_CANCELLED` delivery with `nextAttemptAt` ≈ now+30 min; call the restore path's DB effect (import the action is not possible outside Next — replicate by calling a small exported service if you extracted one, otherwise assert via a direct Serializable update mirroring `restoreLateCancellation`); assert CONFIRMED + CAPTURED. Then a second booking: set `arrivedAt` in a concurrent transaction before the cron's transaction commits (two `prisma.$transaction` calls with Serializable isolation, the arrival first) → stays CONFIRMED.

- [ ] **Step 2: Docs.** CLAUDE.md bullet under "Booking and operations rules":

```md
- **Late arrivals** (`services/late-arrival-cancel.ts`, spec `2026-10-16-late-arrival-auto-cancel-design.md`): while Admin → Settings has it on (`SiteSettings.lateAutoCancelSince`, off by default), the calendar-sync cron cancels a CONFIRMED booking not marked Arrived 15 minutes after its start (only bookings that start after the switch-on, within 120 minutes), keeps its deposit (KEPT, as a no-show) and emails `LATE_CANCELLED` 30 minutes later. Staff tap Arrived (arrivals panel / booking dialog); Mark completed and walk-ins count as arrived; Restore within 24 h (KEPT → CAPTURED, drops the unsent email).
```

- [ ] **Step 3: Full verification**, foreground, exact string: `pnpm run lint && pnpm run test && pnpm run build` (build needs prod DB creds: `export POSTGRES_URL="$(grep '^POSTGRES_URL=' <scratch>/.env.pull | cut -d= -f2- | tr -d '"')"` and the same for `POSTGRES_URL_NON_POOLING` first), and `pnpm exec tsc --noEmit`. If a local PostgreSQL 17/18 is available, run `pnpm test:booking-lifecycle` per CLAUDE.md; otherwise CI runs it.

- [ ] **Step 4: Commit, push, PR** — `git push -u origin feat/late-arrival-auto-cancel`, `gh pr create` (body: summary, owner rollout steps, "ships OFF", preview DB migration note; end with the 🤖 line and session link). Watch `gh pr checks --watch`.

---

## Self-review notes

- Spec §4.1 → Tasks 2, 6; §4.2 → Tasks 4, 5; §4.3 → Task 6; §4.4 → Tasks 7, 8; §4.5 → Tasks 3, 9; §5 → Task 3; §6 → Tasks 4, 6; §7 → every task + Task 10; §8 → Task 10 (+ preview DB migration by hand after merge).
- Names used across tasks: `cancelLateArrivals`, `markArrived`, `restoreLateCancellation`, `getLateArrivalBoard`, `LateArrivalBoard`, `lateCancelWindow`, `isLateCancelCandidate`, `isArrivalWindowOpen`, `isLateCancelRestorable`, `lateCancelDueAt`, `LATE_CANCELLED`, `LATE_ARRIVAL_FAILED`, `late-arrival-cancel` job row.
