# Customer Reschedule Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a customer's self-service reschedule into a staff-approved request: the original booking stays CONFIRMED until staff approve (after a fresh Fresha check) or decline, and unanswered requests lapse 24 h before the requested time.

**Architecture:** Two nullable columns on `Appointment` hold at most one open request. Customer actions in `src/app/actions/booking.ts` open/replace/withdraw it; an admin action in `src/app/actions/admin.ts` approves (moves `date`) or declines it; the existing notifications cron lapses stale requests. Four new email kinds flow through the existing transactional outbox, whose `isCurrent` check drops emails for requests that have since changed.

**Tech Stack:** Next.js 16.3.8 App Router server actions, React 19, TypeScript, Prisma 6.19.3 (PostgreSQL 18 prod / SQLite dev / MSSQL legacy), node:test via `node --conditions=react-server --import tsx --test`, Resend + React Email.

**Spec:** `docs/superpowers/specs/2026-10-08-reschedule-requests-design.md`

## Global Constraints

- **Start from main after PR #59 is merged:** `git checkout feat/reschedule-requests && git rebase origin/main` (PR #59 also edits `scripts/verify-booking-lifecycle.ts`).
- Edit **all three** schemas (`prisma/vercel`, `prisma/dev`, `prisma/prod`) for any schema change; the app's client is generated from `prisma/vercel/schema.prisma` (`pnpm db:vercel:generate`).
- Never run `pnpm db:dev:migrate` / `db:dev:push` — they rewrite the tracked binary `prisma/dev/dev.db`. Verify migrations against throwaway databases only (commands given in Task 1).
- Request lead time: **24 hours** (`RESCHEDULE_REQUEST_LEAD_HOURS = 24`), measured in absolute milliseconds.
- Pre-approval Fresha refresh: feeds older than **5 minutes** (`APPROVAL_REFRESH_MINUTES = 5`), for reschedule approvals **and** new-booking approvals.
- Admin board lists at most **50** open requests; the lapse step handles at most **50** per cron run.
- Every user-visible string goes in `src/i18n/messages/en/*.ts` **and** `src/i18n/messages/zh/*.ts` (the `completeness.test.ts` suite fails on a missing key). Customer copy in written Chinese; salon-staff copy in the same colloquial Cantonese as the existing `salonAlert`.
- Brand is monochrome black/white/grey — no new colours beyond the zinc/amber/red/green classes already used on these screens.
- Request/replace/withdraw/decline/lapse **never** bump `notificationVersion`; only approve does.
- Every transition is a conditional `updateMany` inside `runSerializableWithRetry`, guarded on `{ id, status: 'CONFIRMED', date, rescheduleRequestedAt }` as read in the same transaction.
- Kill-switches stay above the first DB call (CLAUDE.md "Neon compute budget"); no new cron, no new public endpoint.
- Never access env vars at module level. `'use server'` files may export only async functions (`use-server-exports.test.ts`).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U3fckL7wvjjUxxJjYcDSYh
  ```

## Review Focus

These are inputs the spec implies but its own test list does not name; each has a test in the owning task.

1. **Staff move an appointment directly in Admin while a request is open** → the request is cleared (otherwise the board shows an un-approvable stale request forever). Test in Task 6.
2. **Staff cancel or complete an appointment with an open request** → the request is cleared and no decline/lapse email is sent later. Test in Task 6.
3. **Customer double-clicks "Request"** (two identical concurrent requests) → exactly one request and one pair of emails; the loser gets `RESCHEDULE_REQUEST_CHANGED`, never a second email pair. Test in Task 5.
4. **An expired-but-not-yet-cleaned request** (requested time now < 24 h away, cron not yet run) → the customer can still make a fresh request, which overwrites it; staff cannot approve the expired one. Tests in Tasks 5 and 6.
5. **Approval when the requested time has fallen outside the stylist's hours** (hours edited after the request) → `OUTSIDE_HOURS` is shown to staff and the request stays open for an explicit decline. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/{vercel,dev,prod}/schema.prisma` | two columns + index on `Appointment` |
| `prisma/{vercel,dev,prod}/migrations/20261009120000_reschedule_requests/migration.sql` | one migration per dialect |
| `src/app/lib/reschedule-request.ts` (new) | pure, client-safe: lead-time constant, expiry test, view model for UI |
| `src/app/services/email-content.ts` | 4 new kinds, `requestedDate` option, salon-kind helper |
| `src/app/services/email-service.ts` | route salon kinds to the salon address |
| `src/app/services/notification-outbox-service.ts` | request-scoped event keys, payload `requestedDate/At`, `isCurrent` rules |
| `src/app/services/calendar-sync-service.ts` | `stylistId` filter + `refreshStylistCalendarFeeds` |
| `src/app/actions/booking.ts` | `requestReschedule`, `withdrawRescheduleRequest`; cancel clears request; `rescheduleAppointment` removed |
| `src/app/actions/admin.ts` | `decideRescheduleRequest`; `updateAppointmentStatus` uses stylist refresh + clears requests |
| `src/app/actions/admin-schedule.ts` | direct staff move clears request |
| `src/app/services/reschedule-request-lapse.ts` (new) | `lapseExpiredRescheduleRequests` |
| `src/app/services/notification-cron-service.ts` | calls the lapse step |
| `src/app/services/admin-calendar-data.ts` | open-request list + count; request fields on calendar rows |
| `src/components/appointments/{AppointmentCard,RescheduleModal}.tsx`, `src/app/[locale]/appointments/page.tsx` | customer UI |
| `src/components/admin/{ScheduleCalendar,AppointmentDialog}.tsx`, `src/app/[locale]/admin/page.tsx` | staff UI |
| `src/i18n/messages/{en,zh}/{errors,emails,appointments,adminSchedule}.ts` | copy |
| `scripts/verify-booking-lifecycle.ts` | real-Postgres request lifecycle |
| `readme/structure.md`, `CLAUDE.md`, `src/app/lib/rate-limit.ts` | docs + corrected comments |

---

### Task 1: Schema columns and migrations

**Files:**
- Modify: `prisma/vercel/schema.prisma`, `prisma/dev/schema.prisma`, `prisma/prod/schema.prisma` (model `Appointment`)
- Create: `prisma/vercel/migrations/20261009120000_reschedule_requests/migration.sql`
- Create: `prisma/dev/migrations/20261009120000_reschedule_requests/migration.sql`
- Create: `prisma/prod/migrations/20261009120000_reschedule_requests/migration.sql`

**Interfaces:**
- Produces: `Appointment.rescheduleRequestedDate: Date | null`, `Appointment.rescheduleRequestedAt: Date | null` on the generated Prisma client.

Schema/config change: verified by CI's migration replay + drift checks rather than a unit test.

- [ ] **Step 1: Add the fields to all three schemas**

In each `schema.prisma`, inside `model Appointment`, directly after the `treatwellSyncedAt` line add:

```prisma
  /// Requested new start (UTC instant, like `date`). Null = no open request.
  rescheduleRequestedDate DateTime?
  /// When the open request was made; also its identity for emails and races.
  rescheduleRequestedAt   DateTime?
```

and next to the other `@@index` lines of the model add:

```prisma
  @@index([rescheduleRequestedDate])
```

- [ ] **Step 2: Write the three migrations**

`prisma/vercel/migrations/20261009120000_reschedule_requests/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "rescheduleRequestedAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleRequestedDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Appointment_rescheduleRequestedDate_idx" ON "Appointment"("rescheduleRequestedDate");
```

`prisma/dev/migrations/20261009120000_reschedule_requests/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "rescheduleRequestedAt" DATETIME;
ALTER TABLE "Appointment" ADD COLUMN "rescheduleRequestedDate" DATETIME;

-- CreateIndex
CREATE INDEX "Appointment_rescheduleRequestedDate_idx" ON "Appointment"("rescheduleRequestedDate");
```

`prisma/prod/migrations/20261009120000_reschedule_requests/migration.sql`:

```sql
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [rescheduleRequestedAt] DATETIME2,
[rescheduleRequestedDate] DATETIME2;

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_rescheduleRequestedDate_idx] ON [dbo].[Appointment]([rescheduleRequestedDate]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
```

- [ ] **Step 3: Regenerate the client and type-check**

Run: `pnpm db:vercel:generate && npx tsc --noEmit`
Expected: generate succeeds; tsc prints no errors.

- [ ] **Step 4: Replay SQLite migrations and check drift (same as CI)**

Run:
```bash
t=$(mktemp -d)/check.db
DATABASE_URL="file:$t" pnpm exec prisma migrate deploy --schema prisma/dev/schema.prisma
DATABASE_URL="file:$t" pnpm exec prisma migrate diff --from-url "file:$t" --to-schema-datamodel prisma/dev/schema.prisma --exit-code && echo NO_DRIFT
rm -f "$t"
```
Expected: `NO_DRIFT`.

- [ ] **Step 5: Replay PostgreSQL migrations and check drift on a throwaway PG 18**

Run (the scratch cluster never touches Neon; `-c unix_socket_directories=''` avoids macOS's socket-path limit):
```bash
SP=$(mktemp -d); PGBIN=/usr/local/opt/postgresql@18/bin
$PGBIN/initdb -D $SP/pg -U postgres --auth=trust >/dev/null
$PGBIN/pg_ctl -D $SP/pg -o "-p 55433 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l $SP/pg.log start >/dev/null; sleep 2
$PGBIN/psql -h 127.0.0.1 -p 55433 -U postgres -qc "CREATE ROLE salon_test LOGIN PASSWORD 'disposable-ci-password' CREATEDB;" -c "CREATE DATABASE salon_test OWNER salon_test;"
U=postgresql://salon_test:disposable-ci-password@127.0.0.1:55433/salon_test
env -i PATH="$PATH" HOME="$HOME" POSTGRES_URL=$U POSTGRES_URL_NON_POOLING=$U pnpm db:vercel:deploy
env -i PATH="$PATH" HOME="$HOME" POSTGRES_URL=$U POSTGRES_URL_NON_POOLING=$U pnpm exec prisma migrate diff --from-url "$U" --to-schema-datamodel prisma/vercel/schema.prisma --exit-code && echo NO_DRIFT
```
Expected: `All migrations have been successfully applied.` then `NO_DRIFT`. Leave this cluster running for Task 9; stop it there.

- [ ] **Step 6: Run the unit suite**

Run: `pnpm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add prisma/vercel/schema.prisma prisma/dev/schema.prisma prisma/prod/schema.prisma prisma/*/migrations/20261009120000_reschedule_requests
git commit -m "feat(db): add reschedule request columns to Appointment"
```

---

### Task 2: Pure request helpers (lead time, expiry, view model)

**Files:**
- Create: `src/app/lib/reschedule-request.ts`
- Test: `src/app/lib/reschedule-request.test.ts`

**Interfaces:**
- Produces:
  - `RESCHEDULE_REQUEST_LEAD_HOURS: 24`
  - `isRescheduleRequestExpired(requestedDate: Date | string, now?: Date): boolean`
  - `type RescheduleRequestView = { state: 'none' } | { state: 'open' | 'expired'; requestedDate: string; requestedAt: string }`
  - `rescheduleRequestView(row: { rescheduleRequestedDate: Date | string | null; rescheduleRequestedAt: Date | string | null }, now?: Date): RescheduleRequestView`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/lib/reschedule-request.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { isRescheduleRequestExpired, rescheduleRequestView } from './reschedule-request';

const now = new Date('2099-09-01T12:00:00Z');

test('a request lapses once its requested time is less than 24 hours away', () => {
  assert.equal(isRescheduleRequestExpired(new Date('2099-09-02T12:00:00Z'), now), false, 'exactly 24 h is still open');
  assert.equal(isRescheduleRequestExpired(new Date('2099-09-02T11:59:00Z'), now), true);
  assert.equal(isRescheduleRequestExpired('2099-08-31T12:00:00.000Z', now), true, 'a past time is expired');
});

test('the view model distinguishes no request, an open request and an expired one', () => {
  assert.deepEqual(rescheduleRequestView({ rescheduleRequestedDate: null, rescheduleRequestedAt: null }, now), { state: 'none' });
  assert.deepEqual(
    rescheduleRequestView({ rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T11:00:00Z') }, now),
    { state: 'open', requestedDate: '2099-09-10T09:00:00.000Z', requestedAt: '2099-09-01T11:00:00.000Z' },
  );
  assert.deepEqual(
    rescheduleRequestView({ rescheduleRequestedDate: '2099-09-02T09:00:00.000Z', rescheduleRequestedAt: '2099-08-30T10:00:00.000Z' }, now),
    { state: 'expired', requestedDate: '2099-09-02T09:00:00.000Z', requestedAt: '2099-08-30T10:00:00.000Z' },
  );
});

test('half a request (one field set) is treated as no request', () => {
  assert.deepEqual(rescheduleRequestView({ rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: null }, now), { state: 'none' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=react-server --import tsx --test src/app/lib/reschedule-request.test.ts`
Expected: FAIL — `Cannot find module './reschedule-request'`.

- [ ] **Step 3: Implement**

```ts
// src/app/lib/reschedule-request.ts
// Pure and client-safe: shared by the customer card, the admin board, the
// request/approve actions and the lapse step, so all agree on "expired".

/** A reschedule request must be for a time at least this far ahead, and lapses inside it. */
export const RESCHEDULE_REQUEST_LEAD_HOURS = 24;

export function isRescheduleRequestExpired(requestedDate: Date | string, now: Date = new Date()): boolean {
  return new Date(requestedDate).getTime() - now.getTime() < RESCHEDULE_REQUEST_LEAD_HOURS * 3_600_000;
}

export type RescheduleRequestView =
  | { state: 'none' }
  | { state: 'open' | 'expired'; requestedDate: string; requestedAt: string };

export function rescheduleRequestView(
  row: { rescheduleRequestedDate: Date | string | null; rescheduleRequestedAt: Date | string | null },
  now: Date = new Date(),
): RescheduleRequestView {
  if (!row.rescheduleRequestedDate || !row.rescheduleRequestedAt) return { state: 'none' };
  const requestedDate = new Date(row.rescheduleRequestedDate).toISOString();
  const requestedAt = new Date(row.rescheduleRequestedAt).toISOString();
  return { state: isRescheduleRequestExpired(requestedDate, now) ? 'expired' : 'open', requestedDate, requestedAt };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --conditions=react-server --import tsx --test src/app/lib/reschedule-request.test.ts`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/reschedule-request.ts src/app/lib/reschedule-request.test.ts
git commit -m "feat(booking): shared reschedule-request lead time and view model"
```

---

### Task 3: Error codes, email kinds and copy

**Files:**
- Modify: `src/i18n/messages/en/errors.ts`, `src/i18n/messages/zh/errors.ts` (`booking` section)
- Modify: `src/i18n/messages/en/emails.ts`, `src/i18n/messages/zh/emails.ts`
- Modify: `src/app/services/email-content.ts`
- Modify: `src/app/services/email-service.ts:75`
- Test: `src/app/services/email-content.test.ts`

**Interfaces:**
- Produces:
  - `BookingErrorCode` gains `'RESCHEDULE_REQUEST_TOO_SOON' | 'RESCHEDULE_REQUEST_CHANGED' | 'RESCHEDULE_REQUEST_EXPIRED' | 'RESCHEDULE_SLOT_TAKEN'` (derived from the en `errors.booking` keys).
  - `AppointmentEmailKind` gains `'RESCHEDULE_REQUEST_RECEIVED' | 'SALON_RESCHEDULE_ALERT' | 'RESCHEDULE_DECLINED' | 'RESCHEDULE_LAPSED'`.
  - `AppointmentEmailOptions` gains `requestedDate?: Date`.
  - `isSalonEmailKind(kind: AppointmentEmailKind): boolean` (true for `SALON_ALERT`, `SALON_RESCHEDULE_ALERT`).
  - `RESCHEDULE_REQUEST_EMAIL_KINDS: readonly AppointmentEmailKind[]` = the four new kinds.

- [ ] **Step 1: Write the failing tests** (append to `src/app/services/email-content.test.ts`; reuse that file's existing imports — add `isSalonEmailKind` to the `./email-content` import)

```ts
const requestAppointment = {
  id: 'appointment-abcdefgh', date: new Date('2099-09-14T12:00:00Z'), notes: null,
  user: { name: 'Amy', email: 'amy@example.test', phone: '07000 000000' },
  stylist: { name: 'Ivan' },
  service: { name: 'Cut & Blow-dry', duration: 60 },
  price: { known: false } as const,
};
const requestedDate = new Date('2099-09-15T09:00:00Z');

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`reschedule-request emails show the current and requested times (${locale})`, () => {
    for (const kind of ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED'] as const) {
      const content = appointmentEmailContent(kind, requestAppointment, locale, { requestedDate });
      const text = JSON.stringify(content);
      assert.ok(content.subject.length > 0, kind);
      assert.match(text, /14/, `${kind} names the current date`);
      assert.match(text, /15/, `${kind} names the requested date`);
      assert.equal(content.greeting === null, kind === 'SALON_RESCHEDULE_ALERT', `${kind}: only staff mail has no greeting`);
    }
  });
}

test('the salon reschedule alert carries the customer contact details and links to the admin board', () => {
  const content = appointmentEmailContent('SALON_RESCHEDULE_ALERT', requestAppointment, 'en-GB', { requestedDate });
  const values = content.details.map((detail) => detail.value);
  assert.ok(values.includes('Amy'));
  assert.ok(values.includes('amy@example.test'));
  assert.ok(values.includes('07000 000000'));
  assert.match(content.cta?.href ?? '', /\/admin$/);
});

test('reschedule-request emails refuse to render without the requested date', () => {
  assert.throws(() => appointmentEmailContent('RESCHEDULE_DECLINED', requestAppointment, 'en-GB', {}), /requested date/);
});

test('both salon alert kinds are staff mail', () => {
  assert.equal(isSalonEmailKind('SALON_ALERT'), true);
  assert.equal(isSalonEmailKind('SALON_RESCHEDULE_ALERT'), true);
  assert.equal(isSalonEmailKind('RESCHEDULE_DECLINED'), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/email-content.test.ts`
Expected: FAIL — `isSalonEmailKind` is not exported / unknown kind.

- [ ] **Step 3: Add the error copy**

In `src/i18n/messages/en/errors.ts`, inside `booking: {`, after `TOO_MANY_RESCHEDULES`:

```ts
    RESCHEDULE_REQUEST_TOO_SOON: 'Please choose a new time at least 24 hours away, or call the salon.',
    RESCHEDULE_REQUEST_CHANGED: 'This reschedule request has changed. Please refresh and try again.',
    RESCHEDULE_REQUEST_EXPIRED: 'This request has expired: the requested time is less than 24 hours away.',
    RESCHEDULE_SLOT_TAKEN: 'That time is no longer free. Decline the request or call the customer.',
```

In `src/i18n/messages/zh/errors.ts`, same place:

```ts
    RESCHEDULE_REQUEST_TOO_SOON: '請選擇最少 24 小時後的新時間，或致電本店。',
    RESCHEDULE_REQUEST_CHANGED: '此改期申請已有變更，請重新整理後再試。',
    RESCHEDULE_REQUEST_EXPIRED: '此申請已過期：申請的時間距今不足 24 小時。',
    RESCHEDULE_SLOT_TAKEN: '嗰個時間已經冇位，請拒絕申請或者打電話俾客人。',
```

- [ ] **Step 4: Add the email copy**

In `src/i18n/messages/en/emails.ts`, after the `salonAlert` block:

```ts
  rescheduleRequest: {
    subject: 'We’ve received your request to move your booking — Harbour Hair Salon',
    preview: 'Request received: move to {requested}',
    eyebrow: 'Request received',
    title: 'Thanks — we’ve got your request.',
    intro: 'You asked to move your appointment to {requested}. Your current time stays booked until the salon confirms the change. You’ll get another email when we do.',
    cta: 'View my booking',
    footnote: 'You can change or withdraw this request from My Bookings. If we can’t confirm it at least 24 hours before the new time, it lapses and your current time stands.',
  },
  salonRescheduleAlert: {
    subject: 'Reschedule request — Harbour Hair Salon',
    preview: 'Action needed: {customer} wants to move {service} to {requested}',
    eyebrow: 'Action needed',
    title: 'Reschedule request',
    intro: 'A customer wants to move a confirmed booking. Their current time stays booked until you approve or decline the request in the admin schedule.',
    cta: 'Open the schedule',
    footnote: 'This alert is for salon staff only and includes the customer’s contact details. The request lapses 24 hours before the requested time.',
  },
  rescheduleDeclined: {
    subject: 'We couldn’t move your booking — Harbour Hair Salon',
    preview: 'Your original time still stands',
    eyebrow: 'Request declined',
    title: 'Your original time still stands.',
    intro: 'We couldn’t move your appointment to {requested}. Your booking below is unchanged. Please call the salon if you’d like another time.',
    cta: 'View my booking',
    footnote: 'You can make a new request from My Bookings up to 24 hours before your appointment.',
  },
  rescheduleLapsed: {
    subject: 'Your reschedule request has expired — Harbour Hair Salon',
    preview: 'Your original time still stands',
    eyebrow: 'Request expired',
    title: 'Your original time still stands.',
    intro: 'We couldn’t confirm your request to move to {requested} in time, so it has expired. Your booking below is unchanged.',
    cta: 'View my booking',
    footnote: 'Please call the salon if you’d still like to change your appointment.',
  },
```

Add one label under `labels`: `currentTime: 'Current booking',`.

In `src/i18n/messages/zh/emails.ts`, same positions:

```ts
  rescheduleRequest: {
    subject: '我們已收到你的改期申請 — Harbour Hair Salon',
    preview: '已收到申請：改至{requested}',
    eyebrow: '已收到申請',
    title: '多謝，我們已收到你的申請。',
    intro: '你申請將預約改至{requested}。在本店確認之前，你現有的時間會繼續保留。確認後我們會另外發電郵通知你。',
    cta: '查看我的預約',
    footnote: '你可以在「我的預約」更改或撤回此申請。如未能在新時間前 24 小時確認，申請會自動失效，你現有的時間維持不變。',
  },
  salonRescheduleAlert: {
    subject: '有改期申請 — Harbour Hair Salon',
    preview: '要跟進：{customer} 想將{service}改去 {requested}',
    eyebrow: '要跟進',
    title: '有改期申請',
    intro: '有客人想改一個已確認嘅預約。喺你批准或者拒絕之前，佢原本嘅時間會繼續保留。',
    cta: '打開排程',
    footnote: '呢封通知只係俾店舖同事睇，入面有客人嘅聯絡資料。申請會喺要求時間前 24 小時自動失效。',
  },
  rescheduleDeclined: {
    subject: '未能更改你的預約 — Harbour Hair Salon',
    preview: '你原本的時間維持不變',
    eyebrow: '申請未獲接納',
    title: '你原本的時間維持不變。',
    intro: '我們未能將你的預約改至{requested}。以下預約維持不變。如想另約時間，請致電本店。',
    cta: '查看我的預約',
    footnote: '你可於預約前 24 小時或之前，在「我的預約」提出新的申請。',
  },
  rescheduleLapsed: {
    subject: '你的改期申請已失效 — Harbour Hair Salon',
    preview: '你原本的時間維持不變',
    eyebrow: '申請已失效',
    title: '你原本的時間維持不變。',
    intro: '我們未能及時確認你改至{requested}的申請，所以申請已經失效。以下預約維持不變。',
    cta: '查看我的預約',
    footnote: '如仍想更改預約，請致電本店。',
  },
```

and `currentTime: '現有預約',` under `labels`.

- [ ] **Step 5: Implement the kinds in `email-content.ts`**

Replace the `AppointmentEmailKind` line with:

```ts
export type AppointmentEmailKind = 'REQUEST_RECEIVED' | 'SALON_ALERT' | 'CONFIRMATION' | 'CANCELLATION' | 'RESCHEDULE' | 'REMINDER' | 'REVIEW_REQUEST'
  | 'RESCHEDULE_REQUEST_RECEIVED' | 'SALON_RESCHEDULE_ALERT' | 'RESCHEDULE_DECLINED' | 'RESCHEDULE_LAPSED';

/** Kinds addressed to the salon (its address and language), never the customer. */
export function isSalonEmailKind(kind: AppointmentEmailKind): boolean {
  return kind === 'SALON_ALERT' || kind === 'SALON_RESCHEDULE_ALERT';
}

/** Kinds that belong to one reschedule request (keyed by its `requestedAt`). */
export const RESCHEDULE_REQUEST_EMAIL_KINDS: readonly AppointmentEmailKind[] = ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED', 'RESCHEDULE_LAPSED'];
```

Change the options type to:

```ts
export type AppointmentEmailOptions = { salonPhone?: string; oldDate?: Date; requestedDate?: Date; now?: Date };
```

Extend the `labels` helper's key union with `'currentTime'`. Then add these cases to the `switch (kind)` (before the closing brace):

```ts
    case 'RESCHEDULE_REQUEST_RECEIVED':
    case 'SALON_RESCHEDULE_ALERT':
    case 'RESCHEDULE_DECLINED':
    case 'RESCHEDULE_LAPSED': {
      if (!options.requestedDate) throw new Error('Reschedule-request notification requires the requested date');
      const requested = `${formatSalonLongDate(locale, options.requestedDate)} ${formatSalonClock(locale, options.requestedDate)}`;
      const current = `${date} ${time}`;
      if (kind === 'SALON_RESCHEDULE_ALERT') {
        const customer = name || t('values.nameNotGiven');
        return {
          ...base,
          greeting: null,
          subject: t('salonRescheduleAlert.subject'),
          preview: t('salonRescheduleAlert.preview', { customer, service, requested }),
          eyebrow: t('salonRescheduleAlert.eyebrow'), title: t('salonRescheduleAlert.title'), intro: t('salonRescheduleAlert.intro'),
          details: [
            labels('service', service), labels('stylist', appointment.stylist.name),
            labels('currentTime', current), labels('requestedDate', formatSalonLongDate(locale, options.requestedDate)),
            labels('requestedTime', formatSalonClock(locale, options.requestedDate)),
            { label: t('labels.customer'), value: customer },
            { label: t('labels.email'), value: appointment.user.email },
            { label: t('labels.phone'), value: appointment.user.phone || t('values.notProvided') },
          ],
          cta: { label: t('salonRescheduleAlert.cta'), href: url(locale, '/admin') },
          footnotes: [t('salonRescheduleAlert.footnote')],
          reference: t('common.referenceShort', { reference }),
        };
      }
      const section = kind === 'RESCHEDULE_REQUEST_RECEIVED' ? 'rescheduleRequest' : kind === 'RESCHEDULE_DECLINED' ? 'rescheduleDeclined' : 'rescheduleLapsed';
      return {
        ...base,
        subject: t(`${section}.subject`),
        preview: t(`${section}.preview`, { requested }),
        eyebrow: t(`${section}.eyebrow`), title: t(`${section}.title`), intro: t(`${section}.intro`, { requested }),
        details: [labels('service', service), labels('stylist', appointment.stylist.name), labels('currentTime', current), labels('requestedDate', formatSalonLongDate(locale, options.requestedDate)), labels('requestedTime', formatSalonClock(locale, options.requestedDate))],
        cta: { label: t(`${section}.cta`), href: url(locale, '/appointments') },
        footnotes: [t(`${section}.footnote`)],
      };
    }
```

If `t(\`${section}.subject\`)` fails the translator's literal-key type, use `t.dynamic(\`${section}.subject\`)` (the same escape hatch `ScheduleCalendar` uses for `status.*`).

- [ ] **Step 6: Route salon kinds to the salon address**

In `src/app/services/email-service.ts`, add `isSalonEmailKind` to the `./email-content` import and change `if (kind === 'SALON_ALERT') {` to:

```ts
  if (isSalonEmailKind(kind)) {
```

- [ ] **Step 7: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/services/email-content.test.ts src/i18n/messages/completeness.test.ts`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/i18n/messages/en/errors.ts src/i18n/messages/zh/errors.ts src/i18n/messages/en/emails.ts src/i18n/messages/zh/emails.ts src/app/services/email-content.ts src/app/services/email-content.test.ts src/app/services/email-service.ts
git commit -m "feat(email): reschedule request, salon alert, declined and lapsed emails"
```

---

### Task 4: Outbox — request-scoped event keys and `isCurrent` rules

**Files:**
- Modify: `src/app/services/notification-outbox-service.ts`
- Test: `src/app/services/notification-outbox-service.test.ts`

**Interfaces:**
- Consumes: `isSalonEmailKind`, `RESCHEDULE_REQUEST_EMAIL_KINDS`, `AppointmentEmailOptions.requestedDate` (Task 3).
- Produces: `enqueueAppointmentNotification(db, kind, appointment, options?: AppointmentEmailOptions & { requestedAt?: Date })`. For the four request kinds `requestedDate` and `requestedAt` are **required** (throws otherwise) and the event key is `appointment/{id}/{notificationVersion}/{kind}/{requestedAt ISO}`.

- [ ] **Step 1: Write the failing tests** (append to `notification-outbox-service.test.ts`)

```ts
function requestFixture(kind: string, state: { status: string; requestedAt: string | null; date?: string }) {
  const now = new Date('2099-09-01T12:00:00Z');
  const requestedAt = '2099-09-01T11:00:00.000Z';
  // The queued payload and the booking agree on the date, so only the request rules decide.
  const date = new Date(state.date ?? '2099-09-14T12:00:00Z').toISOString();
  const row = {
    id: 'job-r', eventKey: `appointment/a/0/${kind}/${requestedAt}`, kind, appointmentId: 'a', status: 'PENDING', attempts: 0,
    firstAttemptAt: null as Date | null, nextAttemptAt: now, createdAt: now, lockedAt: null as Date | null, lockToken: null as string | null,
    payloadJson: JSON.stringify({
      version: 0, date, locale: 'en-GB',
      appointment: { schema: 2, id: 'a', date, notes: null, user: { name: 'Amy', email: 'amy@example.test' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 }, price: { known: false } },
      options: { requestedDate: '2099-09-15T09:00:00.000Z', requestedAt },
    }),
  };
  let sends = 0;
  const prepared: unknown[] = [];
  const db = {
    notificationDelivery: {
      findMany: async () => [row],
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.lockToken && where.lockToken !== row.lockToken) return { count: 0 };
        const increment = data.attempts as { increment?: number } | undefined;
        Object.assign(row, data, { attempts: row.attempts + (increment?.increment ?? 0) });
        return { count: 1 };
      },
    },
    appointment: {
      findUnique: async () => ({ id: 'a', status: state.status, date: new Date(date), notificationVersion: 0, review: null, rescheduleRequestedAt: state.requestedAt ? new Date(state.requestedAt) : null }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async (_kind: string, _appointment: unknown, options: unknown) => { prepared.push(options); return { from: 'Salon <b@example.com>', to: 'amy@example.test', subject: 'S', html: '<p>S</p>' }; },
      sendPreparedEmail: async () => { sends++; },
    },
  });
  return { service, db, row, now, sends: () => sends, prepared };
}

const OPEN = '2099-09-01T11:00:00.000Z';
const OTHER = '2099-09-01T11:30:00.000Z';
for (const [kind, state, expected] of [
  ['RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: OPEN }, 'SENT'],
  ['RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: OTHER }, 'SKIPPED'],
  ['RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: null }, 'SKIPPED'],
  ['SALON_RESCHEDULE_ALERT', { status: 'CONFIRMED', requestedAt: OPEN }, 'SENT'],
  ['SALON_RESCHEDULE_ALERT', { status: 'CANCELLED', requestedAt: OPEN }, 'SKIPPED'],
  ['RESCHEDULE_DECLINED', { status: 'CONFIRMED', requestedAt: null }, 'SENT'],
  ['RESCHEDULE_DECLINED', { status: 'CONFIRMED', requestedAt: OTHER }, 'SENT'],
  ['RESCHEDULE_DECLINED', { status: 'CONFIRMED', requestedAt: OPEN }, 'SKIPPED'],
  ['RESCHEDULE_DECLINED', { status: 'CANCELLED', requestedAt: null }, 'SKIPPED'],
  ['RESCHEDULE_LAPSED', { status: 'CONFIRMED', requestedAt: null }, 'SENT'],
  ['RESCHEDULE_LAPSED', { status: 'CONFIRMED', requestedAt: null, date: '2099-08-31T12:00:00Z' }, 'SKIPPED'],
] as const) {
  test(`${kind} with request ${state.requestedAt ?? 'cleared'} on a ${state.status} booking is ${expected}`, async () => {
    const f = requestFixture(kind, state);
    await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
    assert.equal(f.row.status, expected);
    assert.equal(f.sends(), expected === 'SENT' ? 1 : 0);
  });
}

test('a request email is prepared with its requested date', async () => {
  const f = requestFixture('RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: OPEN });
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal((f.prepared[0] as { requestedDate: Date }).requestedDate.toISOString(), '2099-09-15T09:00:00.000Z');
});

test('request emails are keyed by the request, so a replacement queues new events', async () => {
  const upserts: { eventKey: string }[] = [];
  const db = {
    notificationDelivery: { findUnique: async () => null, upsert: async ({ create }: { create: { eventKey: string } }) => { upserts.push(create); return { id: create.eventKey }; } },
    appointment: {},
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', { '@/app/lib/prisma': db, './email-service': {} });
  const appointment = { id: 'a', date: new Date('2099-09-14T12:00:00Z'), priceAtBooking: null, durationAtBooking: 60, notificationVersion: 3, notes: null, user: { email: 'amy@example.test', name: 'Amy' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 } };
  const requestedDate = new Date('2099-09-15T09:00:00Z');
  await service.enqueueAppointmentNotification(db as never, 'RESCHEDULE_REQUEST_RECEIVED', appointment, { requestedDate, requestedAt: new Date('2099-09-01T11:00:00Z') });
  await service.enqueueAppointmentNotification(db as never, 'RESCHEDULE_REQUEST_RECEIVED', appointment, { requestedDate, requestedAt: new Date('2099-09-01T11:30:00Z') });
  assert.deepEqual(upserts.map((event) => event.eventKey), [
    'appointment/a/3/RESCHEDULE_REQUEST_RECEIVED/2099-09-01T11:00:00.000Z',
    'appointment/a/3/RESCHEDULE_REQUEST_RECEIVED/2099-09-01T11:30:00.000Z',
  ]);
  await assert.rejects(service.enqueueAppointmentNotification(db as never, 'RESCHEDULE_DECLINED', appointment, { requestedDate }), /requestedAt/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/notification-outbox-service.test.ts`
Expected: FAIL — request kinds are `SKIPPED` (`isCurrent` default `false`) and event keys lack the suffix.

- [ ] **Step 3: Implement**

In `notification-outbox-service.ts`:

1. Import `isSalonEmailKind` and `RESCHEDULE_REQUEST_EMAIL_KINDS` from `./email-content`.
2. `NotificationPayload.options` becomes `{ salonPhone?: string; oldDate?: string; requestedDate?: string; requestedAt?: string }`.
3. In `eventLocale`, replace `kind === 'SALON_ALERT'` with `isSalonEmailKind(kind)`.
4. Replace the signature and first lines of `enqueueAppointmentNotification`:

```ts
export async function enqueueAppointmentNotification(
  db: QueueDb,
  kind: AppointmentEmailKind,
  appointment: NotificationAppointment,
  options: AppointmentEmailOptions & { requestedAt?: Date } = {},
) {
  // Phone bookings have an unroutable identity, but may still alert the salon.
  if (!isSalonEmailKind(kind) && isPlaceholderEmail(appointment.user.email)) return null;
  const forRequest = RESCHEDULE_REQUEST_EMAIL_KINDS.includes(kind);
  if (forRequest && (!options.requestedAt || !options.requestedDate)) {
    throw new Error(`${kind} requires requestedDate and requestedAt`);
  }
  // A replaced request is a different event: key request mail by the request.
  const eventKey = `appointment/${appointment.id}/${appointment.notificationVersion}/${kind}${forRequest ? `/${options.requestedAt!.toISOString()}` : ''}`;
```

and in the same function change `kind === 'SALON_ALERT' ? await salonLocaleFrom(db)` to `isSalonEmailKind(kind) ? await salonLocaleFrom(db)`, and the payload `options` to:

```ts
options: { salonPhone: options.salonPhone, oldDate: options.oldDate?.toISOString(), requestedDate: options.requestedDate?.toISOString(), requestedAt: options.requestedAt?.toISOString() },
```

5. Replace `isCurrent` with:

```ts
async function isCurrent(db: QueueDb, appointmentId: string | null, kind: string, payload: NotificationPayload, now: Date) {
  if (!appointmentId) return false;
  const current = await db.appointment.findUnique({ where: { id: appointmentId }, select: { date: true, status: true, notificationVersion: true, rescheduleRequestedAt: true, review: { select: { id: true } } } });
  if (!current || current.notificationVersion !== payload.version || current.date.toISOString() !== payload.date) return false;
  const thisRequestOpen = Boolean(payload.options?.requestedAt) && current.rescheduleRequestedAt?.toISOString() === payload.options?.requestedAt;
  switch (kind) {
    case 'CANCELLATION': return current.status === 'CANCELLED';
    case 'REQUEST_RECEIVED':
    case 'SALON_ALERT': return current.status === 'PENDING' && current.date > now;
    case 'CONFIRMATION':
    case 'RESCHEDULE':
    case 'REMINDER': return current.status === 'CONFIRMED' && current.date > now;
    case 'REVIEW_REQUEST': return ['CONFIRMED', 'COMPLETED'].includes(current.status) && current.date < now && !current.review;
    // Mail about an open request goes only while that same request is open.
    case 'RESCHEDULE_REQUEST_RECEIVED':
    case 'SALON_RESCHEDULE_ALERT':
      return current.status === 'CONFIRMED' && thisRequestOpen && new Date(payload.options!.requestedDate!) > now;
    // Mail about a closed request goes only while the original booking stands.
    case 'RESCHEDULE_DECLINED':
    case 'RESCHEDULE_LAPSED':
      return current.status === 'CONFIRMED' && !thisRequestOpen && current.date > now;
    default: return false;
  }
}
```

6. In `dispatchPendingNotifications`, change `row.kind !== 'SALON_ALERT' && isPlaceholderEmail(` to `!isSalonEmailKind(row.kind as AppointmentEmailKind) && isPlaceholderEmail(`, and pass the requested date when preparing:

```ts
          { ...payload.options, oldDate: payload.options?.oldDate ? new Date(payload.options.oldDate) : undefined, requestedDate: payload.options?.requestedDate ? new Date(payload.options.requestedDate) : undefined, now },
```

- [ ] **Step 4: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/services/notification-outbox-service.test.ts`
Expected: all pass (the earlier tests still pass — existing kinds are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/notification-outbox-service.ts src/app/services/notification-outbox-service.test.ts
git commit -m "feat(notifications): request-scoped events and currency rules for reschedule mail"
```

---

### Task 5: Fresh per-stylist Fresha refresh before approvals (D6)

**Files:**
- Modify: `src/app/services/calendar-sync-service.ts`
- Modify: `src/app/actions/admin.ts:17,462-466`
- Test: `src/app/services/calendar-sync-service.test.ts`, `src/app/actions/booking-concurrency.test.ts`

**Interfaces:**
- Produces:
  - `APPROVAL_REFRESH_MINUTES = 5`
  - `refreshStylistCalendarFeeds(stylistId: string, opts?: { maxAgeMinutes?: number; now?: Date; db?: PrismaClient; fetchFeed?: (url: string) => Promise<string> }): Promise<CalendarSyncResult[]>` — never throws; `[]` when `CALENDAR_SYNC_ENABLED !== 'true'`.
  - `CalendarSyncDependencies.stylistId?: string`.
- Removes: `refreshStaleCalendarFeeds` (its only caller is replaced).

- [ ] **Step 1: Write the failing tests**

In `calendar-sync-service.test.ts`, change the import to `import { refreshStylistCalendarFeeds, syncCalendarFeeds } from './calendar-sync-service';` and replace the two `on-demand refresh …` tests with:

```ts
test('approval refresh re-imports only that stylist\'s feeds older than five minutes or whose last attempt failed', async () => {
  const queries: Record<string, unknown>[] = [];
  const db = { calendarConnection: { findMany: async ({ where }: { where: Record<string, unknown> }) => { queries.push(where); return []; } } };
  await withCalendarSync('true', () => refreshStylistCalendarFeeds('s1', { db: db as unknown as PrismaClient, now }));
  assert.equal(queries.length, 1);
  assert.equal(queries[0].stylistId, 's1');
  assert.deepEqual(queries[0].OR, [
    { lastSuccessAt: null },
    { lastSuccessAt: { lt: new Date('2026-09-11T11:55:00Z') } },
    { lastError: { not: null } },
  ]);
});

test('approval refresh respects the kill-switch and never throws', async () => {
  let reads = 0;
  const db = { calendarConnection: { findMany: async () => { reads++; throw new Error('database unavailable'); } } };
  for (const flag of [undefined, 'false']) {
    assert.deepEqual(await withCalendarSync(flag, () => refreshStylistCalendarFeeds('s1', { db: db as unknown as PrismaClient, now })), []);
  }
  assert.equal(reads, 0, 'a disabled sync must not touch the database');
  assert.deepEqual(await withCalendarSync('true', () => refreshStylistCalendarFeeds('s1', { db: db as unknown as PrismaClient, now })), []);
  assert.equal(reads, 1);
});
```

In `booking-concurrency.test.ts`:
- change the fixture option type `onFeedRefresh?: () => void;` to `onFeedRefresh?: (stylistId: string, maxAgeMinutes: number) => void;`
- replace the `'@/app/services/calendar-sync-service'` dependency with:

```ts
    '@/app/services/calendar-sync-service': {
      APPROVAL_REFRESH_MINUTES: 5,
      refreshStylistCalendarFeeds: async (stylistId: string, opts: { maxAgeMinutes: number }) => {
        assert.equal(transactionActive, false, 'marketplace feeds must not be fetched inside the transaction');
        options.trace?.push('refresh');
        options.onFeedRefresh?.(stylistId, opts.maxAgeMinutes);
        return [];
      },
    },
```

- add:

```ts
test('approving a new booking refreshes only its stylist\'s feeds older than five minutes', async () => {
  const refreshed: [string, number][] = [];
  const f = fixture({ status: 'PENDING', onFeedRefresh: (stylistId, maxAgeMinutes) => refreshed.push([stylistId, maxAgeMinutes]) });
  assert.equal((await f.admin.updateAppointmentStatus(f.appointment.id, 'CONFIRMED')).success, true);
  assert.deepEqual(refreshed, [['stylist-1', 5]]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/calendar-sync-service.test.ts src/app/actions/booking-concurrency.test.ts`
Expected: FAIL — `refreshStylistCalendarFeeds` is not exported; admin still calls the removed mock name.

- [ ] **Step 3: Implement in `calendar-sync-service.ts`**

Add `stylistId?: string;` to `CalendarSyncDependencies` (with the comment `/** Only this stylist's connections. */`), add `...(deps.stylistId ? { stylistId: deps.stylistId } : {}),` to the `findMany` `where` next to `connectionId`, and replace `refreshStaleCalendarFeeds` (whole function and its doc comment) with:

```ts
/** How old a feed may be before a staff approval re-imports it first. */
export const APPROVAL_REFRESH_MINUTES = 5;

/**
 * Re-import one stylist's marketplace feeds before staff confirm a booking or a
 * reschedule into that stylist's diary. The scheduled import runs every 30
 * minutes and pauses outside staff hours, so without this a Fresha sale made
 * since the last tick would not be seen. Feeds refreshed within
 * `maxAgeMinutes` are skipped. The admin's own request already wakes Neon, so
 * this adds no separate wake. Respects the CALENDAR_SYNC_ENABLED kill-switch
 * and never throws: a failed import is reported by the readiness check that
 * follows.
 */
export async function refreshStylistCalendarFeeds(
  stylistId: string,
  opts: Omit<CalendarSyncDependencies, 'staleBefore' | 'stylistId'> & { maxAgeMinutes?: number } = {},
): Promise<CalendarSyncResult[]> {
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') return [];
  const { maxAgeMinutes = APPROVAL_REFRESH_MINUTES, ...deps } = opts;
  const now = deps.now ?? new Date();
  try {
    return await syncCalendarFeeds({ ...deps, stylistId, staleBefore: new Date(now.getTime() - maxAgeMinutes * 60_000) });
  } catch {
    return [];
  }
}
```

Remove the now-unused `CALENDAR_POLL_MINUTES` import if nothing else in the file uses it (check with `grep -n CALENDAR_POLL_MINUTES src/app/services/calendar-sync-service.ts`).

- [ ] **Step 4: Use it in `updateAppointmentStatus`**

In `src/app/actions/admin.ts` change the import line 17 to:

```ts
import { APPROVAL_REFRESH_MINUTES, refreshStylistCalendarFeeds } from '@/app/services/calendar-sync-service';
```

and replace `if (status === 'CONFIRMED') await refreshStaleCalendarFeeds();` with:

```ts
    if (status === 'CONFIRMED') {
      const target = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { stylistId: true } });
      if (target) await refreshStylistCalendarFeeds(target.stylistId, { maxAgeMinutes: APPROVAL_REFRESH_MINUTES });
    }
```

Update the comment above it to say "this stylist's feeds older than five minutes".

- [ ] **Step 5: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/services/calendar-sync-service.test.ts src/app/actions/booking-concurrency.test.ts`
Expected: all pass (the existing "refresh runs BEFORE readiness" test still yields `['refresh', 'readiness']`).

- [ ] **Step 6: Commit**

```bash
git add src/app/services/calendar-sync-service.ts src/app/services/calendar-sync-service.test.ts src/app/actions/admin.ts src/app/actions/booking-concurrency.test.ts
git commit -m "feat(calendar): refresh the stylist's feeds older than 5 min before any approval"
```

---

### Task 6: Customer actions — request, replace, withdraw; cancel clears

**Files:**
- Modify: `src/app/actions/booking.ts` (replace `rescheduleAppointment` at ~527-658; edit `cancelAppointment` ~444-500)
- Test: `src/app/actions/booking-concurrency.test.ts`

**Interfaces:**
- Consumes: `RESCHEDULE_REQUEST_LEAD_HOURS`, `isRescheduleRequestExpired` (Task 2); request email kinds + `requestedAt` option (Tasks 3–4).
- Produces:
  - `requestReschedule(appointmentId: string, dateStr: string, time: string): Promise<{ success: true } | { success: false; code?: BookingErrorCode; error: string }>`
  - `withdrawRescheduleRequest(appointmentId: string): Promise<{ success: true } | { success: false; code?: BookingErrorCode; error: string }>`
- Removes: `rescheduleAppointment` (the customer direct move).

- [ ] **Step 1: Extend the test fixture** (in `booking-concurrency.test.ts`)

1. Add options to the `fixture(options: {...})` type:

```ts
  /** Weekdays (0 = Sunday) on which the stylist does not work. */
  offDays?: number[];
  /** A COMPLETED patch test at this instant; colour services require one. */
  patchTestDate?: Date;
  requiresPatchTest?: boolean;
  /** An already-open reschedule request on the fixture appointment. */
  openRequest?: { requestedDate: Date; requestedAt: Date };
  /** The session's role (default ADMIN, as today). */
  role?: 'ADMIN' | 'USER';
```

Also widen `changeAfterRead?: 'cancel' | 'reschedule' | 'confirm'` to `… | 'confirm' | 'request'`, and inside `findUnique`'s `if (reads++ === 0 && options.changeAfterRead)` block add:

```ts
          if (options.changeAfterRead === 'request') {
            // Another tab committed a request for 10:00 BST on 15 Sep after this read.
            appointment.rescheduleRequestedDate = new Date('2099-09-15T09:00:00Z');
            appointment.rescheduleRequestedAt = new Date('2099-09-01T11:30:00Z');
          }
```

and change the `externallyCommitted` assignment to also carry the request fields:

```ts
          externallyCommitted = { status: appointment.status, date: appointment.date, updatedAt: appointment.updatedAt, rescheduleRequestedDate: appointment.rescheduleRequestedDate, rescheduleRequestedAt: appointment.rescheduleRequestedAt };
```

Change the session mock to `verifySession: async () => ({ userId: 'user-1', role: options.role ?? 'ADMIN' })`.

2. In the `appointment` object add after `notificationVersion: 0,`:

```ts
    rescheduleRequestedDate: (options.openRequest?.requestedDate ?? null) as Date | null,
    rescheduleRequestedAt: (options.openRequest?.requestedAt ?? null) as Date | null,
```

and change `requiresPatchTest: false` in `service` to `requiresPatchTest: options.requiresPatchTest ?? false`.

3. Replace `tx.appointment.findMany` with a version that answers the patch-test query:

```ts
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        if ((where.service as { isPatchTest?: boolean } | undefined)?.isPatchTest) {
          return options.patchTestDate ? [{ date: options.patchTestDate, status: 'COMPLETED' }] : [];
        }
        return [appointment, ...(options.conflictingBooking ? [{
          id: 'other', stylistId: 'stylist-1', status: 'CONFIRMED', date: new Date('2099-09-15T09:45:00Z'), durationAtBooking: 60,
          service: { duration: 30 },
        }] : [])].filter((row) => matches(row, where));
      },
```

4. Replace `availability.findFirst` with one that honours the weekday:

```ts
    availability: { findFirst: async ({ where }: { where: { dayOfWeek: number } }) =>
      options.offDays?.includes(where.dayOfWeek) ? null : ({ startTime: '09:00', endTime: options.hoursEnd ?? '18:00', isOff: false }) },
```

5. In `matches`, treat `null` expectations explicitly — insert as the first line of the callback:

```ts
    if (expected === null) return actual === null || actual === undefined;
```

6. After the `fixture` function add:

```ts
/** The old one-step move, now a customer request followed by staff approval. */
async function requestThenApprove(f: ReturnType<typeof fixture>, dateStr: string, time: string) {
  const requested = await f.actions.requestReschedule(f.appointment.id, dateStr, time);
  if (!requested.success || !f.appointment.rescheduleRequestedAt) return requested;
  return f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', f.appointment.rescheduleRequestedAt.toISOString());
}
```

(`decideRescheduleRequest` arrives in Task 7; until then tests using this helper fail — that is expected and they are written in Task 7.)

- [ ] **Step 2: Migrate the existing customer-reschedule tests to `requestReschedule`**

Make exactly these edits (dates unchanged — Date is mocked to 2099-09-01T12:00Z; the original booking is 2099-09-14T12:00Z = 13:00 BST):

| Test (current title) | Change |
|---|---|
| `${operation} updates the busy feed before waiting for email delivery` loop | change the operation list to `['cancel', 'approve', 'decline'] as const` and delete the `'reschedule'` branch (requests do not touch the busy feed; approval-of-a-request is covered in Task 7). |
| `rescheduling a frozen 60-minute booking cannot overlap a booking 45 minutes later` | call `requestReschedule`; also assert `f.appointment.rescheduleRequestedAt === null`. |
| `rescheduling to the time a booking already has sends nothing, however often` | rename to `requesting the time a booking already has sends nothing, however often`; call `requestReschedule`. |
| `a spent ${spent} reschedule allowance refuses the move before any transaction` | call `requestReschedule`. |
| `a time the salon refuses spends no reschedule allowance` | call `requestReschedule`. |
| `another customer's booking cannot spend its reschedule allowance` | call `requestReschedule`. |
| `rescheduling must fit the entire frozen duration before closing` | call `requestReschedule`. |
| `rescheduling rejects a concurrent ${changeAfterRead} …` | call `requestReschedule`; assert `messages.length === 0` and `appointment.rescheduleRequestedAt === null`. |
| `a successful reschedule retains frozen price/duration and increments the event version once` | becomes a Task 7 test — delete here. |
| `legacy bookings without a frozen duration still use the service duration` | call `requestReschedule`. |
| `rescheduling cannot overlap an imported external booking` | call `requestReschedule`. |
| `a confirmed booking ${label} away … can be cancelled or rescheduled` | call `requestReschedule` for the `move` half. |
| `confirmed appointments retain the 24-hour change restriction …` | call `requestReschedule`. |
| `a failed notification enqueue rolls back ${operation} …` | rename operation `'reschedule'` → `'request'`, call `requestReschedule`, additionally assert `f.appointment.rescheduleRequestedAt === null`. |
| `rescheduling rechecks readiness in the transaction …` | call `requestReschedule`; assert `rescheduleRequestedAt === null`. |
| `a reschedule persists its old date and frozen details …` | becomes a Task 7 test — delete here. |

Outside that file:

| File | Change |
|---|---|
| `src/app/services/booking-closed-hours.test.ts:165,175` | `actions.rescheduleAppointment(` → `actions.requestReschedule(`; retitle the two tests `requesting a reschedule outside working hours is refused` / `requesting a reschedule onto a closed day is refused`. Assertions unchanged. |
| `src/app/services/site-settings-defaults.test.ts:53` | message text `rescheduleAppointment` → `requestReschedule` (the guard count stays 5: `requestReschedule` keeps the `isBookingEnabled` guard; `withdrawRescheduleRequest` deliberately has none). |
| `src/app/services/booking-maintenance-copy.test.ts:19` | comment `submitBooking/rescheduleAppointment` → `submitBooking/requestReschedule`. |
| `src/app/lib/booking-maintenance.ts:26,34` | comments `rescheduleAppointment` → `requestReschedule`. |

- [ ] **Step 3: Write the new failing tests**

```ts
test('a request leaves the booking confirmed at its original time and emails the customer and the salon', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00'), { success: true });
  assert.equal(f.appointment.status, 'CONFIRMED');
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedDate?.toISOString(), '2099-09-15T09:00:00.000Z');
  assert.ok(f.appointment.rescheduleRequestedAt);
  assert.equal(f.appointment.notificationVersion, 0, 'a request never bumps the event version');
  assert.equal(f.appointment.reminderSent, true, 'the reminder for the original time stays valid');
  assert.deepEqual(f.events.map((event) => event.kind).sort(), ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT']);
  assert.equal(f.dispatches(), 1);
});

test('a requested time less than 24 hours away is refused before any transaction', async () => {
  const f = fixture();
  // Mocked now is 2099-09-01T12:00Z; 13:00 BST on 2 Sep is 12:00Z — exactly 24 h, allowed; 12:59 BST is not.
  const tooSoon = await f.actions.requestReschedule(f.appointment.id, '2099-09-02', '12:59');
  assert.equal('code' in tooSoon && tooSoon.code, 'RESCHEDULE_REQUEST_TOO_SOON');
  assert.equal(f.transactions(), 0);
  assert.deepEqual(f.limiterKeys, []);
});

test('a requested time on the stylist\'s day off is refused', async () => {
  const f = fixture({ offDays: [3] });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-16', '10:00'); // Wednesday
  assert.equal('code' in result && result.code, 'STYLIST_OFF_THAT_DAY');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
});

test('a colour booking cannot be requested into the 48 hours after its patch test', async () => {
  const f = fixture({ requiresPatchTest: true, patchTestDate: new Date('2099-09-14T12:00:00Z') });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'PATCH_TEST_TOO_SOON');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
});

test('asking again for the time already requested sends nothing', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00'), { success: true });
  assert.equal(f.transactions(), 0);
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.limiterKeys, []);
});

test('a new time replaces the open request with fresh emails', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-08-31T11:00:00Z') } });
  assert.equal((await f.actions.requestReschedule(f.appointment.id, '2099-09-16', '10:00')).success, true);
  assert.equal(f.appointment.rescheduleRequestedDate?.toISOString(), '2099-09-16T09:00:00.000Z');
  assert.notEqual(f.appointment.rescheduleRequestedAt?.toISOString(), '2099-08-31T11:00:00.000Z');
  assert.equal(f.events.length, 2);
  assert.ok(f.events.every((event) => event.eventKey.endsWith(f.appointment.rescheduleRequestedAt!.toISOString())));
});

test('an expired request that the cron has not cleared yet can be replaced', async () => {
  // Requested time 2099-09-02T09:00Z is under 24 h from the mocked now.
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-02T09:00:00Z'), requestedAt: new Date('2099-08-30T11:00:00Z') } });
  assert.equal((await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00')).success, true);
  assert.equal(f.appointment.rescheduleRequestedDate?.toISOString(), '2099-09-15T09:00:00.000Z');
});

test('a double-submitted request that lost the race is refused and sends nothing', async () => {
  // The other submission commits between this one's read and its transaction.
  const f = fixture({ changeAfterRead: 'request' });
  const result = await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00');
  assert.equal('code' in result && result.code, 'RESCHEDULE_REQUEST_CHANGED');
  assert.equal(f.events.length, 0, 'never a second pair of emails');
  assert.equal(f.appointment.rescheduleRequestedAt?.toISOString(), '2099-09-01T11:30:00.000Z', 'the winner is kept');
});

test('a double-submit after the first committed is a silent no-op', async () => {
  const f = fixture();
  assert.equal((await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00')).success, true);
  assert.deepEqual(await f.actions.requestReschedule(f.appointment.id, '2099-09-15', '10:00'), { success: true });
  assert.equal(f.events.length, 2, 'one pair of emails in total');
});

test('withdrawing clears the request without email, even while online booking is closed', async () => {
  const f = fixture({ onlineReady: false, openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  assert.deepEqual(await f.actions.withdrawRescheduleRequest(f.appointment.id), { success: true });
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  assert.equal(f.appointment.rescheduleRequestedDate, null);
  assert.equal(f.events.length, 0);
});

test('only the booking\'s owner can withdraw its request', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  f.appointment.userId = 'someone-else';
  const result = await f.actions.withdrawRescheduleRequest(f.appointment.id);
  assert.equal('code' in result && result.code, 'APPOINTMENT_NOT_FOUND');
  assert.ok(f.appointment.rescheduleRequestedAt);
});

test('cancelling a booking also clears its open request', async () => {
  const f = fixture({ openRequest: { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') } });
  assert.equal((await f.actions.cancelAppointment(f.appointment.id)).success, true);
  assert.equal(f.appointment.status, 'CANCELLED');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
});
```

The race test is deterministic: the stale read has `rescheduleRequestedAt: null`, the fixture commits the other request right after that read, and the transaction's guard (`rescheduleRequestedAt: null`) no longer matches → `RESCHEDULE_REQUEST_CHANGED`. Do not use `Promise.all` against this fixture: its transaction flag and staged events are shared, so concurrent fake transactions corrupt each other. The genuine concurrent race runs on real PostgreSQL in Task 11.

- [ ] **Step 4: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/actions/booking-concurrency.test.ts`
Expected: FAIL — `requestReschedule is not a function` (and `withdrawRescheduleRequest`).

- [ ] **Step 5: Implement in `booking.ts`**

1. Add imports:

```ts
import { appendAuditEvent } from '@/app/lib/audit';
import { isRescheduleRequestExpired } from '@/app/lib/reschedule-request';
```

2. Delete the whole `rescheduleAppointment` function and add in its place:

```ts
const requestInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true } },
  service: true,
} as const;

/**
 * A customer asks to move a CONFIRMED booking. Nothing moves: the original time
 * stays booked until staff approve (admin.ts decideRescheduleRequest), and the
 * requested time is checked now but not held. One open request per booking; a
 * new time replaces it.
 */
export async function requestReschedule(appointmentId: string, dateStr: string, time: string) {
  const locale = await getActionLocale();
  // A request books nothing yet, but it is still online booking: closed with it.
  if (!(await isBookingEnabled())) return failure(locale, 'MAINTENANCE');

  const session = await verifySession();
  if (!isValidSalonDate(dateStr) || !isValidSalonTime(time)) return failure(locale, 'INVALID_DATE_TIME');

  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: requestInclude });
  if (!appointment || appointment.userId !== session.userId) return failure(locale, 'APPOINTMENT_NOT_FOUND');
  if (appointment.status !== 'CONFIRMED') return failure(locale, 'RESCHEDULE_ONLY_CONFIRMED');
  if ((appointment.date.getTime() - Date.now()) / 3_600_000 < 24) return failure(locale, 'RESCHEDULE_TOO_LATE');

  const salon = resolveSalonDateTime(dateStr, time);
  const newDate = salon.utc;
  if (Number.isNaN(newDate.getTime())) return failure(locale, 'INVALID_DATE_TIME');
  if (newDate <= new Date()) return failure(locale, 'RESCHEDULE_PAST');
  // It would lapse at once: staff could never approve it.
  if (isRescheduleRequestExpired(newDate)) return failure(locale, 'RESCHEDULE_REQUEST_TOO_SOON');

  // Asking for the time it already has, or the time already asked for, changes
  // nothing and sends nothing (each real request emails the customer and the salon).
  if (newDate.getTime() === appointment.date.getTime() || newDate.getTime() === appointment.rescheduleRequestedDate?.getTime()) {
    return { success: true as const };
  }

  const duration = appointment.durationAtBooking ?? appointment.service.duration;
  const hoursCheck = await checkStylistHours(appointment.stylistId, salon, duration);
  if (!hoursCheck.ok) return failure(locale, hoursCheck.code);

  if (appointment.service.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, newDate);
    if (!eligibility.ok) {
      return failure(locale,
        eligibility.reason === 'too_soon' ? 'PATCH_TEST_TOO_SOON'
          : eligibility.reason === 'expired' ? 'PATCH_TEST_EXPIRED' : 'PATCH_TEST_REQUIRED');
    }
  }

  // Each request emails the customer and the salon, so requests are limited.
  // Checked after every refusal above, so refused times spend no allowance.
  if (!(await rescheduleLimiter.check(`user:${session.userId}`)) ||
      !(await appointmentRescheduleLimiter.check(`appt:${appointmentId}`))) {
    return failure(locale, 'TOO_MANY_RESCHEDULES');
  }

  try {
    const requestedAt = new Date();
    await runSerializableWithRetry(async (tx) => {
      await assertOnlineBookingReady(tx);
      // Refuse a time that is already taken; it is not held after this.
      await assertAppointmentSlotAvailable(tx, appointment, newDate);
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: 'CONFIRMED', date: appointment.date, updatedAt: appointment.updatedAt, rescheduleRequestedAt: appointment.rescheduleRequestedAt },
        data: { rescheduleRequestedDate: newDate, rescheduleRequestedAt: requestedAt },
      });
      if (changed.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      await enqueueAppointmentNotification(tx, 'RESCHEDULE_REQUEST_RECEIVED', appointment, { requestedDate: newDate, requestedAt });
      await enqueueAppointmentNotification(tx, 'SALON_RESCHEDULE_ALERT', appointment, { requestedDate: newDate, requestedAt });
      await appendAuditEvent({
        actorUserId: session.userId,
        action: appointment.rescheduleRequestedAt ? 'APPOINTMENT.RESCHEDULE_REPLACED' : 'APPOINTMENT.RESCHEDULE_REQUESTED',
        targetType: 'Appointment', targetId: appointmentId,
        metadata: { from: appointment.date.toISOString(), to: newDate.toISOString() },
      }, tx);
    });
    after(() => dispatchAppointmentNotifications(appointmentId));
    revalidateAllLocales(revalidatePath, '/appointments');
    revalidateAllLocales(revalidatePath, '/admin');
    return { success: true as const };
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Reschedule request failed:', error);
    return { success: false as const, code: error instanceof BookingError ? error.code : undefined, error: describeBookingError(error, locale, 'RESCHEDULE_FAILED') };
  }
}

/** The customer takes back an open request. No email; allowed while booking is closed. */
export async function withdrawRescheduleRequest(appointmentId: string) {
  const locale = await getActionLocale();
  const session = await verifySession();
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, userId: true, status: true, date: true, rescheduleRequestedAt: true },
  });
  if (!appointment || appointment.userId !== session.userId) return failure(locale, 'APPOINTMENT_NOT_FOUND');
  if (!appointment.rescheduleRequestedAt) return failure(locale, 'RESCHEDULE_REQUEST_CHANGED');
  try {
    await runSerializableWithRetry(async (tx) => {
      const changed = await tx.appointment.updateMany({
        where: { id: appointmentId, userId: session.userId, status: appointment.status, date: appointment.date, rescheduleRequestedAt: appointment.rescheduleRequestedAt },
        data: { rescheduleRequestedDate: null, rescheduleRequestedAt: null },
      });
      if (changed.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      await appendAuditEvent({ actorUserId: session.userId, action: 'APPOINTMENT.RESCHEDULE_WITHDRAWN', targetType: 'Appointment', targetId: appointmentId }, tx);
    });
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Withdrawing a reschedule request failed:', error);
    return { success: false as const, code: error instanceof BookingError ? error.code : undefined, error: describeBookingError(error, locale, 'RESCHEDULE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/admin');
  return { success: true as const };
}
```

3. In `cancelAppointment`, change the `updateMany` `data` to also clear the request:

```ts
        data: { status: 'CANCELLED', rescheduleRequestedDate: null, rescheduleRequestedAt: null, treatwellSyncStatus, treatwellSyncError: null, notificationVersion: { increment: 1 } },
```

4. Remove the now-unused `changedTreatwellSyncStatus`/`getTreatwellApiConfiguration` imports **only if** `grep -n "changedTreatwellSyncStatus\|getTreatwellApiConfiguration" src/app/actions/booking.ts` shows no remaining use (cancel still uses them — expect them to stay).

- [ ] **Step 6: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/actions/booking-concurrency.test.ts src/app/actions/use-server-exports.test.ts src/app/services/booking-closed-hours.test.ts src/app/services/site-settings-defaults.test.ts src/app/services/booking-maintenance-copy.test.ts`
Expected: every test added or migrated in this task passes. Tests calling `requestThenApprove`/`decideRescheduleRequest` do not exist yet.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/booking.ts src/app/actions/booking-concurrency.test.ts src/app/services/booking-closed-hours.test.ts src/app/services/site-settings-defaults.test.ts src/app/services/booking-maintenance-copy.test.ts src/app/lib/booking-maintenance.ts
git commit -m "feat(booking): customers request a reschedule instead of moving a confirmed booking"
```

---

### Task 7: Staff decision — approve or decline; staff writes clear requests

**Files:**
- Modify: `src/app/actions/admin.ts` (add `decideRescheduleRequest` after `updateAppointmentStatus`; edit `updateAppointmentStatus` data)
- Modify: `src/app/actions/admin-schedule.ts:197-221` (`editAppointmentByAdmin` data)
- Test: `src/app/actions/booking-concurrency.test.ts`, `src/app/actions/admin-schedule.test.ts`

**Interfaces:**
- Consumes: `refreshStylistCalendarFeeds`, `APPROVAL_REFRESH_MINUTES` (Task 5); `isRescheduleRequestExpired` (Task 2); request email kinds (Tasks 3–4).
- Produces: `decideRescheduleRequest(appointmentId: string, decision: 'APPROVE' | 'DECLINE', requestedAt: string): Promise<{ success: true } | { success: false; error: string }>`.

- [ ] **Step 1: Write the failing tests** (in `booking-concurrency.test.ts`)

```ts
const OPEN_REQUEST = { requestedDate: new Date('2099-09-15T09:00:00Z'), requestedAt: new Date('2099-09-01T11:00:00Z') };

test('approval moves the booking to the requested time, keeps frozen price/duration and bumps the version once', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST });
  assert.deepEqual(await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString()), { success: true });
  assert.equal(f.appointment.date.toISOString(), '2099-09-15T09:00:00.000Z');
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  assert.equal(f.appointment.rescheduleRequestedDate, null);
  assert.equal(f.appointment.reminderSent, false);
  assert.equal(f.appointment.notificationVersion, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].eventKey, 'appointment/appointment-1/1/RESCHEDULE');
  const payload = JSON.parse(f.events[0].payloadJson);
  assert.equal(payload.options.oldDate, '2099-09-14T12:00:00.000Z');
  assert.equal(payload.appointment.price.amountPence, 8000);
  assert.equal(payload.appointment.service.duration, 60);
});

test('approval refreshes the stylist\'s Fresha feeds before the readiness check', async () => {
  const trace: string[] = [];
  const f = fixture({ openRequest: OPEN_REQUEST, trace });
  assert.equal((await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString())).success, true);
  assert.deepEqual(trace, ['refresh', 'readiness']);
});

test('approve updates the busy feed before waiting for email delivery', async () => {
  await assertFeedInvalidatesBeforeDelivery((hooks) => {
    const f = fixture({ ...hooks, openRequest: OPEN_REQUEST });
    return f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  });
});

test('a requested slot taken since the request keeps the request open and tells staff', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, conflictingBooking: true });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /no longer free/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.ok(f.appointment.rescheduleRequestedAt, 'staff can still decline it');
  assert.equal(f.events.length, 0);
});

test('hours edited after the request make approval fail with OUTSIDE_HOURS and leave the request open', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, hoursEnd: '09:30' });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.ok(f.appointment.rescheduleRequestedAt);
});

test('a decision on a request that has since changed is refused', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', '2099-09-01T10:00:00.000Z');
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /changed/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
});

test('an expired request cannot be approved', async () => {
  const expired = { requestedDate: new Date('2099-09-02T09:00:00Z'), requestedAt: new Date('2099-08-30T11:00:00Z') };
  const f = fixture({ openRequest: expired });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', expired.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.match(String(!result.success && result.error), /expired/);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
});

test('decline keeps the original time, clears the request and emails the customer', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST });
  assert.deepEqual(await f.admin.decideRescheduleRequest(f.appointment.id, 'DECLINE', OPEN_REQUEST.requestedAt.toISOString()), { success: true });
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
  assert.equal(f.appointment.rescheduleRequestedAt, null);
  assert.equal(f.appointment.notificationVersion, 0);
  assert.deepEqual(f.events.map((event) => event.kind), ['RESCHEDULE_DECLINED']);
});

test('only admins can decide a reschedule request', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, role: 'USER' });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.ok(f.appointment.rescheduleRequestedAt);
  assert.equal(f.transactions(), 0);
});

for (const status of ['CANCELLED', 'COMPLETED'] as const) {
  test(`staff marking a booking ${status} also clears its open request`, async () => {
    const f = fixture({ openRequest: OPEN_REQUEST });
    assert.equal((await f.admin.updateAppointmentStatus(f.appointment.id, status)).success, true);
    assert.equal(f.appointment.rescheduleRequestedAt, null);
    assert.equal(f.events.some((event) => event.kind === 'RESCHEDULE_DECLINED' || event.kind === 'RESCHEDULE_LAPSED'), false);
  });
}

test('the colour patch-test rule is re-checked against the requested date on approval', async () => {
  const f = fixture({ openRequest: OPEN_REQUEST, requiresPatchTest: true, patchTestDate: new Date('2099-09-14T12:00:00Z') });
  const result = await f.admin.decideRescheduleRequest(f.appointment.id, 'APPROVE', OPEN_REQUEST.requestedAt.toISOString());
  assert.equal(result.success, false);
  assert.equal(f.appointment.date.getTime(), f.originalDate.getTime());
});
```

In `src/app/actions/admin-schedule.test.ts`: add `openRequest?: boolean;` to the `fixture(options: {...})` type, and to its `appointment` object add

```ts
    rescheduleRequestedDate: (options.openRequest ? new Date('2099-09-20T09:00:00Z') : null) as Date | null,
    rescheduleRequestedAt: (options.openRequest ? new Date('2099-09-01T11:00:00Z') : null) as Date | null,
```

then add (the file's `move()` helper defaults to 11:00 BST on 15 Sep; `ORIGINAL_START` is 10:00 BST that day):

```ts
test('a direct staff move clears any open customer reschedule request', async () => {
  const { actions, appointment } = fixture({ openRequest: true });
  assert.deepEqual(await actions.moveAppointmentByAdmin(move()), { success: true });
  assert.equal(appointment.rescheduleRequestedAt, null);
  assert.equal(appointment.rescheduleRequestedDate, null);
});

test('changing only the duration keeps an open customer request', async () => {
  const { actions, appointment } = fixture({ openRequest: true });
  assert.deepEqual(await actions.moveAppointmentByAdmin(move({ time: '10:00', durationMin: 90 })), { success: true });
  assert.ok(appointment.rescheduleRequestedAt);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/actions/booking-concurrency.test.ts src/app/actions/admin-schedule.test.ts`
Expected: FAIL — `decideRescheduleRequest is not a function`; status/edit tests show the request still set.

- [ ] **Step 3: Implement `decideRescheduleRequest` in `admin.ts`**

Add imports:

```ts
import { assertAppointmentSlotAvailable, getValidPatchTest, runSerializableWithRetry } from '@/app/services/booking-service';
import { isRescheduleRequestExpired } from '@/app/lib/reschedule-request';
```

(replacing the existing `booking-service` import line), then after `updateAppointmentStatus` add:

```ts
/**
 * Staff answer a customer's reschedule request (booking.ts requestReschedule).
 * APPROVE re-imports this stylist's Fresha feeds, then re-checks the requested
 * time exactly as a new booking's approval does before moving the booking.
 * DECLINE leaves the booking untouched. Not gated by the online-booking lock.
 */
export async function decideRescheduleRequest(appointmentId: string, decision: 'APPROVE' | 'DECLINE', requestedAt: string) {
  const locale = await getActionLocale();
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { success: false as const, error: bookingErrorText(locale, 'NOT_AUTHORISED') };
  if (decision !== 'APPROVE' && decision !== 'DECLINE') {
    return { success: false as const, error: translator(locale, 'adminSchedule')('errors.INVALID_STATUS') };
  }
  const expected = new Date(requestedAt);
  if (Number.isNaN(expected.getTime())) return { success: false as const, error: bookingErrorText(locale, 'RESCHEDULE_REQUEST_CHANGED') };
  const include = {
    user: { select: { email: true, name: true, phone: true } },
    stylist: { select: { name: true, treatwellExternalId: true } },
    service: { select: { id: true, name: true, price: true, duration: true, treatwellExternalId: true, requiresPatchTest: true } },
  } as const;
  try {
    if (decision === 'APPROVE') {
      // Network I/O stays outside the serializable transaction below.
      const target = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { stylistId: true } });
      if (target) await refreshStylistCalendarFeeds(target.stylistId, { maxAgeMinutes: APPROVAL_REFRESH_MINUTES });
    }
    const moved = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!current) throw new BookingError('APPOINTMENT_NOT_FOUND');
      const requested = current.rescheduleRequestedDate;
      if (current.status !== 'CONFIRMED' || !requested || current.rescheduleRequestedAt?.getTime() !== expected.getTime()) {
        throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      }
      const guard = { id: appointmentId, status: 'CONFIRMED', date: current.date, rescheduleRequestedAt: current.rescheduleRequestedAt };
      const audit = (action: string) => appendAuditEvent({
        actorUserId: session.userId, action, targetType: 'Appointment', targetId: appointmentId,
        metadata: { from: current.date.toISOString(), to: requested.toISOString() },
      }, tx);

      if (decision === 'DECLINE') {
        const cleared = await tx.appointment.updateMany({ where: guard, data: { rescheduleRequestedDate: null, rescheduleRequestedAt: null } });
        if (cleared.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
        await enqueueAppointmentNotification(tx, 'RESCHEDULE_DECLINED', current, { requestedDate: requested, requestedAt: expected });
        await audit('APPOINTMENT.RESCHEDULE_DECLINED');
        return false;
      }

      if (isRescheduleRequestExpired(requested)) throw new BookingError('RESCHEDULE_REQUEST_EXPIRED');
      const readiness = await checkCalendarBookingReadiness(tx);
      if (!readiness.ready) throw new BookingError('CALENDAR_SETUP_NEEDED');
      if (current.service.requiresPatchTest) {
        const eligibility = await getValidPatchTest(current.userId, requested);
        if (!eligibility.ok) {
          throw new BookingError(eligibility.reason === 'too_soon' ? 'PATCH_TEST_TOO_SOON'
            : eligibility.reason === 'expired' ? 'PATCH_TEST_EXPIRED' : 'PATCH_TEST_REQUIRED');
        }
      }
      try {
        await assertAppointmentSlotAvailable(tx, current, requested);
      } catch (error) {
        if (error instanceof BookingError && error.code === 'SLOT_UNAVAILABLE') throw new BookingError('RESCHEDULE_SLOT_TAKEN');
        throw error;
      }
      const api = getTreatwellApiConfiguration();
      const treatwellSyncStatus = changedTreatwellSyncStatus({
        apiReady: api.enabled && api.configured,
        treatwellBookingId: current.treatwellBookingId,
        stylistExternalId: current.stylist.treatwellExternalId,
        serviceExternalId: current.service.treatwellExternalId,
      });
      const changed = await tx.appointment.updateMany({
        where: guard,
        data: {
          date: requested, rescheduleRequestedDate: null, rescheduleRequestedAt: null, reminderSent: false,
          treatwellSyncStatus, treatwellSyncError: null, notificationVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new BookingError('RESCHEDULE_REQUEST_CHANGED');
      const updated = await tx.appointment.findUnique({ where: { id: appointmentId }, include });
      if (!updated) throw new BookingError('APPOINTMENT_NOT_FOUND');
      await enqueueAppointmentNotification(tx, 'RESCHEDULE', updated, { oldDate: current.date });
      await audit('APPOINTMENT.RESCHEDULE_APPROVED');
      return true;
    });
    // Finish the action's cache invalidation before external email delivery.
    if (moved) invalidateStylistIcalFeed();
    after(() => dispatchAppointmentNotifications(appointmentId));
  } catch (error) {
    if (!(error instanceof BookingError)) console.error('Reschedule decision failed:', error);
    return { success: false as const, error: describeBookingError(error, locale, 'ADMIN_UPDATE_FAILED') };
  }
  revalidateAllLocales(revalidatePath, '/admin');
  revalidateAllLocales(revalidatePath, '/appointments');
  revalidateAllLocales(revalidatePath, '/book');
  return { success: true as const };
}
```

- [ ] **Step 4: Staff status changes clear requests**

In `updateAppointmentStatus`, change the `data` initialiser to:

```ts
      const data: Prisma.AppointmentUpdateManyMutationInput = {
        status,
        // A cancelled or completed booking has nothing left to move.
        ...(status !== 'CONFIRMED' ? { rescheduleRequestedDate: null, rescheduleRequestedAt: null } : {}),
        notificationVersion: { increment: 1 },
      };
```

- [ ] **Step 5: Direct staff moves clear requests**

In `admin-schedule.ts` `editAppointmentByAdmin`, in the `updateMany` `data` (after the `reminderSent` line), add:

```ts
          // Staff have moved it themselves: a customer's pending request is moot.
          ...((startMoved || stylistChanged) ? { rescheduleRequestedDate: null, rescheduleRequestedAt: null } : {}),
```

- [ ] **Step 6: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/actions/booking-concurrency.test.ts src/app/actions/admin-schedule.test.ts src/app/actions/use-server-exports.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/admin.ts src/app/actions/admin-schedule.ts src/app/actions/booking-concurrency.test.ts src/app/actions/admin-schedule.test.ts
git commit -m "feat(admin): approve or decline reschedule requests; staff writes clear them"
```

---

### Task 8: Automatic lapse in the notifications cron

**Files:**
- Create: `src/app/services/reschedule-request-lapse.ts`
- Test: `src/app/services/reschedule-request-lapse.test.ts`
- Modify: `src/app/services/notification-cron-service.ts`, `src/app/services/notification-cron-service.test.ts`

**Interfaces:**
- Consumes: `RESCHEDULE_REQUEST_LEAD_HOURS` (Task 2); `RESCHEDULE_LAPSED` + `requestedAt` option (Tasks 3–4).
- Produces: `lapseExpiredRescheduleRequests(now: Date, limit?: number): Promise<number>` (number lapsed).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/services/reschedule-request-lapse.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2099-09-01T12:00:00Z');

function fixture(rows: { id: string; requestedDate: Date | null; requestedAt: Date | null; status?: string }[]) {
  const appointments = rows.map((row) => ({
    id: row.id, status: row.status ?? 'CONFIRMED', date: new Date('2099-09-14T12:00:00Z'), notificationVersion: 0,
    rescheduleRequestedDate: row.requestedDate, rescheduleRequestedAt: row.requestedAt,
    priceAtBooking: null, durationAtBooking: 60, notes: null,
    user: { email: `${row.id}@example.test`, name: 'Amy', phone: null }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 },
  }));
  const enqueued: { id: string; kind: string; requestedAt: string }[] = [];
  const audits: string[] = [];
  const tx = {
    appointment: {
      findMany: async ({ where }: { where: { status: string; rescheduleRequestedDate: { lt: Date } } }) =>
        appointments.filter((row) => row.status === where.status && row.rescheduleRequestedDate && row.rescheduleRequestedDate < where.rescheduleRequestedDate.lt).map((row) => ({ id: row.id })),
      findUnique: async ({ where }: { where: { id: string } }) => structuredClone(appointments.find((row) => row.id === where.id) ?? null),
      updateMany: async ({ where, data }: { where: { id: string; rescheduleRequestedAt: Date }; data: Record<string, unknown> }) => {
        const row = appointments.find((item) => item.id === where.id);
        if (!row || row.rescheduleRequestedAt?.getTime() !== where.rescheduleRequestedAt.getTime()) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }: { data: { action: string } }) => { audits.push(data.action); return { id: 'a' }; } },
  };
  let transactions = 0;
  const service = loadServerModule<typeof import('./reschedule-request-lapse')>('src/app/services/reschedule-request-lapse.ts', {
    '@/app/lib/prisma': tx,
    './booking-service': { runSerializableWithRetry: async (fn: (client: unknown) => unknown) => { transactions++; return fn(tx); } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, appointment: { id: string }, options: { requestedAt: Date }) => {
        enqueued.push({ id: appointment.id, kind, requestedAt: options.requestedAt.toISOString() }); return { id: 'e' };
      },
    },
  });
  return { service, appointments, enqueued, audits, transactions: () => transactions };
}

test('only requests whose time is under 24 hours away lapse, once, with one email each', async () => {
  const f = fixture([
    { id: 'soon', requestedDate: new Date('2099-09-02T11:00:00Z'), requestedAt: new Date('2099-08-30T10:00:00Z') },
    { id: 'later', requestedDate: new Date('2099-09-10T09:00:00Z'), requestedAt: new Date('2099-08-31T10:00:00Z') },
    { id: 'none', requestedDate: null, requestedAt: null },
  ]);
  assert.equal(await f.service.lapseExpiredRescheduleRequests(now), 1);
  assert.deepEqual(f.enqueued, [{ id: 'soon', kind: 'RESCHEDULE_LAPSED', requestedAt: '2099-08-30T10:00:00.000Z' }]);
  assert.deepEqual(f.audits, ['APPOINTMENT.RESCHEDULE_LAPSED']);
  assert.equal(f.appointments[0].rescheduleRequestedAt, null);
  assert.ok(f.appointments[1].rescheduleRequestedAt);
  assert.equal(f.transactions(), 1, 'each lapse runs in its own serializable transaction');
  assert.equal(await f.service.lapseExpiredRescheduleRequests(now), 0, 're-running is a no-op');
  assert.equal(f.enqueued.length, 1);
});

test('cancelled bookings are never lapsed', async () => {
  const f = fixture([{ id: 'gone', status: 'CANCELLED', requestedDate: new Date('2099-09-02T11:00:00Z'), requestedAt: new Date('2099-08-30T10:00:00Z') }]);
  assert.equal(await f.service.lapseExpiredRescheduleRequests(now), 0);
  assert.equal(f.enqueued.length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=react-server --import tsx --test src/app/services/reschedule-request-lapse.test.ts`
Expected: FAIL — `Cannot find module './reschedule-request-lapse'`.

- [ ] **Step 3: Implement**

```ts
// src/app/services/reschedule-request-lapse.ts
import 'server-only';
import prisma from '@/app/lib/prisma';
import { appendAuditEvent } from '@/app/lib/audit';
import { RESCHEDULE_REQUEST_LEAD_HOURS } from '@/app/lib/reschedule-request';
import { runSerializableWithRetry } from './booking-service';
import { enqueueAppointmentNotification } from './notification-outbox-service';

const lapseInclude = {
  user: { select: { email: true, name: true, phone: true } },
  stylist: { select: { name: true } },
  service: { select: { id: true, name: true, price: true, duration: true } },
} as const;

/**
 * Close reschedule requests nobody answered before the requested time came
 * within 24 hours. Runs inside the notifications cron (same tick, no extra Neon
 * wake). Each request is cleared and its email queued in one transaction, and
 * only if it is still the same request, so a re-run or a racing staff decision
 * never sends twice.
 */
export async function lapseExpiredRescheduleRequests(now: Date, limit = 50): Promise<number> {
  const cutoff = new Date(now.getTime() + RESCHEDULE_REQUEST_LEAD_HOURS * 3_600_000);
  const due = await prisma.appointment.findMany({
    where: { status: 'CONFIRMED', rescheduleRequestedDate: { lt: cutoff } },
    select: { id: true },
    orderBy: { rescheduleRequestedDate: 'asc' },
    take: limit,
  });
  let lapsed = 0;
  for (const { id } of due) {
    const done = await runSerializableWithRetry(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id }, include: lapseInclude });
      if (!current || current.status !== 'CONFIRMED' || !current.rescheduleRequestedAt || !current.rescheduleRequestedDate
        || current.rescheduleRequestedDate >= cutoff) return false;
      const cleared = await tx.appointment.updateMany({
        where: { id, status: 'CONFIRMED', date: current.date, rescheduleRequestedAt: current.rescheduleRequestedAt },
        data: { rescheduleRequestedDate: null, rescheduleRequestedAt: null },
      });
      if (cleared.count !== 1) return false;
      await enqueueAppointmentNotification(tx, 'RESCHEDULE_LAPSED', current, { requestedDate: current.rescheduleRequestedDate, requestedAt: current.rescheduleRequestedAt });
      await appendAuditEvent({ actorUserId: null, action: 'APPOINTMENT.RESCHEDULE_LAPSED', targetType: 'Appointment', targetId: id, metadata: { to: current.rescheduleRequestedDate.toISOString() } }, tx);
      return true;
    });
    if (done) lapsed++;
  }
  return lapsed;
}
```

(Serializable like every other request transition, so a lapse racing a staff approval or a customer replace is resolved by the same guard and retry.)

- [ ] **Step 4: Call it from the cron**

In `notification-cron-service.ts` add `import { lapseExpiredRescheduleRequests } from './reschedule-request-lapse';`, and immediately after `enqueueCursors = readEnqueueCursors(worker?.lastResultJson);` add:

```ts
    // Requests nobody answered in time: clear them and queue one email each
    // before this run's dispatch, so the email goes out in the same tick.
    const lapsed = await lapseExpiredRescheduleRequests(now);
```

and add `lapsed` to the `result` object: `const result = { queued, scanned, lapsed, ...delivery, … }`.

In `notification-cron-service.test.ts`, add to the `loadServerModule` mocks:

```ts
    './reschedule-request-lapse': { lapseExpiredRescheduleRequests: async () => { lapseCalls++; return 0; } },
```

with `let lapseCalls = 0;` declared in `fixture`, return `lapseCalls: () => lapseCalls` from it, and add:

```ts
test('each claimed cron run lapses stale reschedule requests once; a busy run does not', async () => {
  const f = fixture(0);
  await Promise.all([f.service.runNotificationCron('notifications'), f.service.runNotificationCron('reminders')]);
  assert.equal(f.lapseCalls(), 1);
});
```

- [ ] **Step 5: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/services/reschedule-request-lapse.test.ts src/app/services/notification-cron-service.test.ts src/app/api/cron/notifications/route.test.ts src/app/services/neon-compute-budget.test.ts`
Expected: all pass (route test: kill-switch still precedes any DB call; compute-budget test: no new cron).

- [ ] **Step 6: Commit**

```bash
git add src/app/services/reschedule-request-lapse.ts src/app/services/reschedule-request-lapse.test.ts src/app/services/notification-cron-service.ts src/app/services/notification-cron-service.test.ts
git commit -m "feat(notifications): lapse unanswered reschedule requests in the existing cron"
```

---

### Task 9: Admin board — request list, count, badge and dialog actions

**Files:**
- Modify: `src/app/services/admin-calendar-data.ts`
- Test: `src/app/services/admin-calendar-data.test.ts`
- Create: `src/components/admin/RescheduleRequestActions.tsx`
- Modify: `src/components/admin/ScheduleCalendar.tsx`, `src/components/admin/AppointmentDialog.tsx`, `src/components/admin/ScheduleDayGrid.tsx`, `src/components/admin/ScheduleWeekGrid.tsx`, `src/app/[locale]/admin/page.tsx`
- Modify: `src/i18n/messages/en/adminSchedule.ts`, `src/i18n/messages/zh/adminSchedule.ts`

**Interfaces:**
- Consumes: `decideRescheduleRequest` (Task 7), `rescheduleRequestView` (Task 2).
- Produces from `getAdminCalendarData`:
  - `rescheduleRequests: { id: string; date: string; requestedDate: string; requestedAt: string; expired: boolean; user: { name: string | null; phone: string | null }; stylist: { name: string }; service: { name: string } }[]` (≤ 50, oldest request first)
  - `rescheduleRequestCount: number` (open **and not expired**)
  - each `CalendarAppointment` gains `rescheduleRequestedDate: string | null`, `rescheduleRequestedAt: string | null`.

- [ ] **Step 1: Write the failing test** (append to `admin-calendar-data.test.ts`; same loader pattern as its "pending cursor" test)

```ts
test('the board lists open reschedule requests by request age and counts only unexpired ones', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const requests = [
    { id: 'r2', date: new Date('2099-09-20T09:00:00Z'), rescheduleRequestedDate: new Date('2099-09-02T09:00:00Z'), rescheduleRequestedAt: new Date('2099-08-30T10:00:00Z'),
      user: { name: 'Amy', phone: null }, stylist: { name: 'Ivan' }, service: { name: 'Cut' } },
    { id: 'r1', date: new Date('2099-09-21T09:00:00Z'), rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T10:00:00Z'),
      user: { name: 'Ben', phone: '07000 000000' }, stylist: { name: 'Lox' }, service: { name: 'Colour' } },
  ];
  const queries: { where: Record<string, unknown>; orderBy: unknown; take: number }[] = [];
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, getDatabaseProvider: () => 'postgresql', default: { appointment: {
      findMany: async (query: { where: Record<string, unknown>; orderBy: unknown; take: number }) => {
        if ('rescheduleRequestedDate' in query.where) { queries.push(query); return requests; }
        return [];
      },
      groupBy: async () => [], count: async () => 0,
    }, $queryRaw: async () => [{}] } },
    '@/app/lib/session': { requireAdmin: async () => ({ role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const data = await getAdminCalendarData({ date: '2099-09-01', view: 'year' });
  assert.deepEqual(queries[0].where, { status: 'CONFIRMED', rescheduleRequestedDate: { not: null } });
  assert.deepEqual(queries[0].orderBy, [{ rescheduleRequestedAt: 'asc' }, { id: 'asc' }]);
  assert.equal(queries[0].take, 50);
  assert.deepEqual(data.rescheduleRequests.map((row) => [row.id, row.expired]), [['r2', true], ['r1', false]]);
  assert.equal(data.rescheduleRequestCount, 1, 'an expired request is listed but not counted');
  assert.equal(data.rescheduleRequests[0].requestedDate, '2099-09-02T09:00:00.000Z');
  assert.equal(data.rescheduleRequests[1].requestedAt, '2099-09-01T10:00:00.000Z');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=react-server --import tsx --test src/app/services/admin-calendar-data.test.ts`
Expected: FAIL — `rescheduleRequests` is undefined.

- [ ] **Step 3: Implement the data**

In `admin-calendar-data.ts`:

1. Add `import { isRescheduleRequestExpired } from '@/app/lib/reschedule-request';`.
2. Add `rescheduleRequestedDate: true, rescheduleRequestedAt: true,` to `calendarAppointmentSelect`, and to `serializeCalendarAppointment`'s return:

```ts
    rescheduleRequestedDate: row.rescheduleRequestedDate?.toISOString() ?? null,
    rescheduleRequestedAt: row.rescheduleRequestedAt?.toISOString() ?? null,
```

3. Add after `pendingSelect`:

```ts
const rescheduleRequestSelect = {
  id: true, date: true, rescheduleRequestedDate: true, rescheduleRequestedAt: true,
  user: { select: { name: true, phone: true } },
  stylist: { select: { name: true } },
  service: { select: { name: true } },
} satisfies Prisma.AppointmentSelect;
```

4. Add a tenth element to the `Promise.all` array (and `rescheduleRows` to the destructuring):

```ts
    prisma.appointment.findMany({
      where: { status: 'CONFIRMED', rescheduleRequestedDate: { not: null } },
      select: rescheduleRequestSelect, orderBy: [{ rescheduleRequestedAt: 'asc' }, { id: 'asc' }], take: 50,
    }),
```

5. In the returned object add:

```ts
    rescheduleRequests: rescheduleRows.filter((row) => row.rescheduleRequestedDate && row.rescheduleRequestedAt).map((row) => ({
      id: row.id, date: row.date.toISOString(),
      requestedDate: row.rescheduleRequestedDate!.toISOString(), requestedAt: row.rescheduleRequestedAt!.toISOString(),
      expired: isRescheduleRequestExpired(row.rescheduleRequestedDate!, now),
      user: row.user, stylist: row.stylist, service: row.service,
    })),
    rescheduleRequestCount: rescheduleRows.filter((row) => row.rescheduleRequestedDate && !isRescheduleRequestExpired(row.rescheduleRequestedDate, now)).length,
```

and export `export type RescheduleRequestRow = Awaited<ReturnType<typeof getAdminCalendarData>>['rescheduleRequests'][number];`.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --conditions=react-server --import tsx --test src/app/services/admin-calendar-data.test.ts`
Expected: pass.

- [ ] **Step 5: Add the staff copy**

`src/i18n/messages/en/adminSchedule.ts` — after the `pending` block:

```ts
  rescheduleRequests: {
    stat: 'Reschedule requests',
    sectionLabel: 'Customer reschedule requests',
    title: 'Reschedule requests',
    item: '{customer} · {service} · {stylist}',
    move: '{from} → {to}',
    asked: 'asked {when}',
    approve: 'Approve move',
    approving: 'Checking calendars…',
    decline: 'Decline',
    declineConfirm: 'Decline this request? The customer keeps their original time and is emailed.',
    expired: 'Expired',
    badge: 'Move requested',
    dialogNote: 'The customer asked to move this to {to}.',
  },
```

`src/i18n/messages/zh/adminSchedule.ts`:

```ts
  rescheduleRequests: {
    stat: '改期申請',
    sectionLabel: '客人嘅改期申請',
    title: '改期申請',
    item: '{customer} · {service} · {stylist}',
    move: '{from} → {to}',
    asked: '{when}申請',
    approve: '批准改期',
    approving: '檢查緊日曆…',
    decline: '拒絕',
    declineConfirm: '確定拒絕呢個申請？客人會保留原本嘅時間，並會收到電郵。',
    expired: '已過期',
    badge: '申請改期',
    dialogNote: '客人申請改去 {to}。',
  },
```

- [ ] **Step 6: Render the list and actions in `ScheduleCalendar.tsx`**

1. Add `rescheduleRequests: RescheduleRequestRow[];` to the component props (import the type next to `PendingAppointment`) and destructure it.
2. Create `src/components/admin/RescheduleRequestActions.tsx` (its own file: `AppointmentDialog` needs it too, and `ScheduleCalendar` already imports `AppointmentDialog`, so putting it in `ScheduleCalendar` would create an import cycle):

```tsx
'use client';

import { useTransition } from 'react';
import { useT } from '@/i18n/client';

// Approve / decline for a customer's request to move a CONFIRMED booking.
export function RescheduleRequestActions({ appointmentId, requestedAt, expired, onDone }: { appointmentId: string; requestedAt: string; expired: boolean; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const t = useT('adminSchedule');
  const run = (decision: 'APPROVE' | 'DECLINE') => startTransition(async () => {
    const { decideRescheduleRequest } = await import('@/app/actions/admin');
    const res = await decideRescheduleRequest(appointmentId, decision, requestedAt);
    if (res.success) onDone(); else alert(res.error ?? t('appointment.updateFailed'));
  });
  return (
    <div className="flex gap-2" aria-busy={pending}>
      {!expired && (
        <button type="button" disabled={pending} onClick={() => run('APPROVE')}
          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-wait disabled:opacity-60">
          {pending ? t('rescheduleRequests.approving') : t('rescheduleRequests.approve')}
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => { if (window.confirm(t('rescheduleRequests.declineConfirm'))) run('DECLINE'); }}
        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60">
        {t('rescheduleRequests.decline')}
      </button>
    </div>
  );
}
```

   and in `ScheduleCalendar.tsx` add `import { RescheduleRequestActions } from './RescheduleRequestActions';`.

3. Directly after the pending `<section>` add:

```tsx
      {rescheduleRequests.length > 0 && (
        <section aria-label={t('rescheduleRequests.sectionLabel')} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">{t('rescheduleRequests.title')}</h2>
          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-amber-200">
            {rescheduleRequests.map((request) => {
              const from = `${formatSalonLongDate(locale, new Date(request.date))} ${formatSalonClock(locale, new Date(request.date))}`;
              const to = `${formatSalonLongDate(locale, new Date(request.requestedDate))} ${formatSalonClock(locale, new Date(request.requestedDate))}`;
              return (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {t('rescheduleRequests.item', { customer: request.user.name ?? t('appointment.customerFallback'), service: request.service.name, stylist: request.stylist.name })}
                    </p>
                    <p className="text-sm text-zinc-700">{t('rescheduleRequests.move', { from, to })}</p>
                    {request.expired && <p className="text-xs font-medium uppercase text-zinc-500">{t('rescheduleRequests.expired')}</p>}
                  </div>
                  <RescheduleRequestActions appointmentId={request.id} requestedAt={request.requestedAt} expired={request.expired} onDone={() => router.refresh()} />
                </div>
              );
            })}
          </div>
        </section>
      )}
```

4. Grid badge. In `src/components/admin/ScheduleDayGrid.tsx` add to `export type GridAppointment`:

```ts
  /** A customer has asked to move this booking (an open reschedule request). */
  moveRequested?: boolean;
```

In `ScheduleCalendar.tsx`, add `moveRequested: Boolean(appt.rescheduleRequestedAt),` to **both** `GridAppointment` mappings (the day-grid `.map((appt) => ({ … }))` and `weekAppointments`). In `ScheduleDayGrid.tsx`, directly after `<div className="truncate opacity-90">{appt.serviceName}</div>` add:

```tsx
                        {appt.moveRequested && <div className="font-semibold uppercase">{t('rescheduleRequests.badge')}</div>}
```

In `ScheduleWeekGrid.tsx`, directly after `<div className="truncate">{firstName(appt.customerName, customerFallback)}</div>` add:

```tsx
                      {appt.moveRequested && <div className="truncate uppercase">{t('rescheduleRequests.badge')}</div>}
```

- [ ] **Step 7: Dialog note and buttons in `AppointmentDialog.tsx`**

1. In the edit variant of the dialog target type (the object with `customerName`, `status`, `updatedAt`, `price`), add:

```ts
      /** An open customer reschedule request (ISO instants), if any. */
      rescheduleRequestedDate: string | null;
      rescheduleRequestedAt: string | null;
```

2. In `ScheduleCalendar.tsx`, in the `mode: 'edit'` target builder, add `rescheduleRequestedDate: appt.rescheduleRequestedDate, rescheduleRequestedAt: appt.rescheduleRequestedAt,`.
3. In `AppointmentDialog.tsx` add imports:

```ts
import { RescheduleRequestActions } from './RescheduleRequestActions';
import { isRescheduleRequestExpired } from '@/app/lib/reschedule-request';
import { formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
```

(skip any already imported), and directly after the edit-mode customer/status box (`<span className="ml-2 text-zinc-500">· {t.dynamic(\`status.${target.status}\`, …)}</span>` and its closing `</div>`) add:

```tsx
          {target.mode === 'edit' && target.rescheduleRequestedDate && target.rescheduleRequestedAt && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>{t('rescheduleRequests.dialogNote', { to: `${formatSalonLongDate(locale, new Date(target.rescheduleRequestedDate))} ${formatSalonClock(locale, new Date(target.rescheduleRequestedDate))}` })}</p>
              <div className="mt-2">
                <RescheduleRequestActions appointmentId={target.appointmentId} requestedAt={target.rescheduleRequestedAt}
                  expired={isRescheduleRequestExpired(target.rescheduleRequestedDate)} onDone={saved} />
              </div>
            </div>
          )}
```

(`saved` is the dialog's existing "clear draft and call `onSaved`" helper; `locale` comes from the dialog's existing `useLocale()`.)

- [ ] **Step 8: The stat card on `/admin`**

In `src/app/[locale]/admin/page.tsx`, destructure `rescheduleRequests, rescheduleRequestCount` from `calendar`, change the stats grid to `lg:grid-cols-5`, add after the "awaiting" card:

```tsx
        <div className={`p-5 rounded-lg shadow border ${rescheduleRequestCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200'}`}>
          <p className="text-sm text-zinc-500 uppercase tracking-wider font-medium">{t('rescheduleRequests.stat')}</p>
          <p className={`text-3xl font-bold mt-1 ${rescheduleRequestCount > 0 ? 'text-amber-700' : 'text-zinc-900'}`}>{rescheduleRequestCount}</p>
        </div>
```

and pass `rescheduleRequests={rescheduleRequests}` to `<ScheduleCalendar … />`.

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && pnpm lint && node --conditions=react-server --import tsx --test src/app/services/admin-calendar-data.test.ts src/i18n/messages/completeness.test.ts src/components/admin/*.test.ts`
Expected: no type or lint errors; tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/app/services/admin-calendar-data.ts src/app/services/admin-calendar-data.test.ts src/components/admin "src/app/[locale]/admin/page.tsx" src/i18n/messages/en/adminSchedule.ts src/i18n/messages/zh/adminSchedule.ts
git commit -m "feat(admin): reschedule request list, count, badge and dialog actions"
```

---

### Task 10: Customer UI — My Bookings

**Files:**
- Modify: `src/app/[locale]/appointments/page.tsx` (select + serialize)
- Modify: `src/components/appointments/AppointmentCard.tsx`, `src/components/appointments/RescheduleModal.tsx`
- Modify: `src/i18n/messages/en/appointments.ts`, `src/i18n/messages/zh/appointments.ts`
- Test: `src/test/pages/appointments-reschedule-request.test.ts` (new; page tests live in `src/test/pages/` because `[locale]` paths are never run)

**Interfaces:**
- Consumes: `requestReschedule`, `withdrawRescheduleRequest` (Task 6); `rescheduleRequestView`, `RescheduleRequestView` (Task 2).
- Produces: `SerializedAppointment.request: RescheduleRequestView`.

- [ ] **Step 1: Write the failing test** (same loader pattern as `src/test/pages/appointments-booking-snapshot.test.ts`)

```ts
// src/test/pages/appointments-reschedule-request.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

test('My Bookings hands each card its reschedule request as a view model, never raw columns', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const card = () => null;
  const base = {
    date: new Date('2099-09-14T12:00:00Z'), status: 'CONFIRMED', stylistId: 'stylist-1', stylist: { name: 'Ivan' },
    serviceId: 'service-1', service: { name: 'Cut', duration: 30 }, review: null, priceAtBooking: 80, quoteJson: null, durationAtBooking: 60,
  };
  const appointments = [
    { ...base, id: 'none', rescheduleRequestedDate: null, rescheduleRequestedAt: null },
    { ...base, id: 'open', rescheduleRequestedDate: new Date('2099-09-15T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T11:00:00Z') },
    { ...base, id: 'expired', rescheduleRequestedDate: new Date('2099-09-02T09:00:00Z'), rescheduleRequestedAt: new Date('2099-08-30T10:00:00Z') },
  ];
  const page = loadServerModule<typeof import('../../app/[locale]/appointments/page')>('src/app/[locale]/appointments/page.tsx', {
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/app/lib/prisma': { appointment: { findMany: async ({ where }: { where: { OR?: unknown } }) => where.OR ? [] : appointments } },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1' }) },
    '@/app/lib/booking-maintenance': { isBookingEnabled: async () => true },
    '@/components/appointments/AppointmentCard': { AppointmentCard: card },
    '@/i18n/ClientMessages': { ClientMessages: ({ children }: { children: unknown }) => children },
    '@/i18n/server': { getLocale: async () => 'en-GB', getT: async (namespace: Namespace) => translator('en-GB', namespace) },
  });
  const rendered = await page.default({});
  const cards: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { appointment?: Record<string, unknown>; children?: unknown } };
    if (element.type === card && element.props.appointment) cards.push(element.props.appointment);
    visit(element.props.children);
  };
  visit(rendered);
  assert.deepEqual(Object.fromEntries(cards.map((c) => [c.id, c.request])), {
    none: { state: 'none' },
    open: { state: 'open', requestedDate: '2099-09-15T09:00:00.000Z', requestedAt: '2099-09-01T11:00:00.000Z' },
    expired: { state: 'expired', requestedDate: '2099-09-02T09:00:00.000Z', requestedAt: '2099-08-30T10:00:00.000Z' },
  });
  assert.ok(cards.every((c) => !('rescheduleRequestedAt' in c) && !('rescheduleRequestedDate' in c)));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=react-server --import tsx --test src/test/pages/appointments-reschedule-request.test.ts`
Expected: FAIL — every `request` is undefined.

- [ ] **Step 3: Serialize the request on the page**

In `appointments/page.tsx`: add `rescheduleRequestedDate: true, rescheduleRequestedAt: true,` to `select`; import `rescheduleRequestView` from `@/app/lib/reschedule-request`; add `request: rescheduleRequestView(a, now),` to the serialized object.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --conditions=react-server --import tsx --test src/test/pages/appointments-reschedule-request.test.ts`
Expected: pass.

- [ ] **Step 5: Customer copy**

`en/appointments.ts` — in `card`: change `reschedule: 'Reschedule'` to `reschedule: 'Request a new time'` and add:

```ts
    requestOpen: 'You asked to move this to {date}, {time} — waiting for the salon. Your current time stays booked until then.',
    requestExpired: 'Your request to move to {date}, {time} expired. Your original time stands.',
    changeRequest: 'Change requested time',
    withdrawRequest: 'Withdraw request',
    withdrawingRequest: 'Withdrawing…',
    confirmWithdrawRequest: 'Withdraw your request? Your current time stays as it is.',
```

In `reschedule`: `title: 'Request a new time'`, `confirm: 'Send request'`, `submitting: 'Sending…'`, `failed: 'Request failed'`, and add `sent: 'Request sent. Your current time stays booked until the salon confirms.'`.

`zh/appointments.ts` — same keys:

```ts
    reschedule: '申請改期',
    requestOpen: '你已申請改至{date} {time}，正等候本店確認。在確認之前，你現有的時間會繼續保留。',
    requestExpired: '你改至{date} {time}的申請已失效，原本的時間維持不變。',
    changeRequest: '更改申請時間',
    withdrawRequest: '撤回申請',
    withdrawingRequest: '撤回中…',
    confirmWithdrawRequest: '確定撤回申請？你現有的時間維持不變。',
```

and in `reschedule`: `title: '申請改期'`, `confirm: '送出申請'`, `submitting: '送出中…'`, `failed: '申請失敗'`, `sent: '申請已送出。在本店確認之前，你現有的時間會繼續保留。'`.

- [ ] **Step 6: `RescheduleModal.tsx`**

Change the import to `import { fetchSlots, requestReschedule } from '@/app/actions/booking';` and the call to `const result = await requestReschedule(appointmentId, selectedDate, selectedSlot);`. On success, before `close()`, call the new optional prop `onSent?.()`; add `onSent?: () => void;` to `RescheduleModalProps`. Change the minimum date from tomorrow to two days ahead (the server refuses anything under 24 h; the time picker cannot express "after 13:00 tomorrow"):

```ts
  const earliest = new Date();
  earliest.setDate(earliest.getDate() + 2);
  const minDate = earliest.toISOString().split('T')[0];
```

- [ ] **Step 7: `AppointmentCard.tsx`**

1. Add `request: RescheduleRequestView;` to `SerializedAppointment` (import the type from `@/app/lib/reschedule-request`) and import `withdrawRescheduleRequest` next to `cancelAppointment`.
2. Add state `const [withdrawing, setWithdrawing] = useState(false);` and `const [notice, setNotice] = useState<string | null>(null);`, plus:

```tsx
  async function handleWithdraw() {
    if (!window.confirm(t('card.confirmWithdrawRequest'))) return;
    setWithdrawing(true);
    setError(null);
    try {
      const result = await withdrawRescheduleRequest(appointment.id);
      if (result.success) router.refresh(); else setError(result.error || t('card.unexpectedError'));
    } catch {
      setError(t('card.unexpectedError'));
    } finally {
      setWithdrawing(false);
    }
  }
  const request = appointment.request;
  const requestWhen = request.state === 'none' ? null : {
    date: formatSalonLongDate(locale, new Date(request.requestedDate)),
    time: formatSalonClock(locale, new Date(request.requestedDate)),
  };
```

3. Change the reschedule button label to `{request.state === 'open' ? t('card.changeRequest') : t('card.reschedule')}`, and after it (inside the same `!isPending &&` group) add:

```tsx
                {request.state === 'open' && (
                  <button onClick={handleWithdraw} disabled={withdrawing}
                    className="px-4 py-2 text-sm border border-zinc-300 rounded-md text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {withdrawing ? t('card.withdrawingRequest') : t('card.withdrawRequest')}
                  </button>
                )}
```

4. Below the existing notices add:

```tsx
        {isUpcoming && requestWhen && (
          <p className={`mt-3 text-xs ${request.state === 'open' ? 'text-amber-700' : 'text-zinc-500'}`}>
            {t(request.state === 'open' ? 'card.requestOpen' : 'card.requestExpired', requestWhen)}
          </p>
        )}
        {notice && <p className="mt-3 text-xs text-zinc-700">{notice}</p>}
```

5. Pass `onSent={() => setNotice(t('reschedule.sent'))}` to `<RescheduleModal />`.

(Withdraw stays available while online booking is closed, matching the server: do not gate it on `bookingEnabled`.)

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && pnpm lint && node --conditions=react-server --import tsx --test src/test/pages/*.test.ts src/i18n/messages/completeness.test.ts`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add "src/app/[locale]/appointments/page.tsx" src/components/appointments src/i18n/messages/en/appointments.ts src/i18n/messages/zh/appointments.ts src/test/pages/appointments-reschedule-request.test.ts
git commit -m "feat(appointments): request, change or withdraw a new time from My Bookings"
```

---

### Task 11: Real-Postgres lifecycle, docs and comments

**Files:**
- Modify: `scripts/verify-booking-lifecycle.ts` (lines using `rescheduleAppointment`: ~194, 211, 213, 216, 237, 242, 271)
- Modify: `src/app/lib/rate-limit.ts:152`, `readme/structure.md`, `CLAUDE.md:7,160-161,172`

**Interfaces:**
- Consumes: everything above. Produces: CI coverage on real PostgreSQL 18.

- [ ] **Step 1: Rewrite the reschedule section of the lifecycle script**

Open the script around the `customerActions.rescheduleAppointment` calls (`grep -n rescheduleAppointment scripts/verify-booking-lifecycle.ts`). The script loads `admin.ts` as an object (search `adminActions`). Replace each call as follows, keeping the surrounding assertions' intent:

| Old call | New |
|---|---|
| `rescheduleAppointment(id, bookingDay, '14:00')` expecting `/Only confirmed/` | `requestReschedule(...)` expecting `/Only confirmed/` |
| expecting `/not found/` (other customer) | `requestReschedule(...)` expecting `/not found/` |
| expecting `/no longer available/` (11:00 taken) | `requestReschedule(...)` expecting `/no longer available/` |
| `assertActionSuccess(rescheduleAppointment(id, bookingDay, '14:00'))` | `assertActionSuccess(requestReschedule(...))`; then assert the row is still at its old `date`, then `const open = await db.appointment.findUniqueOrThrow({ where: { id } }); assertActionSuccess(await adminActions.decideRescheduleRequest(id, 'APPROVE', open.rescheduleRequestedAt!.toISOString()));` and keep the existing post-move assertions (moved ICS etc.) |
| `/Cannot reschedule within 24 hours/` | unchanged message, `requestReschedule(...)` |
| `/Online booking is closed/` | `requestReschedule(...)` |

Then, before the existing `console.log('PASS: real create → admin confirm → customer reschedule…')`, add these real-Postgres scenarios:

```ts
    // Request → withdraw.
    await assertActionSuccess(await customerActions.requestReschedule(appointment.id, day(16), '10:00'));
    await assertActionSuccess(await customerActions.withdrawRescheduleRequest(appointment.id));
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).rescheduleRequestedAt, null);

    // Request → a Fresha import now covers the requested time → approval refused → decline keeps the original.
    const before = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await assertActionSuccess(await customerActions.requestReschedule(appointment.id, day(16), '11:00'));
    const requested = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await syncCalendarFeeds({ db, connectionId: channel.id, fetchFeed: async () => icalFeed([{ uid: 'fresha-takes-it', start: instant(day(16), '11:00'), end: instant(day(16), '12:00') }]) });
    assertActionError(await adminActions.decideRescheduleRequest(appointment.id, 'APPROVE', requested.rescheduleRequestedAt!.toISOString()), /no longer free/);
    await assertActionSuccess(await adminActions.decideRescheduleRequest(appointment.id, 'DECLINE', requested.rescheduleRequestedAt!.toISOString()));
    const declined = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(declined.date.getTime(), before.date.getTime());
    assert.equal(declined.rescheduleRequestedAt, null);

    // Approve racing withdraw: exactly one wins.
    await assertActionSuccess(await customerActions.requestReschedule(appointment.id, day(17), '10:00'));
    const racing = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    const outcomes = await Promise.all([
      adminActions.decideRescheduleRequest(appointment.id, 'APPROVE', racing.rescheduleRequestedAt!.toISOString()),
      customerActions.withdrawRescheduleRequest(appointment.id),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.success).length, 1);
```

Adjust `session` switching to the file's existing pattern (it sets `session = { userId: …, role: … }` before customer vs admin calls). Use free days/times consistent with the script's existing fixture (`day(n)` helpers); if 11:00 or 10:00 on those days clashes with an earlier step, shift by one hour.

- [ ] **Step 2: Run the real-Postgres scripts against the Task 1 throwaway cluster**

```bash
U=postgresql://salon_test:disposable-ci-password@127.0.0.1:55433/salon_test
run(){ env -i PATH="$PATH" HOME="$HOME" TZ=UTC POSTGRES_URL=$U POSTGRES_URL_NON_POOLING=$U SALON_TEST_DATABASE_URL=$U SESSION_SECRET=disposable-ci-secret-not-for-production-at-least-32-characters NOTIFICATIONS_ENABLED=false CALENDAR_SYNC_ENABLED=false HOUSEKEEPING_ENABLED=false "$@"; }
run pnpm test:integration && run pnpm test:booking-lifecycle
```
Expected: every line `PASS: …`, exit 0. (If the cluster from Task 1 is gone, recreate it with Task 1 Step 5.)

- [ ] **Step 3: Fix the comments and docs**

- `src/app/lib/rate-limit.ts:152` → `// Every reschedule request emails the customer and the salon. Per customer, and per`
- `readme/structure.md`, "Colour Booking Gate" bullet for `booking.ts`: replace `rescheduleAppointment` with `requestReschedule` / `withdrawRescheduleRequest`, and add a new section:

```markdown
### Customer Reschedule Requests
A customer's move of a CONFIRMED booking is a request; the original time stays booked until staff decide.
- `src/app/lib/reschedule-request.ts` — `RESCHEDULE_REQUEST_LEAD_HOURS` (24), `isRescheduleRequestExpired`, `rescheduleRequestView` (pure, client-safe).
- `src/app/actions/booking.ts` — `requestReschedule(appointmentId, dateStr, time)`, `withdrawRescheduleRequest(appointmentId)`; `cancelAppointment` clears an open request.
- `src/app/actions/admin.ts` — `decideRescheduleRequest(appointmentId, 'APPROVE' | 'DECLINE', requestedAt)`; approval first runs `refreshStylistCalendarFeeds` (feeds older than `APPROVAL_REFRESH_MINUTES` = 5), as does new-booking approval.
- `src/app/services/reschedule-request-lapse.ts` — `lapseExpiredRescheduleRequests(now)`, run by the notifications cron.
- Emails: `RESCHEDULE_REQUEST_RECEIVED`, `SALON_RESCHEDULE_ALERT`, `RESCHEDULE_DECLINED`, `RESCHEDULE_LAPSED` (keyed by the request's `requestedAt`).
```

- `CLAUDE.md`: line 7 `(view/cancel/reschedule)` → `(view/cancel/request a reschedule)`; replace the two bullets at 160–161 with:

```markdown
- **24-hour cancellation/reschedule policy** — enforced server-side in booking actions; a reschedule request's new time must also be ≥ 24 h away.
- **Customer reschedules are staff-approved requests** (`requestReschedule` → `decideRescheduleRequest`); the booking stays CONFIRMED at its original time until approval, which refreshes the stylist's Fresha feeds and re-checks the slot in a Serializable transaction. Unanswered requests lapse 24 h before the requested time (notifications cron).
```

and in line 172 change `Rescheduling to the same time is a no-op; real reschedules are limited per customer and per appointment.` to `Requesting the booking's current (or already-requested) time is a no-op; real requests are limited per customer and per appointment.`

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-booking-lifecycle.ts src/app/lib/rate-limit.ts readme/structure.md CLAUDE.md
git commit -m "test(booking): real-Postgres reschedule-request lifecycle; docs and comments"
```

---

### Task 12: Full verification and PR

**Files:** none new.

- [ ] **Step 1: No leftover references to the removed action**

Run: `grep -rn "rescheduleAppointment\|refreshStaleCalendarFeeds" src scripts`
Expected: no output.

- [ ] **Step 2: Unit suite, types, lint, audit**

Run: `pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"; npx tsc --noEmit; pnpm lint; pnpm audit --audit-level=high`
Expected: `# fail 0`; tsc and lint clean; audit exit 0.

- [ ] **Step 3: CI parity in a clean worktree (no `.env*`, so nothing can reach production)**

```bash
SP=$(mktemp -d); git worktree add --detach $SP/wt HEAD && cd $SP/wt && pnpm install --frozen-lockfile
U=postgresql://salon_test:disposable-ci-password@127.0.0.1:55433/salon_test
run(){ env -i PATH="$PATH" HOME="$HOME" TZ=UTC POSTGRES_URL=$U POSTGRES_URL_NON_POOLING=$U SALON_TEST_DATABASE_URL=$U SESSION_SECRET=disposable-ci-secret-not-for-production-at-least-32-characters NOTIFICATIONS_ENABLED=false CALENDAR_SYNC_ENABLED=false HOUSEKEEPING_ENABLED=false "$@"; }
# Fresh database: drop and recreate salon_test first (psql -h 127.0.0.1 -p 55433 -U postgres -c 'DROP DATABASE salon_test' -c 'CREATE DATABASE salon_test OWNER salon_test')
run pnpm db:vercel:deploy && run pnpm test:integration && run pnpm test:booking-lifecycle && run pnpm build && run pnpm test:backend-http
cd - && git worktree remove --force $SP/wt
```
Expected: all pass. Then stop and delete the cluster: `/usr/local/opt/postgresql@18/bin/pg_ctl -D <cluster dir> stop -m fast` and remove its directory.

- [ ] **Step 4: Ask before touching the preview database**

The preview Neon project `harbour-hair-preview-lhr` holds a copy of production customer data and never migrates itself, so "Deploy Preview" fails until this migration is applied there. **Ask the owner** before running, with the preview env pulled to a scratch file:
`npx vercel env pull <scratch>/.env.preview --environment=preview`, then `prisma migrate deploy --schema prisma/vercel/schema.prisma` with that file's `PREVIEWDB_*`-derived `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING`. Delete the scratch file afterwards.

- [ ] **Step 5: Push and open the PR** (only when the owner says so)

```bash
git push -u origin feat/reschedule-requests
gh pr create --base main --title "feat(booking): customer reschedules become staff-approved requests" --body "<summary of the spec, the test evidence from Steps 2–3, and the preview-DB status>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01U3fckL7wvjjUxxJjYcDSYh"
```
