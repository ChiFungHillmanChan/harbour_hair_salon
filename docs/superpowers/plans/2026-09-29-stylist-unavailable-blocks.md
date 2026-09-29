# Stylist "Unavailable" Blocks + Fresha Echo Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a stylist's unavailable time clearly on the website — a big grey "Unavailable" block for a whole day off (a Fresha "Pause"), greyed-out taken times on other days, and an "Unavailable" block on the admin calendar — while guaranteeing "Anyone" never assigns an unavailable stylist and a Fresha re-export of our own booking can never break the admin Confirm button.

**Architecture:** No schema change. A Fresha "Pause" already arrives as a whole-day `ExternalBusyBlock` (verified 2026-09-29 against the live feeds). The public side derives everything from the slot grid: a new pure `buildBookingDays` turns hours + busy intervals into per-day `{status, hours, slots}` for 14 days, loaded by one batched `getBookingDays` (3 queries total) behind a new `fetchBookingDays` server action. The admin side classifies a synced block as "Unavailable" when it covers the stylist's (or, if they are not rostered, the salon's) working window. The echo guard is an opt-in flag on `assertAppointmentSlotAvailable`, used only by the Confirm path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Prisma, `node:test` via `tsx`, in-house i18n (`src/i18n`).

**Spec (decisions made with the owner on 2026-09-29, this conversation):**
- Days off are entered in Fresha only (a whole-day blocked time the salon calls "Pause"); the website never gets its own day-off form.
- Public label is **"Unavailable"** — never the reason (booked, lunch, day off).
- Chosen look ("Block + greyed times"): date chip greyed + "Unavailable"; a day with no bookable time shows one big grey "Unavailable" block; a normal day shows every time, taken ones grey and untappable.
- Admin calendar: a whole-day synced block reads "Unavailable", shaped like a booking.
- "Anyone" must never pick an unavailable stylist.
- Website and phone (admin-entered) bookings must keep blocking the time in Fresha — already true via the busy feed; add the echo guard so Fresha re-exporting our booking cannot break Confirm.
- Neon: stay inside the free plan (measured 1.0–1.3 CU-h/day ≈ 35/month of 100). No new crons, no new public DB routes.

## Global Constraints

- **No new cron, no new route handler.** The only new DB entry point is the `fetchBookingDays` server action, called from the sign-in-gated booking page; it must run exactly **3 queries** (availability, appointments, external blocks) regardless of how many days it covers.
- **No schema change** (no Prisma schema, no migration).
- **Monochrome brand:** greys only (`zinc-*`), black, white. No new colour.
- **Every visible string in both `en` and `zh`** (`src/i18n/messages/{en,zh}/…`); `completeness.test.ts` enforces keys and placeholders. zh-HK uses 預約 / 髮型師 vocabulary. Platform names (Fresha, Treatwell) are never translated.
- **Tests must not live under `src/app/[locale]/`** — `node --test` treats `[locale]` as a glob and silently skips them.
- Tailwind only; keep `readme/structure.md` in sync for new exported functions/components.
- Test command: `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= pnpm test`. Type check: `pnpm exec tsc --noEmit -p .` (4 known errors in `src/components/try-color/colorMath.test.ts`). Lint: `pnpm exec eslint <files>`.

## Review Focus

1. **DST changeover day** (Sun 25 Oct 2026, BST→GMT): a 10:00–20:30 Fresha block must still make the whole day Unavailable and slot times must stay on the London wall clock. → Task 2 test.
2. **A block that overshoots the hours** (Pause 10:00–20:30 against hours 10:15–19:00) must count as covering the day, on the public side (Task 2) and the admin side (Task 6).
3. **"Anyone" with one stylist paused and another free**: the day is OPEN, and a booking is assigned to the free stylist even when the paused one is first in priority order. → Tasks 2 and 4.
4. **A multi-day block** (a week's holiday exported as one all-day event Mon–Fri) must make every covered day Unavailable, not just its first. → Task 2 test.
5. **Echo vs genuine clash**: an external block with exactly the appointment's own start and end must not stop Confirm, but a block that differs by even one minute must still stop it, and a brand-new booking must never ignore an identical block. → Task 5 tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/services/scheduling.ts` (modify) | Add `buildSlotGridForWindow` (all times, flagged); `buildSlotsForWindow` becomes its free subset. |
| `src/app/services/booking-days.ts` (create) | Pure `buildBookingDays` + `BookingDay` type. No I/O. |
| `src/app/services/booking-service.ts` (modify) | `getBookingDays` loader (3 batched queries); echo option on `assertAppointmentSlotAvailable`. |
| `src/app/actions/booking.ts` (modify) | `fetchBookingDays` server action (gated, validated). |
| `src/app/actions/admin.ts` (modify) | Confirm passes `{ ignoreOwnEcho: true }`. |
| `src/components/booking/DayAvailability.tsx` (create) | Presentational: `DayChip`, `UnavailableDayBlock`, `TimeSlotGrid`. |
| `src/components/booking/BookingWizard.tsx` (modify) | Fetch 14 days once per stylist/service; render the new pieces. |
| `src/app/lib/calendar-busy-display.ts` (modify) | `salonWorkingWindow`, `isWholeDayBlock`; `calendarBusyLabel` gains `wholeDay`. |
| `src/components/admin/ScheduleDayGrid.tsx`, `ScheduleWeekGrid.tsx`, `ScheduleCalendar.tsx` (modify) | Render whole-day blocks as "Unavailable". |
| `src/i18n/messages/{en,zh}/booking.ts`, `{en,zh}/adminSchedule.ts` (modify) | New strings. |

---

### Task 1: Slot grid that keeps taken times

**Files:**
- Modify: `src/app/services/scheduling.ts:59-80`
- Test: `src/app/services/scheduling.test.ts`

**Interfaces:**
- Produces: `buildSlotGridForWindow(dateStr: string, availability: { startTime: string; endTime: string }, booked: BookedInterval[], serviceDuration: number, now: Date): TimeSlot[]` — every future start time, `available: false` where it clashes. `buildSlotsForWindow` keeps its signature and returns only `available: true` entries.

- [ ] **Step 1: Write the failing test** — append to `src/app/services/scheduling.test.ts` (and add `buildSlotGridForWindow` to the existing `./scheduling` import line):

```ts
test('buildSlotGridForWindow — keeps taken times, flagged unavailable, in order', () => {
  const dateStr = '2026-07-01';
  const now = new Date('2026-06-01T00:00:00Z');
  const booked = [{ start: resolveSalonDateTime(dateStr, '10:00').utc, durationMin: 60 }];
  const grid = buildSlotGridForWindow(dateStr, { startTime: '09:00', endTime: '12:00' }, booked, 30, now);
  assert.deepEqual(grid, [
    { time: '09:00', available: true },
    { time: '09:30', available: true },
    { time: '10:00', available: false },
    { time: '10:30', available: false },
    { time: '11:00', available: true },
    { time: '11:30', available: true },
  ]);
});

test('buildSlotGridForWindow — still hides past times entirely', () => {
  const dateStr = '2026-07-01';
  const now = resolveSalonDateTime(dateStr, '10:00').utc;
  const grid = buildSlotGridForWindow(dateStr, { startTime: '09:00', endTime: '11:00' }, [], 30, now);
  assert.deepEqual(grid.map((slot) => slot.time), ['10:30']);
});

test('buildSlotsForWindow — is exactly the free part of the grid', () => {
  const dateStr = '2026-07-01';
  const now = new Date('2026-06-01T00:00:00Z');
  const booked = [{ start: resolveSalonDateTime(dateStr, '10:00').utc, durationMin: 60 }];
  const hours = { startTime: '09:00', endTime: '12:00' };
  assert.deepEqual(
    buildSlotsForWindow(dateStr, hours, booked, 30, now),
    buildSlotGridForWindow(dateStr, hours, booked, 30, now).filter((slot) => slot.available),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/app/services/scheduling.test.ts`
Expected: FAIL — `buildSlotGridForWindow` is not a function.

- [ ] **Step 3: Implement** — replace `buildSlotsForWindow` in `src/app/services/scheduling.ts` with:

```ts
/**
 * Every start time one availability window offers on a salon-local calendar
 * date (YYYY-MM-DD), each flagged free or taken, so the booking page can show a
 * taken time greyed out instead of hiding it. Each slot's absolute instant is
 * derived with resolveSalonDateTime so it matches how appointments are STORED
 * (BST/GMT correct and host-timezone independent — never construct slot
 * instants with host-local date-fns startOfDay/setHours). `now` is injected:
 * slots at or before it are omitted, not flagged.
 */
export function buildSlotGridForWindow(
  dateStr: string,
  availability: { startTime: string; endTime: string },
  booked: BookedInterval[],
  serviceDuration: number,
  now: Date,
): TimeSlot[] {
  const [sh, sm] = availability.startTime.split(':').map(Number);
  const [eh, em] = availability.endTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;

  const slots: TimeSlot[] = [];
  for (let mins = startMins; mins + serviceDuration <= endMins; mins += 30) {
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const slotStart = resolveSalonDateTime(dateStr, label).utc;
    if (slotStart <= now) continue; // hide past slots (same-day)
    slots.push({ time: label, available: !hasConflict(slotStart, serviceDuration, booked) });
  }
  return slots;
}

/** The bookable subset of buildSlotGridForWindow (what the conflict check will accept). */
export function buildSlotsForWindow(
  dateStr: string,
  availability: { startTime: string; endTime: string },
  booked: BookedInterval[],
  serviceDuration: number,
  now: Date,
): TimeSlot[] {
  return buildSlotGridForWindow(dateStr, availability, booked, serviceDuration, now).filter((slot) => slot.available);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/app/services/scheduling.test.ts src/app/services/booking-closed-hours.test.ts src/app/services/opening-hours.test.ts`
Expected: PASS (all existing `buildSlotsForWindow` tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/scheduling.ts src/app/services/scheduling.test.ts
git commit -m "feat: slot grid that keeps taken times flagged as unavailable"
```

---

### Task 2: Pure per-day availability (`buildBookingDays`)

**Files:**
- Create: `src/app/services/booking-days.ts`
- Test: `src/app/services/booking-days.test.ts`

**Interfaces:**
- Consumes: `buildSlotGridForWindow` (Task 1), `resolveSalonDateTime` (`./salon-time`), `BookedInterval`, `TimeSlot` (`./scheduling`).
- Produces:

```ts
export type WorkingHours = { dayOfWeek: number; startTime: string; endTime: string };
export type BookingDay = {
  date: string;                                  // salon-local YYYY-MM-DD
  status: 'OPEN' | 'UNAVAILABLE';
  hours: { start: string; end: string } | null;  // earliest start–latest end of anyone rostered; null if nobody
  slots: TimeSlot[];                             // [] when UNAVAILABLE
};
export function buildBookingDays(input: {
  dates: readonly string[];
  duration: number;
  now: Date;
  hoursByStylist: ReadonlyMap<string, readonly WorkingHours[]>;
  busyByStylist: ReadonlyMap<string, readonly BookedInterval[]>;
  bookable: (start: Date, duration: number) => boolean;
}): BookingDay[];
```

- [ ] **Step 1: Write the failing tests** — create `src/app/services/booking-days.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingDays, type WorkingHours } from './booking-days';
import { resolveSalonDateTime } from './salon-time';
import type { BookedInterval } from './scheduling';

const NOW = new Date('2026-10-01T00:00:00Z');
const always = () => true;
const at = (date: string, time: string) => resolveSalonDateTime(date, time).utc;
const block = (fromDate: string, fromTime: string, toDate: string, toTime: string): BookedInterval => {
  const start = at(fromDate, fromTime);
  return { start, durationMin: Math.round((at(toDate, toTime).getTime() - start.getTime()) / 60_000) };
};
// 2026-10-06 is a Tuesday (dayOfWeek 2); 2026-10-05 a Monday (1).
const weekdays = (days: number[], startTime = '10:15', endTime = '19:00'): WorkingHours[] =>
  days.map((dayOfWeek) => ({ dayOfWeek, startTime, endTime }));

function days(dates: string[], hours: Record<string, WorkingHours[]>, busy: Record<string, BookedInterval[]> = {}, duration = 60, now = NOW, bookable = always) {
  return buildBookingDays({
    dates, duration, now, bookable,
    hoursByStylist: new Map(Object.entries(hours)),
    busyByStylist: new Map(Object.entries(busy)),
  });
}

test('a whole-day Fresha block that overshoots the hours makes the day Unavailable, keeping the rostered hours', () => {
  const [day] = days(['2026-10-06'], { funky: weekdays([2]) }, { funky: [block('2026-10-06', '10:00', '2026-10-06', '20:30')] });
  assert.equal(day.status, 'UNAVAILABLE');
  assert.deepEqual(day.hours, { start: '10:15', end: '19:00' });
  assert.deepEqual(day.slots, []);
});

test('a weekly day off is Unavailable with no hours', () => {
  const [day] = days(['2026-10-06'], { funky: weekdays([1, 3]) });
  assert.deepEqual(day, { date: '2026-10-06', status: 'UNAVAILABLE', hours: null, slots: [] });
});

test('a partial block leaves the day open and greys out only the clashing times', () => {
  const [day] = days(['2026-10-05'], { ivan: weekdays([1], '10:00', '13:00') }, { ivan: [block('2026-10-05', '11:00', '2026-10-05', '12:00')] }, 30);
  assert.equal(day.status, 'OPEN');
  assert.deepEqual(day.slots, [
    { time: '10:00', available: true }, { time: '10:30', available: true },
    { time: '11:00', available: false }, { time: '11:30', available: false },
    { time: '12:00', available: true }, { time: '12:30', available: true },
  ]);
});

test('a fully booked day is Unavailable too (one label for every reason)', () => {
  const [day] = days(['2026-10-05'], { lox: weekdays([1], '10:00', '12:00') }, { lox: [block('2026-10-05', '10:00', '2026-10-05', '12:00')] });
  assert.equal(day.status, 'UNAVAILABLE');
});

test('Anyone: one stylist paused and another free keeps the day open with the free times', () => {
  const [day] = days(['2026-10-06'],
    { funky: weekdays([2], '10:00', '12:00'), lox: weekdays([2], '10:00', '12:00') },
    { funky: [block('2026-10-06', '10:00', '2026-10-06', '20:30')] });
  assert.equal(day.status, 'OPEN');
  assert.ok(day.slots.every((slot) => slot.available));
  assert.deepEqual(day.slots.map((slot) => slot.time), ['10:00', '10:30', '11:00']);
});

test('Anyone: a time is only unavailable when every rostered stylist is taken', () => {
  const [day] = days(['2026-10-05'],
    { a: weekdays([1], '10:00', '11:00'), b: weekdays([1], '10:00', '11:00') },
    { a: [block('2026-10-05', '10:00', '2026-10-05', '11:00')], b: [block('2026-10-05', '10:30', '2026-10-05', '11:00')] }, 30);
  assert.deepEqual(day.slots, [{ time: '10:00', available: true }, { time: '10:30', available: false }]);
});

test('Anyone: hours span the earliest start and latest finish of everyone rostered', () => {
  const [day] = days(['2026-10-05'], { a: weekdays([1], '10:00', '18:00'), b: weekdays([1], '11:00', '19:30') });
  assert.deepEqual(day.hours, { start: '10:00', end: '19:30' });
});

test('a multi-day holiday block makes every covered day Unavailable', () => {
  const holiday = block('2026-10-05', '00:00', '2026-10-10', '00:00'); // Mon–Fri all-day
  const result = days(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10'], { ivan: weekdays([1, 3, 5, 6]) }, { ivan: [holiday] });
  assert.deepEqual(result.map((day) => day.status), ['UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE', 'OPEN']);
});

test('DST changeover day (25 Oct 2026, BST→GMT): the Pause still covers the day and times stay on the London clock', () => {
  const sunday = '2026-10-25';
  const paused = days([sunday], { funky: weekdays([0]) }, { funky: [block(sunday, '10:00', sunday, '20:30')] });
  assert.equal(paused[0].status, 'UNAVAILABLE');
  const open = days([sunday], { funky: weekdays([0], '10:00', '11:00') }, {}, 30);
  assert.deepEqual(open[0].slots.map((slot) => slot.time), ['10:00', '10:30']);
});

test('a day whose times have all passed is Unavailable', () => {
  const now = at('2026-10-05', '18:45');
  const [day] = days(['2026-10-05'], { lox: weekdays([1], '10:00', '19:00') }, {}, 30, now);
  assert.equal(day.status, 'UNAVAILABLE');
});

test('times the booking horizon refuses are left out, not greyed', () => {
  const [day] = days(['2026-10-05'], { lox: weekdays([1], '10:00', '11:00') }, {}, 30, NOW, (start) => start < at('2026-10-05', '10:30'));
  assert.deepEqual(day.slots, [{ time: '10:00', available: true }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/app/services/booking-days.test.ts`
Expected: FAIL — cannot find module `./booking-days`.

- [ ] **Step 3: Implement** — create `src/app/services/booking-days.ts`:

```ts
import { resolveSalonDateTime } from './salon-time';
import { buildSlotGridForWindow, type BookedInterval, type TimeSlot } from './scheduling';

export type WorkingHours = { dayOfWeek: number; startTime: string; endTime: string };

/**
 * One salon day as the booking page shows it. A day with no bookable time is
 * UNAVAILABLE whatever the reason — a Fresha "Pause", a weekly day off, or
 * every time taken — because the public page never says why.
 */
export type BookingDay = {
  /** Salon-local calendar date, YYYY-MM-DD. */
  date: string;
  status: 'OPEN' | 'UNAVAILABLE';
  /** Earliest start and latest finish of everyone rostered that day; null when nobody is. */
  hours: { start: string; end: string } | null;
  /** Every future start time, taken ones flagged unavailable. Empty when the day is UNAVAILABLE. */
  slots: TimeSlot[];
};

/**
 * Pure: turn working hours and busy intervals (appointments + synced blocks,
 * already loaded for the whole range) into per-day availability. With several
 * stylists ("Anyone") a time is free when at least one rostered stylist is.
 */
export function buildBookingDays(input: {
  dates: readonly string[];
  duration: number;
  now: Date;
  hoursByStylist: ReadonlyMap<string, readonly WorkingHours[]>;
  busyByStylist: ReadonlyMap<string, readonly BookedInterval[]>;
  bookable: (start: Date, duration: number) => boolean;
}): BookingDay[] {
  return input.dates.map((date) => {
    const { dayOfWeek } = resolveSalonDateTime(date, '12:00');
    const free = new Map<string, boolean>();
    let start: string | null = null;
    let end: string | null = null;
    for (const [stylistId, rows] of input.hoursByStylist) {
      const hours = rows.find((row) => row.dayOfWeek === dayOfWeek);
      if (!hours) continue;
      // HH:mm strings are zero-padded, so string order is time order.
      if (start === null || hours.startTime < start) start = hours.startTime;
      if (end === null || hours.endTime > end) end = hours.endTime;
      const busy = [...(input.busyByStylist.get(stylistId) ?? [])];
      for (const slot of buildSlotGridForWindow(date, hours, busy, input.duration, input.now)) {
        if (!input.bookable(resolveSalonDateTime(date, slot.time).utc, input.duration)) continue;
        free.set(slot.time, (free.get(slot.time) ?? false) || slot.available);
      }
    }
    const slots = [...free]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, available]) => ({ time, available }));
    const open = slots.some((slot) => slot.available);
    return {
      date,
      status: open ? 'OPEN' : 'UNAVAILABLE',
      hours: start !== null && end !== null ? { start, end } : null,
      slots: open ? slots : [],
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/app/services/booking-days.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/booking-days.ts src/app/services/booking-days.test.ts
git commit -m "feat: per-day availability that marks a stylist's whole day unavailable"
```

---

### Task 3: Load 14 days in three queries (`getBookingDays` + `fetchBookingDays`)

**Files:**
- Modify: `src/app/services/booking-service.ts` (imports; new export after `getAvailableSlotsUnion`)
- Modify: `src/app/actions/booking.ts` (import; new action after `fetchSlots`)
- Modify: `src/app/services/site-settings-defaults.test.ts:47-53` (gate count 4 → 5)
- Test: `src/app/services/booking-days-loader.test.ts`

**Interfaces:**
- Consumes: `buildBookingDays`, `BookingDay`, `WorkingHours` (Task 2); `loadExternalBusy`, `toBookedInterval` (`./external-busy`); `isWithinBookingHorizon`; `ANY_STYLIST_ID` (`@/app/lib/booking-constants`).
- Produces:
  - `getBookingDays(stylistId: string, dates: string[], serviceDuration: number): Promise<BookingDay[]>` in `booking-service.ts`.
  - `fetchBookingDays(stylistId: string, dates: string[], serviceDuration: number): Promise<FetchBookingDaysResult>` in `actions/booking.ts`, with `export type FetchBookingDaysResult = { ok: true; days: BookingDay[] } | { ok: false }` and `export const BOOKING_DAYS_MAX = 14`.

- [ ] **Step 1: Write the failing tests** — create `src/app/services/booking-days-loader.test.ts`:

```ts
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

type Where = Record<string, unknown>;
function fixture(options: { enabled?: boolean; fail?: boolean } = {}) {
  const calls: { model: string; where: Where }[] = [];
  const hours = [
    { stylistId: 'funky', dayOfWeek: 2, startTime: '10:15', endTime: '19:00' },
    { stylistId: 'lox', dayOfWeek: 2, startTime: '10:15', endTime: '19:00' },
  ];
  const pause = { stylistId: 'funky', start: resolveSalonDateTime('2026-10-06', '10:00').utc, end: resolveSalonDateTime('2026-10-06', '20:30').utc };
  const db = {
    availability: { findMany: async ({ where }: { where: Where }) => {
      calls.push({ model: 'availability', where });
      if (options.fail) throw new Error('db down');
      return where.stylistId ? hours.filter((row) => row.stylistId === where.stylistId) : hours;
    } },
    appointment: { findMany: async ({ where }: { where: Where }) => { calls.push({ model: 'appointment', where }); return []; } },
    externalBusyBlock: { findMany: async ({ where }: { where: Where }) => { calls.push({ model: 'externalBusyBlock', where }); return [pause]; } },
  };
  const readiness = { isBookingEnabled: async () => options.enabled !== false, assertOnlineBookingReady: async () => ({}) };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': readiness,
    './notification-outbox-service': {},
  });
  const actions = loadServerModule<typeof import('../actions/booking')>('src/app/actions/booking.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/booking-service': service,
    '@/app/lib/booking-maintenance': readiness,
    '@/app/services/notification-outbox-service': {},
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1', role: 'USER' }) },
    '@/app/lib/rate-limit': { bookingLimiter: { check: async () => true }, discountLimiter: { check: async () => true } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { revalidatePath: () => undefined },
    'next/server': { after: (callback: () => unknown) => callback() },
  });
  return { service, actions, calls };
}

const FOURTEEN = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));

test('fourteen days cost exactly three queries', async () => {
  const f = fixture();
  const days = await f.service.getBookingDays('funky', FOURTEEN, 60);
  assert.equal(days.length, 14);
  assert.deepEqual(f.calls.map((call) => call.model).sort(), ['appointment', 'availability', 'externalBusyBlock']);
});

test('a named stylist on a Fresha Pause day is Unavailable', async () => {
  const f = fixture();
  const [tuesday] = await f.service.getBookingDays('funky', ['2026-10-06'], 60);
  assert.equal(tuesday.status, 'UNAVAILABLE');
});

test('Anyone on the same day stays open through the other stylist', async () => {
  const f = fixture();
  const [tuesday] = await f.service.getBookingDays(ANY_STYLIST_ID, ['2026-10-06'], 60);
  assert.equal(tuesday.status, 'OPEN');
});

test('only active stylists’ working rows are read', async () => {
  const f = fixture();
  await f.service.getBookingDays(ANY_STYLIST_ID, ['2026-10-06'], 60);
  const where = f.calls.find((call) => call.model === 'availability')!.where;
  assert.deepEqual(where, { isOff: false, stylist: { isActive: true } });
});

test('the action refuses bad input without touching the database', async () => {
  const f = fixture();
  for (const [stylist, dates, duration] of [
    ['funky', [], 60], ['funky', ['2026-13-40'], 60], ['funky', ['2026-10-06'], 3],
    ['funky', [...FOURTEEN, '2026-10-15'], 60], ['', ['2026-10-06'], 60],
  ] as const) {
    assert.deepEqual(await f.actions.fetchBookingDays(stylist, [...dates], duration), { ok: true, days: [] });
  }
  assert.equal(f.calls.length, 0);
});

test('the action shows nothing while online booking is switched off', async () => {
  const f = fixture({ enabled: false });
  assert.deepEqual(await f.actions.fetchBookingDays('funky', ['2026-10-06'], 60), { ok: true, days: [] });
  assert.equal(f.calls.length, 0);
});

test('a lookup failure is reported as a failure, not as an unavailable fortnight', async () => {
  const f = fixture({ fail: true });
  assert.deepEqual(await f.actions.fetchBookingDays('funky', ['2026-10-06'], 60), { ok: false });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= node --conditions=react-server --import tsx --test src/app/services/booking-days-loader.test.ts`
Expected: FAIL — `getBookingDays` / `fetchBookingDays` is not a function.

- [ ] **Step 3: Implement the loader** — in `src/app/services/booking-service.ts` add imports:

```ts
import { buildBookingDays, type BookingDay, type WorkingHours } from './booking-days';
import { ANY_STYLIST_ID } from '@/app/lib/booking-constants';
```

and add after `getAvailableSlotsUnion`:

```ts
/**
 * Up to two weeks of the booking page's date strip and time grid for one
 * stylist or "Anyone". Three batched reads cover the whole range — working
 * hours, appointments and synced busy blocks (a Fresha "Pause" arrives as one
 * of those) — so a visit costs the same few queries however many days it shows.
 */
export async function getBookingDays(stylistId: string, dates: string[], serviceDuration: number): Promise<BookingDay[]> {
  if (dates.length === 0) return [];
  const now = new Date();
  const ordered = [...dates].sort();
  const window = {
    start: salonDayWindow(resolveSalonDateTime(ordered[0], '12:00').utc).start,
    end: salonDayWindow(resolveSalonDateTime(ordered[ordered.length - 1], '12:00').utc).end,
  };
  const rows = await prisma.availability.findMany({
    where: { isOff: false, stylist: { isActive: true }, ...(stylistId === ANY_STYLIST_ID ? {} : { stylistId }) },
    select: { stylistId: true, dayOfWeek: true, startTime: true, endTime: true },
  });
  const stylistIds = [...new Set(rows.map((row) => row.stylistId))];
  const [appointments, externalBlocks] = stylistIds.length === 0
    ? [[], []]
    : await Promise.all([
      prisma.appointment.findMany({
        where: { stylistId: { in: stylistIds }, date: { gte: window.start, lte: window.end }, status: { not: 'CANCELLED' } },
        select: slotAppointmentSelect,
      }),
      loadExternalBusy(prisma, stylistIds, window),
    ]);

  const hoursByStylist = new Map<string, WorkingHours[]>();
  for (const row of rows) hoursByStylist.set(row.stylistId, [...(hoursByStylist.get(row.stylistId) ?? []), row]);
  const busyByStylist = new Map<string, BookedInterval[]>();
  const addBusy = (id: string, interval: BookedInterval) => busyByStylist.set(id, [...(busyByStylist.get(id) ?? []), interval]);
  // Frozen booking duration wins over the live service duration (see getAvailableSlots).
  for (const appt of appointments) addBusy(appt.stylistId, { start: new Date(appt.date), durationMin: appt.durationAtBooking ?? appt.service.duration });
  for (const block of externalBlocks) addBusy(block.stylistId, toBookedInterval(block));

  return buildBookingDays({
    dates, duration: serviceDuration, now, hoursByStylist, busyByStylist,
    bookable: (start, duration) => isWithinBookingHorizon(start, duration, now),
  });
}
```

- [ ] **Step 4: Implement the action** — in `src/app/actions/booking.ts` add `getBookingDays` to the `@/app/services/booking-service` import, add `import type { BookingDay } from '@/app/services/booking-days';`, and after `fetchSlots`:

```ts
export const BOOKING_DAYS_MAX = 14;
export type FetchBookingDaysResult = { ok: true; days: BookingDay[] } | { ok: false };

/**
 * The booking page's whole date strip in one request: each day's status, hours
 * and every time (taken ones greyed). Same gate and input rules as fetchSlots.
 */
export async function fetchBookingDays(
  stylistId: string,
  dates: string[],
  serviceDuration: number,
): Promise<FetchBookingDaysResult> {
  if (!(await isBookingEnabled())) {
    return { ok: true, days: [] };
  }
  const duration = SERVICE_DURATION.safeParse(serviceDuration);
  const validDates = Array.isArray(dates) && dates.length > 0 && dates.length <= BOOKING_DAYS_MAX &&
    dates.every((date) => typeof date === 'string' && isValidSalonDate(date));
  if (!duration.success || typeof stylistId !== 'string' || !stylistId || !validDates) {
    return { ok: true, days: [] };
  }
  try {
    return { ok: true, days: await getBookingDays(stylistId, [...new Set(dates)], duration.data) };
  } catch (error) {
    // A lookup failure is NOT "unavailable" — the page says "couldn't load" instead.
    console.error('fetchBookingDays failed', { stylistId, days: dates.length, duration: duration.data }, error);
    return { ok: false };
  }
}
```

- [ ] **Step 5: Update the gate-count test** — in `src/app/services/site-settings-defaults.test.ts` change the test to:

```ts
test('all five booking entry points gate on isBookingEnabled', () => {
  const actions = readFileSync(join(root, 'app/actions/booking.ts'), 'utf8');
  const guards = actions.match(/if \(!\(await isBookingEnabled\(\)\)\)/g) ?? [];
  assert.equal(
    guards.length,
    5,
    'getAvailableSlotsAction, fetchSlots, fetchBookingDays, submitBooking and rescheduleAppointment must each gate',
  );
```

(keep the rest of that test body as is).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= node --conditions=react-server --import tsx --test src/app/services/booking-days-loader.test.ts src/app/services/site-settings-defaults.test.ts src/app/services/booking-persistence.test.ts src/app/services/booking-horizon.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/services/booking-service.ts src/app/actions/booking.ts src/app/services/booking-days-loader.test.ts src/app/services/site-settings-defaults.test.ts
git commit -m "feat: load a fortnight of booking days in three queries"
```

---

### Task 4: Lock "Anyone never assigns an unavailable stylist"

The behaviour already exists (`createBookingForFirstAvailable` merges synced blocks before `firstFreeStylist`); this task pins it so it cannot regress.

**Files:**
- Test: `src/app/services/booking-anyone-unavailable.test.ts`

**Interfaces:**
- Consumes: `createBookingForFirstAvailable(data: NewBookingInput & { candidateStylistIds: string[] })` from `booking-service.ts`.

- [ ] **Step 1: Write the test**

```ts
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

function fixture(blocks: { stylistId: string; start: Date; end: Date }[]) {
  const stored: Record<string, unknown>[] = [];
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'test', isPublic: true, isBookable: true,
  };
  const tx = {
    service: { findUnique: async () => liveService },
    stylist: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, isActive: true, treatwellExternalId: null }) },
    availability: { findFirst: async () => ({ startTime: '10:00', endTime: '19:00' }) },
    appointment: {
      count: async () => 0,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'appointment-1', notificationVersion: 0, ...data, user: { name: 'C', email: 'c@example.test', phone: null }, stylist: { name: String(data.stylistId) }, service: liveService };
        stored.push(row);
        return row;
      },
    },
    externalBusyBlock: { findMany: async ({ where }: { where: { stylistId: { in: string[] } } }) => blocks.filter((block) => where.stylistId.in.includes(block.stylistId)) },
  };
  const db = { ...tx, $transaction: async (fn: (database: typeof tx) => Promise<unknown>) => fn(tx) };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '0' }) },
    './notification-outbox-service': { enqueueAppointmentNotification: async () => undefined },
  });
  return { service, stored };
}

const tuesday = (time: string) => resolveSalonDateTime('2026-10-06', time).utc;

test('Anyone skips a stylist on a Fresha Pause even when they are first in priority order', async () => {
  const f = fixture([{ stylistId: 'funky', start: tuesday('10:00'), end: tuesday('20:30') }]);
  await f.service.createBookingForFirstAvailable({ serviceId: 'service-1', date: tuesday('11:00'), userId: 'user-1', candidateStylistIds: ['funky', 'lox'] });
  assert.equal(f.stored[0].stylistId, 'lox');
});

test('Anyone refuses the time when every candidate is unavailable', async () => {
  const f = fixture([
    { stylistId: 'funky', start: tuesday('10:00'), end: tuesday('20:30') },
    { stylistId: 'lox', start: tuesday('11:00'), end: tuesday('12:00') },
  ]);
  await assert.rejects(
    f.service.createBookingForFirstAvailable({ serviceId: 'service-1', date: tuesday('11:00'), userId: 'user-1', candidateStylistIds: ['funky', 'lox'] }),
    /no stylist|not available|unavailable/i,
  );
  assert.equal(f.stored.length, 0);
});
```

- [ ] **Step 2: Run it**

Run: `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= node --conditions=react-server --import tsx --test src/app/services/booking-anyone-unavailable.test.ts`
Expected: PASS on the first run (behaviour already exists). If the rejection text differs, match the actual `NO_STYLIST_AT_TIME` message rather than weakening the assertion — check `src/app/services/booking-errors.ts`. To prove the test bites, temporarily delete the `for (const row of externalBlocks)` loop in `createBookingForFirstAvailable`, confirm the first test FAILS (assigns `funky`), then restore it.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/booking-anyone-unavailable.test.ts
git commit -m "test: Anyone never assigns a stylist who is unavailable in Fresha"
```

---

### Task 5: Confirm ignores Fresha's copy of the booking itself (echo guard)

**Files:**
- Modify: `src/app/services/booking-service.ts:67-108` (`assertAppointmentSlotAvailable`)
- Modify: `src/app/actions/admin.ts:487`
- Test: `src/app/services/booking-echo-guard.test.ts`

**Interfaces:**
- Produces: `assertAppointmentSlotAvailable(tx, appointment, date, loadedBlocking?, options?: { ignoreOwnEcho?: boolean })`. With `ignoreOwnEcho` and a non-empty `appointment.id`, an external block whose start **and** end equal this appointment's own `[date, date + duration)` is not a clash.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const start = resolveSalonDateTime('2026-10-06', '11:00').utc;
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

function check(block: { start: Date; end: Date }, id: string, options?: { ignoreOwnEcho?: boolean }) {
  const tx = {
    availability: { findFirst: async () => ({ startTime: '10:00', endTime: '19:00' }) },
    appointment: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => [{ stylistId: 'lox', ...block }] },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': {}, '@/app/lib/booking-maintenance': {}, './notification-outbox-service': {},
  });
  const appointment = { id, stylistId: 'lox', durationAtBooking: 60, service: { duration: 60 } };
  return service.assertAppointmentSlotAvailable(tx as never, appointment, start, undefined, options);
}

test('Confirm ignores an exact copy of the booking itself', async () => {
  await check({ start, end: minutes(60) }, 'appt-1', { ignoreOwnEcho: true });
});

test('a block one minute longer is a real clash, even on Confirm', async () => {
  await assert.rejects(check({ start, end: minutes(61) }, 'appt-1', { ignoreOwnEcho: true }));
});

test('a block starting one minute earlier is a real clash, even on Confirm', async () => {
  await assert.rejects(check({ start: minutes(-1), end: minutes(59) }, 'appt-1', { ignoreOwnEcho: true }));
});

test('without the flag an identical block still clashes', async () => {
  await assert.rejects(check({ start, end: minutes(60) }, 'appt-1'));
});

test('a brand-new booking never ignores an identical block', async () => {
  await assert.rejects(check({ start, end: minutes(60) }, '', { ignoreOwnEcho: true }));
});
```

Save as `src/app/services/booking-echo-guard.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= node --conditions=react-server --import tsx --test src/app/services/booking-echo-guard.test.ts`
Expected: the first test FAILS (clash thrown); the others pass.

- [ ] **Step 3: Implement** — change `assertAppointmentSlotAvailable` in `booking-service.ts`:

```ts
/** Recheck the full reserved duration and current calendar inside a mutation. */
export async function assertAppointmentSlotAvailable(
  tx: Prisma.TransactionClient,
  appointment: Pick<Appointment, 'id' | 'stylistId' | 'durationAtBooking'> & { service: Pick<Service, 'duration'> },
  date: Date,
  loadedBlocking?: BookedInterval[],
  options: { ignoreOwnEcho?: boolean } = {},
) {
```

and replace the `blocking = [...]` assignment inside `if (!blocking) { … }` with:

```ts
    // Our busy feed publishes this booking to Fresha. A marketplace that
    // re-exports what it imported hands it back as a synced block with exactly
    // this booking's start and end. Only when confirming an existing booking at
    // its own time may that copy be ignored — anything else is a real clash.
    const ownEnd = date.getTime() + duration * 60_000;
    const isOwnEcho = (row: { start: Date; end: Date }) =>
      Boolean(options.ignoreOwnEcho && appointment.id) &&
      row.start.getTime() === date.getTime() && row.end.getTime() === ownEnd;
    blocking = [
      ...existing.map((row) => ({ start: row.date, durationMin: row.durationAtBooking ?? row.service.duration })),
      ...external.filter((row) => !isOwnEcho(row)).map(toBookedInterval),
    ];
```

- [ ] **Step 4: Use it on Confirm** — in `src/app/actions/admin.ts` (inside `if (status === 'CONFIRMED') {`):

```ts
        await assertAppointmentSlotAvailable(tx, current, current.date, undefined, { ignoreOwnEcho: true });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= node --conditions=react-server --import tsx --test src/app/services/booking-echo-guard.test.ts src/app/services/booking-persistence.test.ts src/app/actions/*.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/services/booking-service.ts src/app/actions/admin.ts src/app/services/booking-echo-guard.test.ts
git commit -m "fix: confirming a booking ignores Fresha's copy of that same booking"
```

---

### Task 6: Admin calendar shows a whole-day block as "Unavailable"

**Files:**
- Modify: `src/app/lib/calendar-busy-display.ts`
- Modify: `src/components/admin/ScheduleDayGrid.tsx:439-462`, `src/components/admin/ScheduleWeekGrid.tsx:436-458`, `src/components/admin/ScheduleCalendar.tsx:229-243, 303, 653`
- Modify: `src/i18n/messages/en/adminSchedule.ts`, `src/i18n/messages/zh/adminSchedule.ts` (`busy` section)
- Test: `src/components/admin/ScheduleExternalBusy.test.ts`, `src/app/lib/calendar-busy-display.test.ts` (create)

**Interfaces:**
- Produces:

```ts
export type WorkingWindow = { startTime: string; endTime: string };
export function salonWorkingWindow(windows: readonly (WorkingWindow | null | undefined)[]): WorkingWindow | null;
export function isWholeDayBlock(block: { startMin: number; endMin: number }, window: WorkingWindow | null): boolean;
export function calendarBusyLabel(block, stylist, startMin, endMin, t, wholeDay?: boolean): { provider: string; range: string; synced: string; detail: string; unavailable: boolean };
```

- [ ] **Step 1: Add the strings**

`src/i18n/messages/en/adminSchedule.ts`, inside `busy: {`:

```ts
    unavailable: 'Unavailable',
    unavailableDetail: '{stylist} is unavailable · {range} (London time), imported from {provider}. Last imported {synced}. Manage this time in {provider}.',
    agendaUnavailable: '{stylist} · Unavailable all day',
```

`src/i18n/messages/zh/adminSchedule.ts`, inside `busy: {`:

```ts
    unavailable: '不可預約',
    unavailableDetail: '{stylist} 不可預約 · {range}（倫敦時間），由 {provider} 匯入。最後匯入時間：{synced}。請在 {provider} 管理這段時間。',
    agendaUnavailable: '{stylist} · 全日不可預約',
```

- [ ] **Step 2: Write the failing unit tests** — create `src/app/lib/calendar-busy-display.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { isWholeDayBlock, salonWorkingWindow } from './calendar-busy-display';

test('a Pause that overshoots the stylist’s hours covers the working day', () => {
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1230 }, { startTime: '10:15', endTime: '19:00' }), true);
});

test('a lunch block does not', () => {
  assert.equal(isWholeDayBlock({ startMin: 780, endMin: 840 }, { startTime: '10:00', endTime: '19:00' }), false);
});

test('a block that stops before closing does not', () => {
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1080 }, { startTime: '10:00', endTime: '19:00' }), false);
});

test('with no working window only a midnight-to-midnight block counts', () => {
  assert.equal(isWholeDayBlock({ startMin: 0, endMin: 1440 }, null), true);
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1230 }, null), false);
});

test('the salon window is the earliest start and latest finish of anyone rostered', () => {
  assert.deepEqual(salonWorkingWindow([{ startTime: '10:15', endTime: '19:00' }, null, { startTime: '10:00', endTime: '19:30' }, undefined]), { startTime: '10:00', endTime: '19:30' });
  assert.equal(salonWorkingWindow([null, undefined]), null);
});
```

And add to `src/components/admin/ScheduleExternalBusy.test.ts` (reuses its `render` helper; the stylist there has `availability: null`, so the salon window falls back to midnight–midnight — pass a rostered second stylist for the realistic case):

```ts
for (const view of ['Day', 'Week'] as const) {
  test(`${view} calendar labels a whole-day Fresha Pause "Unavailable", keeping Fresha in the detail`, () => {
    // 10:00–20:30 London on Tue 6 Oct 2026 (BST): 09:00Z–19:30Z. All-day export: midnight to midnight.
    const nodes = render(view, 'FRESHA', '2026-10-05T23:00:00Z', '2026-10-06T23:00:00Z', '2026-10-06');
    assert.ok(nodes.some(node => node.props.children === 'Unavailable'), 'the block reads Unavailable');
    assert.ok(nodes.some(node => String(node.props['aria-label']).includes('Funky is unavailable') && String(node.props['aria-label']).includes('Fresha')));
  });
  test(`${view} calendar keeps a short Fresha block labelled Fresha`, () => {
    const nodes = render(view, 'FRESHA', '2026-10-23T13:00:00Z', '2026-10-23T13:15:00Z');
    assert.ok(!nodes.some(node => node.props.children === 'Unavailable'));
  });
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/app/lib/calendar-busy-display.test.ts src/components/admin/ScheduleExternalBusy.test.ts`
Expected: FAIL (functions missing; "Unavailable" never rendered).

- [ ] **Step 4: Implement the helpers** — in `src/app/lib/calendar-busy-display.ts` add:

```ts
export type WorkingWindow = { startTime: string; endTime: string };

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Earliest start and latest finish of everyone rostered that day; null when nobody is. */
export function salonWorkingWindow(windows: readonly (WorkingWindow | null | undefined)[]): WorkingWindow | null {
  const rostered = windows.filter((window): window is WorkingWindow => Boolean(window));
  if (rostered.length === 0) return null;
  return {
    startTime: rostered.map((w) => w.startTime).sort()[0],
    endTime: rostered.map((w) => w.endTime).sort().at(-1)!,
  };
}

/**
 * A synced block that covers the whole working window — how a Fresha "Pause"
 * (a day off) arrives. `window` is the stylist's own hours, or the salon's when
 * they are not rostered that day; with neither, only a full calendar day counts.
 */
export function isWholeDayBlock(block: { startMin: number; endMin: number }, window: WorkingWindow | null): boolean {
  if (!window) return block.startMin <= 0 && block.endMin >= 1440;
  return block.startMin <= minutesOf(window.startTime) && block.endMin >= minutesOf(window.endTime);
}
```

and change `calendarBusyLabel`:

```ts
/** Platform names are brands and stay as they are in every language. */
export function calendarBusyLabel(block: CalendarBusyBlock, stylist: string, startMin: number, endMin: number, t: Translate<Messages['adminSchedule']>, wholeDay = false) {
  const provider = block.source === 'TREATWELL' ? 'Treatwell' : block.source === 'FRESHA' ? 'Fresha' : t('busy.external');
  const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const range = `${time(startMin)}–${time(endMin)}`;
  const synced = formatSalonDateTime(t.locale, new Date(block.lastSyncAt));
  const detail = wholeDay
    ? t('busy.unavailableDetail', { provider, stylist, range, synced })
    : t('busy.detail', { provider, stylist, range, synced });
  return { provider: wholeDay ? t('busy.unavailable') : provider, range, synced, detail, unavailable: wholeDay };
}
```

- [ ] **Step 5: Use it in the Day grid** — in `ScheduleDayGrid.tsx` import `isWholeDayBlock, salonWorkingWindow` alongside the existing import from `@/app/lib/calendar-busy-display`, compute once near `dayBusy`:

```ts
  const salonWindow = useMemo(() => salonWorkingWindow(stylists.map((stylist) => stylist.availability)), [stylists]);
```

and in the busy-block map:

```tsx
                .map((block) => {
                  const { startMin, endMin } = block;
                  const wholeDay = isWholeDayBlock(block, stylist.availability ?? salonWindow);
                  const label = calendarBusyLabel(block, stylist.name, startMin, endMin, t, wholeDay);
                  return (
                    <div
                      key={block.id}
                      role="note"
                      tabIndex={0}
                      aria-label={label.detail}
                      title={label.detail}
                      onClick={(event) => event.stopPropagation()}
                      className={`absolute left-1 right-1 overflow-hidden rounded border px-1 leading-4 focus-visible:outline-2 focus-visible:outline-[#174F7F] ${
                        wholeDay
                          ? 'border-zinc-400 border-l-4 border-l-zinc-600 bg-[repeating-linear-gradient(135deg,var(--color-zinc-200)_0_6px,var(--color-zinc-100)_6px_12px)] py-1 text-xs text-zinc-800'
                          : 'border-zinc-300 border-l-4 border-l-zinc-500 bg-zinc-100 text-[10px] text-zinc-700'
                      }`}
                      style={{
                        top: minutesToOffset(startMin, bounds.startMin, PX_PER_MINUTE),
                        height: Math.max(18, (endMin - startMin) * PX_PER_MINUTE),
                      }}
                    >
                      <span className="mr-1 font-semibold">{label.provider}</span>
                      <span className="whitespace-nowrap tabular-nums">{label.range}</span>
                    </div>
                  );
                })}
```

(Only the `wholeDay`/`label` lines and `className` change; `top`/`height` are as before. Tailwind v4 exposes the palette as `--color-zinc-*` variables, which the hatched background uses.)

- [ ] **Step 6: Use it in the Week grid** — in `ScheduleWeekGrid.tsx`, import the two helpers; inside the per-day column (where `weekday` and `dayBusy` are in scope, near line 392–396) compute:

```ts
            const salonWindow = salonWorkingWindow(stylists.map((stylist) => stylist.availabilityByWeekday[weekday]));
```

and in the busy map:

```tsx
                const wholeDay = isWholeDayBlock(block, stylistById.get(block.stylistId)?.availabilityByWeekday[weekday] ?? salonWindow);
                const label = calendarBusyLabel(block, stylistById.get(block.stylistId)?.name ?? t('appointment.stylistFallback'), startMin, endMin, t, wholeDay);
```

with the same `wholeDay ? … : …` className split as the Day grid, keeping the Week grid's own sizes (`border-l-2`, `px-0.5`, `text-[9px] leading-3` for the normal case; `text-[10px]` and the hatched background for `wholeDay`).

- [ ] **Step 7: Use it in the agenda** — in `ScheduleCalendar.tsx` give `BusyAgenda` a `dayKey: string` prop and pass `dayKey={dateStr}` at line 303 and `dayKey={key}` at line 653. Inside it:

```tsx
function BusyAgenda({ blocks, stylists, dayKey }: { blocks: ReturnType<typeof calendarBusyForDay>; stylists: RosterStylist[]; dayKey: string }) {
  const t = useT('adminSchedule');
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  const hoursOf = (entry: RosterStylist | undefined) => {
    const row = entry?.availabilities.find((a) => a.dayOfWeek === weekday && !a.isOff);
    return row ? { startTime: row.startTime, endTime: row.endTime } : null;
  };
  const salonWindow = salonWorkingWindow(stylists.map(hoursOf));
  return <ul className="divide-y divide-zinc-100">
    {blocks.map((block) => {
      const entry = stylists.find((candidate) => candidate.id === block.stylistId);
      const stylist = entry?.name ?? t('appointment.stylistFallback');
      const wholeDay = isWholeDayBlock(block, hoursOf(entry) ?? salonWindow);
      const label = calendarBusyLabel(block, stylist, block.startMin, block.endMin, t, wholeDay);
      return <li key={block.id} role="note" aria-label={label.detail} className="border-l-4 border-l-zinc-400 bg-zinc-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 font-semibold text-zinc-800"><span>{label.provider}</span><span className="tabular-nums">{label.range}</span></div>
        <p className="mt-1 text-zinc-600">{wholeDay ? t('busy.agendaUnavailable', { stylist }) : t('busy.agendaImported', { stylist })}</p>
        <p className="mt-1 text-xs text-zinc-500">{t('busy.agendaSynced', { synced: label.synced })}</p>
      </li>;
    })}
  </ul>;
}
```

(import `isWholeDayBlock, salonWorkingWindow` next to `calendarBusyForDay, calendarBusyLabel`).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/app/lib/calendar-busy-display.test.ts src/components/admin/ScheduleExternalBusy.test.ts src/i18n/messages/completeness.test.ts`
Expected: PASS (existing provider-label tests still pass).

- [ ] **Step 9: Commit**

```bash
git add src/app/lib/calendar-busy-display.ts src/app/lib/calendar-busy-display.test.ts src/components/admin/ScheduleDayGrid.tsx src/components/admin/ScheduleWeekGrid.tsx src/components/admin/ScheduleCalendar.tsx src/components/admin/ScheduleExternalBusy.test.ts src/i18n/messages/en/adminSchedule.ts src/i18n/messages/zh/adminSchedule.ts
git commit -m "feat: admin calendar shows a stylist's day off as an Unavailable block"
```

---

### Task 7: Booking page — greyed dates, Unavailable block, greyed times

**Files:**
- Create: `src/components/booking/DayAvailability.tsx`
- Modify: `src/components/booking/BookingWizard.tsx` (slot state + effect at ~86-150, grouping at ~245-262, date strip + time panel at ~609-697, `TimeSlotButton` at ~826)
- Modify: `src/i18n/messages/en/booking.ts`, `src/i18n/messages/zh/booking.ts` (`date` section)
- Test: `src/components/booking/DayAvailability.test.ts`

**Interfaces:**
- Consumes: `fetchBookingDays`, `FetchBookingDaysResult` (Task 3); `BookingDay` (Task 2).
- Produces (all in `DayAvailability.tsx`, `'use client'`):

```ts
export function DayChip(props: { day: string; weekday: string; dayOfMonth: number; month: string; fullLabel: string; selected: boolean; unavailable: boolean; onSelect: () => void }): JSX.Element;
export function UnavailableDayBlock(props: { hours: { start: string; end: string } | null; stylistName: string | null }): JSX.Element;
export function TimeSlotGrid(props: { slots: { time: string; available: boolean }[]; selectedTime: string | null; onSelect: (time: string) => void }): JSX.Element;
```

- [ ] **Step 1: Add the strings** — `src/i18n/messages/en/booking.ts`, inside `date: {`:

```ts
    unavailable: 'Unavailable',
    dayUnavailableLabel: '{date}, unavailable',
    slotUnavailableLabel: '{time}, unavailable',
    unavailableHelp: '{name} isn’t available on this day. Please choose another day.',
    unavailableHelpAnyone: 'No stylist is available on this day. Please choose another day.',
```

`src/i18n/messages/zh/booking.ts`, inside `date: {`:

```ts
    unavailable: '不可預約',
    dayUnavailableLabel: '{date}，不可預約',
    slotUnavailableLabel: '{time}，不可預約',
    unavailableHelp: '{name} 當日不可預約，請選擇其他日子。',
    unavailableHelpAnyone: '當日沒有髮型師可供預約，請選擇其他日子。',
```

- [ ] **Step 2: Write the failing component tests** — create `src/components/booking/DayAvailability.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  const rendered = typeof element.type === 'function' ? (element.type as (p: unknown) => unknown)(element.props) : null;
  return [element, ...elements(element.props.children), ...elements(rendered)];
}
const text = (nodes: Element[]) => nodes.flatMap((node) => [node.props.children].flat().filter((c) => typeof c === 'string' || typeof c === 'number')).join(' ');
const ui = loadServerModule<typeof import('./DayAvailability')>('src/components/booking/DayAvailability.tsx', {
  '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace) },
});

test('an unavailable date is greyed, labelled Unavailable, and still selectable to show the block', () => {
  let selected = false;
  const nodes = elements(ui.DayChip({ day: '2026-10-06', weekday: 'Tue', dayOfMonth: 6, month: 'Oct', fullLabel: 'Tuesday 6 October', selected: false, unavailable: true, onSelect: () => { selected = true; } }));
  const button = nodes.find((node) => node.type === 'button')!;
  assert.equal(button.props['aria-label'], 'Tuesday 6 October, unavailable');
  assert.match(String(button.props.className), /text-zinc-400/);
  assert.ok(text(nodes).includes('Unavailable'));
  (button.props.onClick as () => void)();
  assert.equal(selected, true);
});

test('the whole-day block says Unavailable with the hours and who', () => {
  const nodes = elements(ui.UnavailableDayBlock({ hours: { start: '10:15', end: '19:00' }, stylistName: 'Funky' }));
  const words = text(nodes);
  assert.ok(words.includes('Unavailable'));
  assert.ok(words.includes('10:15 – 19:00'));
  assert.ok(words.includes('Funky isn’t available on this day.'));
});

test('the whole-day block for Anyone names nobody and shows no hours when nobody is rostered', () => {
  const words = text(elements(ui.UnavailableDayBlock({ hours: null, stylistName: null })));
  assert.ok(words.includes('No stylist is available on this day.'));
  assert.ok(!/\d\d:\d\d/.test(words));
});

test('taken times are shown greyed and cannot be picked', () => {
  const picked: string[] = [];
  const nodes = elements(ui.TimeSlotGrid({ slots: [{ time: '10:00', available: true }, { time: '10:30', available: false }], selectedTime: null, onSelect: (time) => picked.push(time) }));
  const buttons = nodes.filter((node) => node.type === 'button');
  assert.equal(buttons.length, 2);
  const taken = buttons.find((node) => node.props['aria-label'] === '10:30, unavailable')!;
  assert.equal(taken.props.disabled, true);
  assert.match(String(taken.props.className), /line-through/);
  (buttons[0].props.onClick as () => void)();
  assert.deepEqual(picked, ['10:00']);
});

test('times are grouped into morning, afternoon and evening', () => {
  const words = text(elements(ui.TimeSlotGrid({ slots: [{ time: '10:00', available: true }, { time: '13:00', available: false }, { time: '17:30', available: true }], selectedTime: null, onSelect: () => undefined })));
  assert.ok(words.includes('Morning') && words.includes('Afternoon') && words.includes('Evening'));
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/components/booking/DayAvailability.test.ts`
Expected: FAIL — cannot find `./DayAvailability`.

- [ ] **Step 4: Implement** — create `src/components/booking/DayAvailability.tsx`:

```tsx
'use client';

import { useT } from '@/i18n/client';

/** A date in the booking strip. An unavailable day is greyed but still opens, so the customer sees why. */
export function DayChip({ weekday, dayOfMonth, month, fullLabel, selected, unavailable, onSelect }: {
  day: string; weekday: string; dayOfMonth: number; month: string; fullLabel: string;
  selected: boolean; unavailable: boolean; onSelect: () => void;
}) {
  const t = useT('booking');
  const tone = selected
    ? (unavailable ? 'border-zinc-500 bg-zinc-200 text-zinc-600 shadow-md' : 'border-zinc-900 bg-zinc-900 text-white shadow-md')
    : unavailable
      ? 'border-zinc-200 bg-zinc-100 text-zinc-400 hover:border-zinc-300'
      : 'border-zinc-200 hover:border-zinc-400 hover:bg-white bg-white text-zinc-700';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={unavailable ? t('date.dayUnavailableLabel', { date: fullLabel }) : fullLabel}
      className={`flex-shrink-0 snap-start w-20 lg:w-full p-3 rounded-lg border flex lg:flex-row flex-col items-center lg:justify-between justify-center transition-all ${tone}`}
    >
      <div className="text-center lg:text-left">
        <span className={`text-xs uppercase font-bold block ${selected && !unavailable ? 'text-zinc-300' : unavailable ? 'text-zinc-400' : 'text-zinc-500'}`}>{weekday}</span>
        <span className={`text-lg font-bold block leading-tight ${unavailable ? 'line-through decoration-zinc-400' : ''}`}>{dayOfMonth}</span>
      </div>
      <span className={`text-xs ${unavailable ? 'font-medium text-zinc-500' : 'text-zinc-400'}`}>{unavailable ? t('date.unavailable') : month}</span>
    </button>
  );
}

/** The day has no bookable time: one big block, like a booking or Fresha's "Pause". Never says why. */
export function UnavailableDayBlock({ hours, stylistName }: { hours: { start: string; end: string } | null; stylistName: string | null }) {
  const t = useT('booking');
  return (
    <div
      role="status"
      className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-zinc-300 border-l-4 border-l-zinc-500 bg-[repeating-linear-gradient(135deg,var(--color-zinc-200)_0_8px,var(--color-zinc-100)_8px_16px)] p-6 text-center"
    >
      <p className="text-lg font-semibold text-zinc-800">{t('date.unavailable')}</p>
      {hours && <p className="mt-1 text-sm tabular-nums text-zinc-700">{`${hours.start} – ${hours.end}`}</p>}
      <p className="mt-3 max-w-xs text-sm text-zinc-700">{stylistName ? t('date.unavailableHelp', { name: stylistName }) : t('date.unavailableHelpAnyone')}</p>
    </div>
  );
}

const PERIODS = ['morning', 'afternoon', 'evening'] as const;
const periodOf = (time: string) => {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
};

/** Every time of an open day; taken ones greyed and untappable. */
export function TimeSlotGrid({ slots, selectedTime, onSelect }: {
  slots: { time: string; available: boolean }[]; selectedTime: string | null; onSelect: (time: string) => void;
}) {
  const t = useT('booking');
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {PERIODS.map((period) => {
        const group = slots.filter((slot) => periodOf(slot.time) === period);
        if (group.length === 0) return null;
        return (
          <div key={period}>
            <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1">{t(`date.${period}`)}</h4>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {group.map((slot) => {
                const isSelected = slot.available && selectedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => slot.available && onSelect(slot.time)}
                    aria-pressed={slot.available ? isSelected : undefined}
                    aria-label={slot.available ? slot.time : t('date.slotUnavailableLabel', { time: slot.time })}
                    className={`min-h-[44px] py-3 px-2 text-sm font-medium border rounded-lg transition-all relative overflow-hidden ${
                      !slot.available
                        ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 line-through'
                        : isSelected
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-md z-10'
                          : 'border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 bg-white hover:bg-zinc-50'
                    }`}
                  >
                    {isSelected && <div className="absolute inset-0 bg-white/10 animate-pulse" aria-hidden="true"></div>}
                    {slot.time}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run the component tests**

Run: `TZ=UTC node --conditions=react-server --import tsx --test src/components/booking/DayAvailability.test.ts src/i18n/messages/completeness.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire into `BookingWizard.tsx`**
  1. Imports: replace `fetchSlots` with `fetchBookingDays` in the `@/app/actions/booking` import; add `import type { BookingDay } from '@/app/services/booking-days';` and `import { DayChip, TimeSlotGrid, UnavailableDayBlock } from './DayAvailability';`.
  2. State: replace `const [availableSlots, setAvailableSlots] = useState<string[]>([]);` with:

```ts
  const [bookingDays, setBookingDays] = useState<BookingDay[]>([]);
  // Bumped after a booking attempt is refused so the fortnight is re-read.
  const [daysVersion, setDaysVersion] = useState(0);
```

  3. Move the `days` constant (currently ~line 282) up above the effects, and replace the whole "Fetch slots when stylist or date changes" `useEffect` with:

```ts
  const days = useMemo(() => Array.from({ length: 14 }, (_, offset) => format(addDays(startOfToday(), offset), 'yyyy-MM-dd')), []);

  // One request per stylist/service fills the whole date strip and every day's
  // times; changing the day is then instant and costs no extra database work.
  useEffect(() => {
    if (!selectedStylist || !selectedService) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setSlotLoadFailed(false);
      try {
        const result = await fetchBookingDays(selectedStylist.id, days, selectedService.duration);
        if (cancelled) return;
        if (result.ok) setBookingDays(result.days);
        else { setBookingDays([]); setSlotLoadFailed(true); }
      } catch {
        if (cancelled) return;
        setBookingDays([]);
        setSlotLoadFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // selectedStylist is derived from its id each render; the id is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStylistId, selectedService, days, daysVersion]);

  const dayInfo = bookingDays.find((day) => day.date === dayString) ?? null;
  const isUnavailable = (day: string) => bookingDays.find((entry) => entry.date === day)?.status === 'UNAVAILABLE';
```

  4. In `handleSubmit`, in the final `else { setBookingError(result.error || t('confirm.bookingFailed')); }` branch add `setDaysVersion((version) => version + 1);` so a refused time disappears from the grid.
  5. Delete `getGroupedSlots`, `groupedSlots`, `hasAnySlots` and the local `TimeSlotButton` function (now in `DayAvailability.tsx`).
  6. Date strip: replace the `days.map((day) => { … <button …> … })` body with:

```tsx
                  {days.map((day) => (
                    <DayChip
                      key={day}
                      day={day}
                      weekday={dayLabel(day, { weekday: 'short' })}
                      dayOfMonth={Number(day.slice(8, 10))}
                      month={dayLabel(day, { month: 'short' })}
                      fullLabel={dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}
                      selected={day === selectedDay}
                      unavailable={!isLoading && isUnavailable(day)}
                      onSelect={() => { setSelectedDay(day); setSelectedTime(null); }}
                    />
                  ))}
```

  7. Time panel: replace the `isLoading ? … : hasAnySlots ? … : …` chain with:

```tsx
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-500 text-sm bg-zinc-50 rounded-xl border border-zinc-100" role="status">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 mb-3" aria-hidden="true"></div>
                  {t('date.checking')}
                </div>
              ) : dayInfo?.status === 'OPEN' ? (
                <TimeSlotGrid slots={dayInfo.slots} selectedTime={selectedTime} onSelect={setSelectedTime} />
              ) : dayInfo?.status === 'UNAVAILABLE' && !slotLoadFailed ? (
                <UnavailableDayBlock hours={dayInfo.hours} stylistName={selectedStylistId === ANY_STYLIST_ID ? null : selectedStylist?.name ?? null} />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-zinc-600 bg-zinc-50 rounded-xl border border-zinc-200 border-dashed text-center p-6">
                  <svg className="w-12 h-12 text-zinc-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="font-medium">{slotLoadFailed ? t('date.loadFailed') : t('date.noneAvailable')}</p>
                  <p className="text-sm text-zinc-500 mt-1">{slotLoadFailed ? t('date.loadFailedHelp') : t('date.noneAvailableHelp')}</p>
                </div>
              )}
```

  8. Keep the selected time valid: add after the new effect:

```ts
  // A time that is no longer free (after a reload) must not stay selected.
  useEffect(() => {
    if (selectedTime && !dayInfo?.slots.some((slot) => slot.available && slot.time === selectedTime)) setSelectedTime(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDays]);
```

- [ ] **Step 7: Type-check, lint, run the whole suite**

Run:
```bash
pnpm exec tsc --noEmit -p .
pnpm exec eslint src/components/booking src/app/services/booking-days.ts src/app/services/booking-service.ts src/app/actions/booking.ts src/app/actions/admin.ts src/app/lib/calendar-busy-display.ts src/components/admin
TZ=UTC DATABASE_URL="file:./dev.db" SESSION_SECRET=ci-test-secret POSTGRES_URL= pnpm test
```
Expected: only the 4 known `colorMath.test.ts` tsc errors; no lint errors; all tests pass (≥ 797 + the new ones).

- [ ] **Step 8: Update the registry and commit** — add to `readme/structure.md` (services and booking components sections): `buildBookingDays` (`services/booking-days.ts`), `getBookingDays` (`services/booking-service.ts`), `fetchBookingDays` (`actions/booking.ts`), `buildSlotGridForWindow` (`services/scheduling.ts`), `salonWorkingWindow`/`isWholeDayBlock` (`lib/calendar-busy-display.ts`), `DayChip`/`UnavailableDayBlock`/`TimeSlotGrid` (`components/booking/DayAvailability.tsx`).

```bash
git add src/components/booking src/i18n/messages/en/booking.ts src/i18n/messages/zh/booking.ts readme/structure.md
git commit -m "feat: booking page shows unavailable days as a block and taken times greyed out"
```

---

## After the plan (not code — owner/assistant follow-ups)

1. Visual check of `/book` (phone + desktop) and the admin Day/Week views against a local production rehearsal (see memory `local-verification-gotchas`).
2. PR → CI → merge → GitHub Actions deploy (the only production path).
3. Owner adds one far-future walk-in booking in Admin → Schedule; ~20 min later fetch that stylist's Fresha export to confirm the block landed in Fresha and whether an echo came back; then cancel it.
4. Re-measure Neon 24 h after deploy (`neonctl` + operations log); expect no change from ~1.0–1.3 CU-h/day.
