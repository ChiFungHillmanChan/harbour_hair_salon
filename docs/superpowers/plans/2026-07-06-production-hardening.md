# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the one CRITICAL bug, the 8 HIGH dependency CVEs, and the 20 confirmed WARNINGs (plus the highest-value INFO items) from the 2026-07-06 adversarial code review, so Harbour Hair Salon is genuinely production-ready.

**Architecture:** Small, surgical fixes on the existing Next.js 16 App Router + Prisma codebase. New logic is added to **prisma-free pure modules** (`scheduling.ts`, `salon-time.ts`, new `lib/redirect.ts`, new `lib/jwt.ts`) so it can be unit-tested with `node:test` — the existing test suite cannot import anything that pulls in `@/app/lib/prisma`, because `prisma.ts` throws at module load when no DB URL is set. Action/route/schema changes that cannot be unit-tested are verified with `tsc` + `lint` + the full test suite + a described manual check.

**Tech Stack:** Next.js 16.2.x, React 19, TypeScript, Prisma 5.22 (runtime client generated from `prisma/vercel/schema.prisma`), `jose` JWT, `bcryptjs`, Zod v4, `@upstash/ratelimit`, Resend, `node-ical`. Tests: `node --import tsx --test` over `src/**/*.test.ts`.

## Global Constraints

- **Edit ALL THREE Prisma schema files together** for any schema change: `prisma/dev/schema.prisma` (SQLite), `prisma/vercel/schema.prisma` (PostgreSQL — the runtime client), `prisma/prod/schema.prisma` (MSSQL). They must stay in sync.
- **Never read env vars at module top-level.** Wrap in functions for runtime access (Vercel convention).
- **Use Prisma generated types** from `@prisma/client`; never hand-write DB model interfaces.
- **Server actions** (`'use server'`) may only export `async` functions. Pure helpers go in a non-`'use server'` module.
- **`email-service.ts` uses `import 'server-only'`**, not `'use server'`.
- **Tailwind CSS only.** Brand is **monochrome black/white/grey** — do NOT introduce colour.
- **Test runner:** `node:test` via `tsx`. Test files are `*.test.ts` next to source. `pnpm test` auto-discovers them.
- **Baseline is green:** `npx tsc --noEmit` clean, `pnpm lint` clean, `pnpm test` = 116 passing. Every task must keep all three green.
- **`pnpm build` fails locally** (it hits the DB at build time and there is no local DB). This is expected — do NOT treat a local build failure as a regression. Verify with `tsc`/`lint`/`test`, and verify runtime-render/ISR behavior on a Vercel **preview** deploy.
- **Commit after every task.** Branch off `main` first; do not commit to `main` directly.

## How this plan is structured (read before starting)

Tasks are ordered by priority. **Each phase boundary is a safe stopping point** that ships real value:

- **Phase 0** — branch + dependency CVE bump (do first).
- **Phase 1** — the CRITICAL booking-availability bug.
- **Phase 2** — security WARNINGs.
- **Phase 3** — reliability WARNINGs.
- **Phase 4** — money-correctness WARNINGs (includes a DB migration).
- **Phase 5** — Treatwell data WARNING.
- **Phase 6** — test-coverage WARNINGs.
- **Phase 7** — INFO cleanups (lower priority; grouped).
- **Phase 8** — final verification + deploy.

Finding IDs (e.g. `#25`) refer to the review report. Pure-logic tasks use full TDD (test-first). Action/route/schema tasks that are not unit-testable in this codebase give the exact edit plus an explicit verification step — this is intentional and matches the existing codebase (booking/auth actions have no unit tests; their pure helpers do).

---

## Phase 0 — Branch & dependency CVEs

### Task 0.1: Create the working branch and confirm the baseline

**Files:** none (git + verification only)

- [ ] **Step 1: Branch off main**

```bash
cd /Users/hillmanchan/Desktop/client-website/harbour_hair_salon
git checkout main && git pull
git checkout -b prod-hardening
```

- [ ] **Step 2: Confirm the baseline is green**

Run: `npx tsc --noEmit && pnpm lint && pnpm test`
Expected: tsc no output, lint no errors, test ends with `# pass 116` / `# fail 0`.

If any of these already fail, STOP and report — the baseline must be green before changes.

### Task 0.2: Bump Next.js to clear 8 HIGH CVEs (#dependency-audit)

**Problem:** `next@16.2.0` is affected by 8 HIGH advisories, including **Middleware / Proxy bypass in App Router** (this app's entire auth model relies on `middleware.ts`), SSRF, and several DoS vectors. Latest patch is `16.2.10`.

**Files:**
- Modify: `package.json` (dependency versions — via package manager, not by hand)

- [ ] **Step 1: Upgrade next and its eslint config in lockstep**

```bash
pnpm up next@^16.2.10 eslint-config-next@^16.2.10
```

- [ ] **Step 2: Verify the toolchain still passes**

Run: `npx tsc --noEmit && pnpm lint && pnpm test`
Expected: all green (`# pass 116`).

- [ ] **Step 3: Confirm the HIGH advisories are gone**

Run: `pnpm audit --prod --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).advisories||{};const hi=Object.values(a).filter(x=>x.module_name==='next'&&x.severity==='high');console.log('next HIGH advisories:',hi.length)})"`
Expected: `next HIGH advisories: 0`. (Remaining low/moderate transitive advisories in `uuid`→`resend` and `@babel/core`→toolchain are acceptable; do not chase them.)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): bump next to 16.2.10 to clear 8 HIGH advisories (middleware bypass, SSRF, DoS)"
```

---

## Phase 1 — CRITICAL: booking availability is wrong every BST season

### Task 1.1: Build slot times in the salon timezone (fixes #25)

**Problem:** `buildStylistSlots` (in `booking-service.ts`) builds each candidate slot instant with **host-local** `startOfDay`/`setHours`, but appointments are stored as true-UTC instants from `resolveSalonDateTime`. On Vercel (`TZ=UTC`) during **British Summer Time** the two frames differ by one hour, so `hasConflict` compares the wrong instants: booked slots are offered (and fail at submit), and genuinely-free slots one hour earlier are hidden. The whole availability grid is wrong from late March to late October. The DB day-window in `getAvailableSlots`/`getAvailableSlotsUnion` uses the same fragile host-local pattern and is fixed here too.

**Fix strategy:** move slot construction into the **pure, prisma-free** `scheduling.ts` as `buildSlotsForWindow`, deriving each slot instant with `resolveSalonDateTime` (Intl-based, host-TZ independent). Inject `now` so it is unit-testable. Make `booking-service.ts` a thin adapter and switch its day-window queries to the already-tested `salonDayWindow`.

**Files:**
- Modify: `src/app/services/salon-time.ts` (export the date-string helper)
- Modify: `src/app/services/scheduling.ts` (add `TimeSlot`, `buildSlotsForWindow`)
- Modify: `src/app/services/booking-service.ts` (use the new pure builder + `salonDayWindow`)
- Test: `src/app/services/scheduling.test.ts` (add cases)

**Interfaces:**
- Produces: `buildSlotsForWindow(dateStr: string, availability: { startTime: string; endTime: string }, booked: BookedInterval[], serviceDuration: number, now: Date): TimeSlot[]`
- Produces: `export type TimeSlot = { time: string; available: boolean }` (moved to `scheduling.ts`, re-exported from `booking-service.ts` so existing importers like `RescheduleModal.tsx` keep working)
- Produces: `export function toSalonDateStr(date: string | Date): string` in `salon-time.ts` (the current private `toDateStr`, made public)

- [ ] **Step 1: Export the salon date-string helper**

In `src/app/services/salon-time.ts`, rename the private `toDateStr` to an exported `toSalonDateStr` and update its internal caller.

Change the function declaration (currently around line 30):

```ts
/** Reduce a date input to its salon-local calendar date (YYYY-MM-DD). */
export function toSalonDateStr(date: string | Date): string {
  if (typeof date === 'string') {
    // Accept "YYYY-MM-DD" or a full ISO string — keep the date portion.
    return date.slice(0, 10);
  }
  // `<input type="date">` / Zod `coerce.date()` produce a UTC-midnight Date,
  // so read the calendar date from its UTC fields (host-timezone independent).
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

And update its one internal use inside `resolveSalonDateTime` (around line 49):

```ts
  const dateStr = toSalonDateStr(date);
```

- [ ] **Step 2: Write the failing tests for `buildSlotsForWindow`**

Append to `src/app/services/scheduling.test.ts`:

```ts
import { buildSlotsForWindow } from './scheduling';
import { resolveSalonDateTime } from './salon-time';

test('buildSlotsForWindow — hides the slot a booking actually occupies (BST, host-TZ independent)', () => {
  const dateStr = '2026-07-01'; // BST: salon local is UTC+1
  const now = new Date('2026-06-01T00:00:00Z'); // well before the day, nothing hidden as "past"
  // A 60-min booking at 10:00 salon-local, stored the way createBooking stores it.
  const booked = [{ start: resolveSalonDateTime(dateStr, '10:00').utc, durationMin: 60 }];
  const times = buildSlotsForWindow(dateStr, { startTime: '09:00', endTime: '17:00' }, booked, 30, now).map((s) => s.time);
  assert.ok(!times.includes('10:00'), '10:00 is booked and must not be offered');
  assert.ok(!times.includes('10:30'), '10:30 overlaps the booking and must not be offered');
  assert.ok(times.includes('09:00'), '09:00 is free and must be offered');
  assert.ok(times.includes('11:00'), '11:00 is free and must be offered');
});

test('buildSlotsForWindow — hides slots at or before now', () => {
  const dateStr = '2026-07-01';
  const now = resolveSalonDateTime(dateStr, '11:00').utc; // it is currently 11:00 salon-local
  const times = buildSlotsForWindow(dateStr, { startTime: '09:00', endTime: '13:00' }, [], 30, now).map((s) => s.time);
  assert.ok(!times.includes('09:00'), 'past slot hidden');
  assert.ok(!times.includes('11:00'), 'slot equal to now is hidden');
  assert.ok(times.includes('11:30'), 'future slot offered');
});

test('buildSlotsForWindow — does not offer a slot whose service runs past closing', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const times = buildSlotsForWindow('2026-07-01', { startTime: '09:00', endTime: '10:00' }, [], 45, now).map((s) => s.time);
  assert.ok(times.includes('09:00'), '09:00 + 45min = 09:45 <= 10:00, offered');
  assert.ok(!times.includes('09:30'), '09:30 + 45min = 10:15 > 10:00, not offered');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test 2>&1 | grep -E "buildSlotsForWindow|not a function|is not exported" | head`
Expected: FAIL — `buildSlotsForWindow` is not exported yet.

- [ ] **Step 4: Implement `buildSlotsForWindow` and `TimeSlot` in `scheduling.ts`**

At the top of `src/app/services/scheduling.ts`, add the import (keep the existing `import { addMinutes } from 'date-fns';`):

```ts
import { resolveSalonDateTime } from './salon-time';
```

Then append to the file:

```ts
export type TimeSlot = { time: string; available: boolean };

/**
 * Build bookable slot start-times for one availability window on a salon-local
 * calendar date (YYYY-MM-DD). Each slot's absolute instant is derived with
 * resolveSalonDateTime so it matches how appointments are STORED (BST/GMT correct
 * and host-timezone independent — never construct slot instants with host-local
 * date-fns startOfDay/setHours). `now` is injected: slots at or before it are hidden.
 */
export function buildSlotsForWindow(
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
    if (!hasConflict(slotStart, serviceDuration, booked)) {
      slots.push({ time: label, available: true });
    }
  }
  return slots;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test 2>&1 | tail -8`
Expected: PASS, count increased by 3 (e.g. `# pass 119`).

- [ ] **Step 6: Rewrite `booking-service.ts` to use the pure builder and salon-timezone day windows**

In `src/app/services/booking-service.ts`:

(a) Replace the date-fns import line (line 3) — remove `addMinutes, format, setHours, setMinutes, startOfDay` (all become unused) and the `toZonedTime` import (line 4). Delete both import lines.

(b) Update the scheduling import (line 10) and the salon-time import (line 9):

```ts
import { salonDayWindow, toSalonDateStr } from './salon-time';
import { firstFreeStylist, hasConflict, buildSlotsForWindow, type BookedInterval, type TimeSlot } from './scheduling';
```

(c) Delete the `const SALON_TIMEZONE = 'Europe/London';` line (line 14 — now unused).

(d) Replace the exported `TimeSlot` type block (lines 46-49) with a re-export so existing importers still resolve it:

```ts
export type { TimeSlot } from './scheduling';
```

(e) Replace the entire `buildStylistSlots` function body (lines 59-98) with this thin adapter:

```ts
function buildStylistSlots(
  availability: { startTime: string; endTime: string },
  existingAppointments: SlotAppointment[],
  date: Date,
  serviceDuration: number,
  now: Date = new Date(),
): TimeSlot[] {
  const booked: BookedInterval[] = existingAppointments.map((appt) => ({
    start: new Date(appt.date),
    durationMin: appt.service.duration,
  }));
  return buildSlotsForWindow(toSalonDateStr(date), availability, booked, serviceDuration, now);
}
```

(f) In `getAvailableSlots`, replace the host-local day bounds (lines 116-118) so the appointment query uses the salon-local day window:

```ts
  const { start: dayStart, end: dayEnd } = salonDayWindow(date);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      stylistId,
      date: { gte: dayStart, lte: dayEnd },
      status: { not: 'CANCELLED' },
    },
    include: { service: { select: { duration: true } } },
  });
```

(g) In `getAvailableSlotsUnion`, replace the host-local day bounds (lines 158-160) the same way:

```ts
  const { start: dayStart, end: dayEnd } = salonDayWindow(date);

  const appointments = await prisma.appointment.findMany({
    where: {
      stylistId: { in: stylistIds },
      date: { gte: dayStart, lte: dayEnd },
      status: { not: 'CANCELLED' },
    },
    include: { service: { select: { duration: true } } },
  });
```

- [ ] **Step 7: Verify the whole toolchain is green**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -5`
Expected: no tsc/lint output; tests pass. If tsc reports an unused import, delete it.

- [ ] **Step 8: Commit**

```bash
git add src/app/services/salon-time.ts src/app/services/scheduling.ts src/app/services/scheduling.test.ts src/app/services/booking-service.ts
git commit -m "fix(booking): build availability slots in salon timezone (CRITICAL: BST grid was one hour off)"
```

---

## Phase 2 — Security WARNINGs

### Task 2.1: Close the backslash open-redirect and make the guard testable (fixes #22, #32)

**Problem:** `sanitizeRedirect` in `auth.ts` blocks `//evil.com` but not `/\evil.com`; the WHATWG URL parser normalizes the backslash so `redirect(/\evil.com)` navigates off-origin — a post-login open redirect. The guard also has no tests because it lives in a `'use server'` file and cannot be exported.

**Files:**
- Create: `src/app/lib/redirect.ts`
- Create: `src/app/lib/redirect.test.ts`
- Modify: `src/app/actions/auth.ts` (import the shared guard, delete the local copy)

**Interfaces:**
- Produces: `export function sanitizeRedirect(url: string | null): string`

- [ ] **Step 1: Write the failing test**

Create `src/app/lib/redirect.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRedirect } from './redirect';

test('sanitizeRedirect — allows same-origin relative paths', () => {
  assert.equal(sanitizeRedirect('/book'), '/book');
  assert.equal(sanitizeRedirect('/appointments?tab=upcoming#top'), '/appointments?tab=upcoming#top');
});

test('sanitizeRedirect — falls back to / for empty/absolute/protocol-relative', () => {
  assert.equal(sanitizeRedirect(null), '/');
  assert.equal(sanitizeRedirect(''), '/');
  assert.equal(sanitizeRedirect('https://evil.com'), '/');
  assert.equal(sanitizeRedirect('//evil.com'), '/');
});

test('sanitizeRedirect — blocks backslash and control-character redirect tricks', () => {
  assert.equal(sanitizeRedirect('/\\evil.com'), '/'); // normalises to //evil.com in the URL parser
  assert.equal(sanitizeRedirect('/\tevil'), '/');
  assert.equal(sanitizeRedirect('/\nevil'), '/');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test 2>&1 | grep -E "sanitizeRedirect|Cannot find module" | head`
Expected: FAIL — `./redirect` does not exist.

- [ ] **Step 3: Implement the hardened guard**

Create `src/app/lib/redirect.ts`:

```ts
/**
 * Only allow same-origin relative paths as post-auth redirect targets. Rejects
 * absolute URLs, protocol-relative `//host`, backslash tricks (`/\host` and
 * `/\\host` normalise to `//host` in the WHATWG URL parser and in browsers),
 * and any control characters that could smuggle a second target.
 */
export function sanitizeRedirect(url: string | null): string {
  if (!url) return '/';
  if (!url.startsWith('/')) return '/';
  if (url.startsWith('//')) return '/';
  if (url.startsWith('/\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[ -\\]/.test(url)) return '/';
  return url;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Use the shared guard in `auth.ts`**

In `src/app/actions/auth.ts`, delete the local `sanitizeRedirect` function (lines 12-16) and add near the other imports (after line 10):

```ts
import { sanitizeRedirect } from '@/app/lib/redirect';
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -3`
Expected: green.

```bash
git add src/app/lib/redirect.ts src/app/lib/redirect.test.ts src/app/actions/auth.ts
git commit -m "fix(security): block backslash open-redirect in post-login redirect; add tests"
```

### Task 2.2: Enforce end-of-service against business hours (fixes #14)

**Problem:** `checkStylistHours` (in `booking.ts`) validates only the appointment START minute; the "service must finish before closing" rule lives only in the UI slot generator. A crafted `submitBooking` (or reschedule, or the "Anyone" path) can book a long service that runs hours past closing.

**Files:**
- Modify: `src/app/services/salon-time.ts` (add `fitsWithinAvailability`)
- Modify: `src/app/services/salon-time.test.ts` (add cases)
- Modify: `src/app/actions/booking.ts` (use it in `checkStylistHours` + `eligibleStylistIds`; fetch service duration)

**Interfaces:**
- Produces: `export function fitsWithinAvailability(timeMinutes: number, durationMinutes: number, startTime: string, endTime: string): boolean`

- [ ] **Step 1: Write the failing test**

Append to `src/app/services/salon-time.test.ts`:

```ts
import { fitsWithinAvailability } from './salon-time';

test('fitsWithinAvailability — start in-hours but service overruns closing is rejected', () => {
  // 09:00-18:00 window. 17:30 start + 240min = 21:30 → past close.
  assert.equal(fitsWithinAvailability(17 * 60 + 30, 240, '09:00', '18:00'), false);
});

test('fitsWithinAvailability — service finishing exactly at close is allowed', () => {
  assert.equal(fitsWithinAvailability(17 * 60, 60, '09:00', '18:00'), true); // 17:00 + 60 = 18:00
});

test('fitsWithinAvailability — start before opening is rejected', () => {
  assert.equal(fitsWithinAvailability(8 * 60, 30, '09:00', '18:00'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test 2>&1 | grep -E "fitsWithinAvailability|not exported|not a function" | head`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement it**

Append to `src/app/services/salon-time.ts` (keep `isWithinAvailability` as-is — other callers use it):

```ts
/**
 * True when a service of `durationMinutes` starting at `timeMinutes` (minutes
 * since midnight) both starts within and FINISHES within [startTime, endTime].
 * Start inclusive, finish must be <= endTime. Use for the booking business-hours
 * guard so a long service cannot run past closing.
 */
export function fitsWithinAvailability(
  timeMinutes: number,
  durationMinutes: number,
  startTime: string,
  endTime: string,
): boolean {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return timeMinutes >= start && timeMinutes + durationMinutes <= end;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test 2>&1 | tail -4`
Expected: PASS.

- [ ] **Step 5: Wire it into the booking action**

In `src/app/actions/booking.ts`:

(a) Update the salon-time import (line 4) to add `fitsWithinAvailability`:

```ts
import { resolveSalonDateTime, isWithinAvailability, fitsWithinAvailability, isValidSalonTime, isValidSalonDate, salonDayWindow, SALON_TIME_RE, type SalonDateTime } from '@/app/services/salon-time';
```

(b) Change `checkStylistHours` (lines 65-79) to take a duration and check the end:

```ts
async function checkStylistHours(
  stylistId: string,
  salon: SalonDateTime,
  durationMinutes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const availability = await prisma.availability.findFirst({
    where: { stylistId, dayOfWeek: salon.dayOfWeek, isOff: false },
  });
  if (!availability) {
    return { ok: false, error: 'Stylist is not available on this day' };
  }
  if (!fitsWithinAvailability(salon.timeMinutes, durationMinutes, availability.startTime, availability.endTime)) {
    return { ok: false, error: 'Selected time is outside business hours' };
  }
  return { ok: true };
}
```

(c) Change `eligibleStylistIds` (lines 131-142) to also require the service fits. It needs the duration — add a parameter:

```ts
async function eligibleStylistIds(salon: SalonDateTime, durationMinutes: number): Promise<string[]> {
  const stylists = await prisma.stylist.findMany({
    where: { availabilities: { some: { dayOfWeek: salon.dayOfWeek, isOff: false } } },
    orderBy: { name: 'asc' },
    include: { availabilities: { where: { dayOfWeek: salon.dayOfWeek, isOff: false } } },
  });
  return stylists
    .filter((s) =>
      s.availabilities.some((a) => fitsWithinAvailability(salon.timeMinutes, durationMinutes, a.startTime, a.endTime)),
    )
    .map((s) => s.id);
}
```

(d) In `submitBooking`, the service lookup (lines 226-229) must also select `duration`, and it must run BEFORE the stylist-hours resolution so the duration is available. Move the service fetch up to just after the past-date check (after line 206) and add `duration`:

```ts
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { duration: true, requiresPatchTest: true, requiresConsultation: true, isConsultation: true, isPatchTest: true },
  });
  if (!service) {
    return { success: false, error: 'Service not found' };
  }
```

Then delete the later duplicate service fetch (the original lines 226-229 block), keeping the `service?.requiresConsultation` etc. checks that follow (they already reference `service`).

(e) Update the two `checkStylistHours` / `eligibleStylistIds` call sites in `submitBooking` (lines 213 and 218) to pass `service.duration`:

```ts
  if (isAnyStylist) {
    candidateStylistIds = await eligibleStylistIds(salon, service.duration);
    if (candidateStylistIds.length === 0) {
      return { success: false, error: 'No stylist is available at this time' };
    }
  } else {
    const hoursCheck = await checkStylistHours(validData.stylistId, salon, service.duration);
    if (!hoursCheck.ok) {
      return { success: false, error: hoursCheck.error };
    }
  }
```

(f) In `rescheduleAppointment`, update the `checkStylistHours` call (line 418) to pass the duration (already available as `appointment.service.duration`):

```ts
  const hoursCheck = await checkStylistHours(appointment.stylistId, salon, appointment.service.duration);
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -3`
Expected: green. Manual check to note in the commit/PR: a `submitBooking` with a 240-min service at 17:30 against an 18:00 close now returns "Selected time is outside business hours".

```bash
git add src/app/services/salon-time.ts src/app/services/salon-time.test.ts src/app/actions/booking.ts
git commit -m "fix(booking): reject services that run past closing (start+duration must fit business hours)"
```

### Task 2.3: Rate-limit + cap booking creation (fixes #10)

**Problem:** `submitBooking` — the core business mutation — has no rate limit and no cap on active bookings per user, so one registered account can script-book every open slot and blockade the calendar.

**Files:**
- Modify: `src/app/actions/booking.ts`

**Not unit-tested** (prisma+session action; consistent with the rest of `booking.ts`). Verify by inspection + the described manual check.

- [ ] **Step 1: Add a booking limiter next to the existing discount limiter**

In `src/app/actions/booking.ts`, after `getDiscountLimiter` (line 32), add:

```ts
// Limits booking creation per authenticated user to curb calendar-blockade abuse.
let bookingLimiter: Ratelimit | null | undefined;
function getBookingLimiter(): Ratelimit | null {
  if (bookingLimiter !== undefined) return bookingLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  bookingLimiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(6, '1 h'),
        prefix: 'rl:booking',
      })
    : null;
  return bookingLimiter;
}

const MAX_ACTIVE_BOOKINGS = 6;
```

- [ ] **Step 2: Enforce the limiter and cap at the top of `submitBooking`**

In `submitBooking`, immediately after the session + validation (after `const validData = result.data;`, line 191), add:

```ts
  // Per-user rate limit (fail open on Redis outage, matching the rest of the app).
  const limiter = getBookingLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(`user:${session.userId}`);
      if (!success) {
        return { success: false, error: 'Too many booking attempts. Please try again shortly.' };
      }
    } catch (err) {
      console.error('Booking rate limiter unavailable, allowing request:', err);
    }
  }

  // Hard cap on outstanding future bookings per user.
  const activeCount = await prisma.appointment.count({
    where: { userId: session.userId, status: 'CONFIRMED', date: { gt: new Date() } },
  });
  if (activeCount >= MAX_ACTIVE_BOOKINGS) {
    return { success: false, error: 'You already have the maximum number of upcoming bookings. Please manage your existing appointments first.' };
  }
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -3`
Expected: green.

```bash
git add src/app/actions/booking.ts
git commit -m "fix(security): rate-limit submitBooking per user + cap outstanding future bookings"
```

### Task 2.4: Rate-limit unsubscribe and stop creating arbitrary contacts (fixes #11)

**Problem:** `unsubscribeFromMarketing` is unauthenticated with no rate limit, and on "not found" it falls through to `resend.contacts.create`, letting anyone flood the Resend audience with junk contacts (and silently unsubscribe real customers).

**Files:**
- Modify: `src/app/actions/unsubscribe.ts`

**Not unit-tested** (Resend+headers action). Verify by inspection.

- [ ] **Step 1: Add an IP rate limiter and remove the contact-creation fallback**

Replace the entire contents of `src/app/actions/unsubscribe.ts` with:

```ts
'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { Resend } from 'resend';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const unsubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
});

export type UnsubscribeState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

function getClientIp(headersList: Headers): string {
  const forwarded = headersList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

let unsubLimiter: Ratelimit | null | undefined;
function getUnsubLimiter(): Ratelimit | null {
  if (unsubLimiter !== undefined) return unsubLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  unsubLimiter = url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(3, '1 h'),
        prefix: 'rl:unsub',
      })
    : null;
  return unsubLimiter;
}

export async function unsubscribeFromMarketing(
  _prev: UnsubscribeState,
  formData: FormData
): Promise<UnsubscribeState> {
  const ip = getClientIp(await headers());
  const limiter = getUnsubLimiter();
  if (limiter) {
    try {
      const { success } = await limiter.limit(ip);
      if (!success) {
        return { status: 'error', message: 'Too many requests. Please try again in an hour.' };
      }
    } catch (err) {
      console.error('Unsubscribe rate limiter unavailable, allowing request:', err);
    }
  }

  const parsed = unsubscribeSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid email address.' };
  }

  const resend = getResendClient();
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!resend || !audienceId) {
    console.error('Marketing unsubscribe is not configured: missing RESEND_API_KEY or RESEND_AUDIENCE_ID');
    return { status: 'error', message: 'Unsubscribe is temporarily unavailable. Please contact the salon.' };
  }

  try {
    const update = await resend.contacts.update({
      email: parsed.data.email,
      audienceId,
      unsubscribed: true,
    });
    if (update.error) {
      const message = update.error.message ?? String(update.error);
      // A contact that was never subscribed is already "not receiving marketing" —
      // report success without creating a new contact (which would let anyone flood
      // the audience with arbitrary emails).
      if (/not.?found|does not exist|could not find/i.test(message)) {
        return { status: 'success', message: 'You have been unsubscribed from marketing emails.' };
      }
      throw new Error(message);
    }
  } catch (error) {
    console.error('Marketing unsubscribe failed:', error);
    return { status: 'error', message: 'Unsubscribe failed. Please try again later.' };
  }

  return { status: 'success', message: 'You have been unsubscribed from marketing emails.' };
}
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -3`
Expected: green.

```bash
git add src/app/actions/unsubscribe.ts
git commit -m "fix(security): rate-limit unsubscribe and stop creating arbitrary Resend contacts"
```

### Task 2.5: Invalidate sessions on password change (fixes #23, #31)

**Problem:** JWT sessions live 30 days with no token-version claim; `resetUserPassword` changes only the hash, so a stolen/old token keeps authenticating as ADMIN after a password reset. Additionally the JWT core (`encrypt`/`decrypt`/`refreshSession`) has zero tests because `session.ts` imports `prisma` (which throws at import without a DB URL).

**Fix strategy:** extract the prisma-free JWT crypto into `lib/jwt.ts` (unit-testable), add a `sessionVersion` column, embed it in the token, verify it in `verifySession`, and bump it on password reset.

**Files:**
- Create: `src/app/lib/jwt.ts`
- Create: `src/app/lib/jwt.test.ts`
- Modify: `src/app/lib/session.ts`
- Modify: `src/app/actions/auth.ts` (pass sessionVersion into createSession)
- Modify: `src/app/actions/admin.ts` (bump sessionVersion on reset)
- Modify: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`
- Migration files (see Step 6)

**Interfaces:**
- Produces (jwt.ts): `type SessionPayload = { userId: string; role: string; sessionVersion: number; expiresAt: Date }`; `encrypt(payload: SessionPayload): Promise<string>`; `decrypt(session?: string): Promise<SessionPayload | null>`

- [ ] **Step 1: Write failing tests for the JWT core**

Create `src/app/lib/jwt.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-session-secret-value-32-chars-min';

const { encrypt, decrypt } = await import('./jwt');

test('encrypt/decrypt round-trips a session payload', async () => {
  const token = await encrypt({ userId: 'u1', role: 'ADMIN', sessionVersion: 3, expiresAt: new Date(Date.now() + 1000) });
  const payload = await decrypt(token);
  assert.equal(payload?.userId, 'u1');
  assert.equal(payload?.role, 'ADMIN');
  assert.equal(payload?.sessionVersion, 3);
});

test('decrypt returns null for a tampered token', async () => {
  const token = await encrypt({ userId: 'u1', role: 'USER', sessionVersion: 0, expiresAt: new Date(Date.now() + 1000) });
  const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
  assert.equal(await decrypt(tampered), null);
});

test('decrypt returns null for undefined/empty input', async () => {
  assert.equal(await decrypt(undefined), null);
  assert.equal(await decrypt(''), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test 2>&1 | grep -E "jwt|Cannot find module './jwt'" | head`
Expected: FAIL — `./jwt` does not exist.

- [ ] **Step 3: Implement `lib/jwt.ts` (no prisma import)**

Create `src/app/lib/jwt.ts`:

```ts
import 'server-only';
import { SignJWT, jwtVerify } from 'jose';

function getKey() {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secretKey);
}

export type SessionPayload = {
  userId: string;
  role: string;
  sessionVersion: number;
  expiresAt: Date;
};

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getKey());
}

export async function decrypt(session: string | undefined = ''): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, getKey(), { algorithms: ['HS256'] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
```

Note: `import 'server-only'` is a no-op under `tsx`/`node:test`, so the test can still import this module.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test 2>&1 | tail -4`
Expected: PASS.

- [ ] **Step 5: Rewire `session.ts` to use `jwt.ts` and enforce `sessionVersion`**

In `src/app/lib/session.ts`:

(a) Replace the top imports (lines 1-5) — remove the local `SignJWT/jwtVerify` and `getKey`, import the crypto from `jwt.ts`, keep prisma/cookies/redirect:

```ts
import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { encrypt, decrypt, type SessionPayload } from '@/app/lib/jwt';
```

(Keep `SignJWT/jwtVerify` import only for the kiosk token below; `getKey` is still needed for the kiosk token — see (f).)

(b) Delete the local `getKey`, `SessionPayload`, `encrypt`, and `decrypt` definitions (they now live in `jwt.ts`). Re-add a private `getKey` for the kiosk token only (see (f)).

(c) Change `createSession` to take and embed `sessionVersion`:

```ts
export async function createSession(userId: string, role: string, sessionVersion: number) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const session = await encrypt({ userId, role, sessionVersion, expiresAt });

  (await cookies()).set('session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
}
```

(d) Change `refreshSession` to pass the version through:

```ts
export async function refreshSession() {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);
  if (!session?.userId) return;

  const timeLeft = new Date(session.expiresAt).getTime() - Date.now();
  if (timeLeft < 7 * 24 * 60 * 60 * 1000) {
    await createSession(session.userId, session.role, session.sessionVersion ?? 0);
  }
}
```

(e) Change `verifySession` to also read and compare `sessionVersion`:

```ts
export async function verifySession() {
  const cookie = (await cookies()).get('session')?.value;
  const session = await decrypt(cookie);

  if (!session?.userId) {
    redirect('/auth/signin');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true, sessionVersion: true },
  });

  if (!user) {
    redirect('/auth/signin');
  }

  // Tokens issued before this field existed have no claim → treat as 0, which
  // matches a freshly-migrated user (default 0). A password reset bumps the
  // stored version, invalidating every previously-issued token.
  const tokenVersion = session.sessionVersion ?? 0;
  if (user.sessionVersion !== tokenVersion) {
    redirect('/auth/signin');
  }

  return { userId: session.userId, role: user.role };
}
```

(f) The kiosk token still needs `getKey`. Add a private `getKey` back for it (the kiosk functions use `SignJWT`/`jwtVerify` directly):

```ts
function getKey() {
  const secretKey = process.env.SESSION_SECRET;
  if (!secretKey) throw new Error('SESSION_SECRET environment variable is required');
  return new TextEncoder().encode(secretKey);
}
```

Leave `createKioskSession`/`getKioskSession`/`deleteKioskSession`/`getSession`/`deleteSession` otherwise unchanged. `getSession` returns `decrypt(cookie)` — fine.

- [ ] **Step 6: Add `sessionVersion` to all three schemas + migrations**

In each schema's `User` model add the column:

`prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma` — add after the `role` line:

```prisma
  sessionVersion Int      @default(0)
```

Regenerate the runtime client types (no DB needed):

Run: `pnpm db:vercel:generate`

Create the migrations. Preferred (needs DB creds — pull them first with `vercel env pull .env.vercel` per the team convention, then):

```bash
pnpm db:dev:migrate --name add_session_version      # local SQLite
pnpm db:vercel:migrate --name add_session_version   # Neon (creates prisma/vercel/migrations/*)
```

If DB access is unavailable, hand-author the Postgres migration so it deploys via `migrate deploy` on prod. Create `prisma/vercel/migrations/<YYYYMMDDHHMMSS>_add_session_version/migration.sql`:

```sql
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
```

(Use a timestamp lexicographically AFTER the latest existing migration folder so ordering is correct.)

- [ ] **Step 7: Pass `sessionVersion` into `createSession` from `auth.ts`**

In `src/app/actions/auth.ts`, the three `createSession(...)` calls must pass the user's version:

- `login` (line 134): the `user` from `findUnique` already has `sessionVersion` (full-row fetch): `await createSession(user.id, user.role, user.sessionVersion);`
- `register` guest branch (line 179): `await createSession(existingUser.id, existingUser.role, existingUser.sessionVersion);`
- `register` new-user branch (line 196): `await createSession(user.id, user.role, user.sessionVersion);`

- [ ] **Step 8: Bump the version on password reset**

In `src/app/actions/admin.ts`, `resetUserPassword` (line 268), change the update to also invalidate sessions:

```ts
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword, sessionVersion: { increment: 1 } },
  });
```

- [ ] **Step 9: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -4`
Expected: green (test count +3). If tsc complains that `sessionVersion` is missing on the Prisma type, re-run `pnpm db:vercel:generate`.

```bash
git add src/app/lib/jwt.ts src/app/lib/jwt.test.ts src/app/lib/session.ts src/app/actions/auth.ts src/app/actions/admin.ts prisma/
git commit -m "feat(security): invalidate sessions on password change via sessionVersion; extract + test JWT core"
```

---

## Phase 3 — Reliability WARNINGs

### Task 3.1: Send review requests for COMPLETED appointments too (fixes #2)

**Problem:** The review-request query matches only `status: 'CONFIRMED'`, but admins mark finished appointments `COMPLETED` (required for payroll commission), so exactly the well-managed appointments never get a review request.

**Files:** Modify `src/app/api/cron/reminders/route.ts`

- [ ] **Step 1: Broaden the status filter**

In `src/app/api/cron/reminders/route.ts`, the `pastAppointments` query (line 78) — change:

```ts
      status: { in: ['CONFIRMED', 'COMPLETED'] },
```

(The composite index `@@index([status, reviewRequestSent, date])` still serves an `IN` of two statuses.)

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add src/app/api/cron/reminders/route.ts
git commit -m "fix(cron): send review requests for COMPLETED appointments, not just CONFIRMED"
```

### Task 3.2: Give reminders a second chance across runs (fixes #12)

**Problem:** The reminder window is `date > now AND date <= now+24h` and the cron runs once daily, so any send that fails (e.g. a Resend 429) leaves the appointment past the window by the next run — a permanent miss with no retry.

**Fix:** widen the selection window to `now+36h` so a failed send is re-picked on the next daily run while still in the window, and retry each send once immediately for transient blips. No sleeps (serverless-safe).

**Files:** Modify `src/app/api/cron/reminders/route.ts`

- [ ] **Step 1: Widen the reminder window**

In `src/app/api/cron/reminders/route.ts`, change the window (line 27):

```ts
  // 36h (not 24h) so a send that fails today is retried on tomorrow's run while
  // still within the window (the cron only runs once per day).
  const thirtySixHoursFromNow = new Date(now.getTime() + 36 * 60 * 60 * 1000);
```

And update the reminder query's upper bound (line 35):

```ts
        lte: thirtySixHoursFromNow,
```

- [ ] **Step 2: Add an immediate single retry around each reminder send**

Replace the reminder send call (line 52) so a transient failure is retried once before giving up:

```ts
      try {
        await sendAppointmentReminder({
          id: appointment.id,
          date: appointment.date,
          user: appointment.user,
          stylist: appointment.stylist,
          service: { ...appointment.service, price: Number(appointment.service.price) },
        });
      } catch (firstErr) {
        console.error(`Reminder send failed once for ${appointment.id}, retrying:`, firstErr);
        await sendAppointmentReminder({
          id: appointment.id,
          date: appointment.date,
          user: appointment.user,
          stylist: appointment.stylist,
          service: { ...appointment.service, price: Number(appointment.service.price) },
        });
      }
```

(The surrounding `try/catch` that records `failedIds` and the immediate `reminderSent: true` mark stay as-is.)

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add src/app/api/cron/reminders/route.ts
git commit -m "fix(cron): widen reminder window to 36h and retry sends once so failures aren't permanently lost"
```

### Task 3.3: Bound Resend sends with a timeout (fixes #40)

**Problem:** `email-service.ts` `send()` has no timeout; if Resend hangs, the 60s reminders cron is killed mid-loop and the rest of that day's reminders are permanently lost.

**Files:** Modify `src/app/services/email-service.ts`

- [ ] **Step 1: Wrap the send in a 10s timeout race**

In `src/app/services/email-service.ts`, replace the `send` function (lines 40-46):

```ts
const SEND_TIMEOUT_MS = 10_000;

async function send({ to, subject, react }: SendArgs): Promise<void> {
  const resend = getResendClient();
  const result = await Promise.race([
    resend.emails.send({ from: getFromAddress(), to, subject, react }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Resend timed out after ${SEND_TIMEOUT_MS}ms for "${subject}" to ${to}`)), SEND_TIMEOUT_MS),
    ),
  ]);
  const { error } = result;
  if (error) {
    throw new Error(`Resend failed for "${subject}" to ${to}: ${error.message ?? String(error)}`);
  }
}
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -3`
Expected: green.

```bash
git add src/app/services/email-service.ts
git commit -m "fix(email): add 10s timeout to Resend sends so a hung API can't kill the reminders cron"
```

### Task 3.4: Fail open on the newsletter limiter (fixes #13)

**Problem:** `subscribeToNewsletter`'s limiter call is the only one with no try/catch; if Upstash rejects (revoked token/outage), the form throws a raw error instead of returning its typed state.

**Files:** Modify `src/app/actions/newsletter.ts`

- [ ] **Step 1: Wrap the limiter call**

In `src/app/actions/newsletter.ts`, replace `checkRate` (lines 36-41):

```ts
async function checkRate(ip: string): Promise<boolean> {
  const newsletterLimiter = getNewsletterLimiter();
  if (!newsletterLimiter) return true;
  try {
    const { success } = await newsletterLimiter.limit(ip);
    return success;
  } catch (err) {
    console.error('Newsletter rate limiter unavailable, allowing request:', err);
    return true;
  }
}
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add src/app/actions/newsletter.ts
git commit -m "fix(newsletter): fail open when the rate limiter errors instead of throwing a raw exception"
```

### Task 3.5: Never leave the kiosk clock button stuck (fixes #16)

**Problem:** `KioskClock.submit()` sets `busy=true`, awaits `clockToggle`, then `setBusy(false)`. A rejected promise (WiFi blip, P2034) skips `setBusy(false)`, so the Confirm button stays disabled for everyone until a manual refresh.

**Files:** Modify `src/components/kiosk/KioskClock.tsx`

- [ ] **Step 1: Wrap the action call in try/catch/finally**

In `src/components/kiosk/KioskClock.tsx`, replace `submit` (lines 21-35):

```tsx
  async function submit() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await clockToggle(selected.id, pin);
      if (res.ok) {
        setMessage(`${res.name}: clocked ${res.status === 'IN' ? 'in' : 'out'} ✓`);
        reset();
        router.refresh();
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage(res.error ?? 'Error');
        setPin('');
      }
    } catch {
      setMessage('Connection problem — please try again.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add src/components/kiosk/KioskClock.tsx
git commit -m "fix(kiosk): reset busy state in finally so a failed clock toggle can't lock the button"
```

### Task 3.6: Revalidate all category pages on service changes (fixes #49)

**Problem:** `createService`/`deleteService` never revalidate `/services/[slug]`, and `updateService` revalidates `/services/${existing.category.toLowerCase()}` — which never matches the real route (the slug is the independently-set `ServiceCategoryContent.slug`, and multi-word categories have a space, not a hyphen). Public category pages serve stale pricing for up to an hour (`revalidate = 3600`).

**Files:** Modify `src/app/actions/admin-services.ts`

- [ ] **Step 1: Add a helper that revalidates every real category slug**

In `src/app/actions/admin-services.ts`, add the import (after line 7) and a helper (after `requireAdmin`, line 14):

```ts
import { getAllCategoryContent } from '@/app/services/category-content-service';
```

```ts
// Category detail pages live at /services/[slug] where slug is the (admin-set)
// ServiceCategoryContent.slug — NOT category.toLowerCase(). Revalidate every real
// slug so create/update/delete/category-move all propagate immediately.
async function revalidateCategoryPages() {
  const cats = await getAllCategoryContent();
  for (const c of cats) revalidatePath(`/services/${c.slug}`);
}
```

- [ ] **Step 2: Call it from create/update/delete**

In `createService`, after `revalidatePath('/sitemap.xml');` (line 50) and before the `redirect(...)`, add:

```ts
  await revalidateCategoryPages();
```

In `updateService`, replace the buggy line `revalidatePath(\`/services/${existing.category.toLowerCase()}\`);` (line 80) with:

```ts
  await revalidateCategoryPages();
```

In `deleteService`, after `revalidatePath('/sitemap.xml');` (line 107), add:

```ts
  await revalidateCategoryPages();
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add src/app/actions/admin-services.ts
git commit -m "fix(admin): revalidate real category-content slugs on service create/update/delete"
```

### Task 3.7: Add error boundaries so TOCTOU/DB errors don't blank the page (fixes #20, supports #43)

**Problem:** There is no `error.tsx`/`global-error.tsx` anywhere in `src/app`, so an uncaught error (e.g. the register `P2002` race, or a review-create race) renders Next's bare production error page.

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/global-error.tsx`

- [ ] **Step 1: Add a route-segment error boundary**

Create `src/app/error.tsx`:

```tsx
'use client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-zinc-900 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-serif font-bold mb-3">Something went wrong</h1>
        <p className="text-zinc-600 mb-6">
          Sorry — an unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="bg-black text-white px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-800 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a global error boundary (renders its own html/body)**

Create `src/app/global-error.tsx`:

```tsx
'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-serif font-bold mb-3">Something went wrong</h1>
            <p className="text-zinc-600 mb-6">Please try again.</p>
            <button
              onClick={reset}
              className="bg-black text-white px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-800 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint`
Expected: green.

```bash
git add src/app/error.tsx src/app/global-error.tsx
git commit -m "feat(ux): add error and global-error boundaries so uncaught errors show a friendly page"
```

---

## Phase 4 — Money-correctness WARNINGs

### Task 4.1: Fix HYBRID `hourlyRate: 0` voiding salary and the overtime null-threshold overpay (fixes #29, #28)

**Problem A (#29):** In `computeGross`, HYBRID uses `input.hourlyRate != null` to pick the hourly branch, so a stored `hourlyRate` of `0` selects hourly and pays `hours × 0`, silently discarding `monthlySalary`. `employees.ts` lets `0` through (`formData.get('hourlyRate') || null` keeps the string `"0"` which coerces to `0`).

**Problem B (#28):** When `overtimeEnabled` is true but `overtimeThresholdHours` is null, `runPayroll` passes `thresholdHours: 0`, so `splitRegularOvertime` classifies EVERY worked hour as overtime (a ~50% overpay).

**Files:**
- Modify: `src/app/services/payroll-calc.ts`
- Modify: `src/app/services/payroll-calc.test.ts`
- Modify: `src/app/services/payroll-service.ts`
- Modify: `src/app/actions/employees.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/services/payroll-calc.test.ts`:

```ts
test('computeGross — HYBRID with hourlyRate 0 pays salary, not zero', () => {
  const r = computeGross({
    payType: 'HYBRID', hourlyRate: 0, monthlySalary: 1500, commissionRate: 0,
    regularHours: 100, overtimeHours: 0, overtimeMultiplier: 1.5, commissionableRevenue: 0, adjustments: 0,
  });
  assert.equal(r.basePay, 1500); // 0 hourly rate means "no hourly component" → salary base
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test 2>&1 | grep -E "HYBRID with hourlyRate 0" -A3 | head`
Expected: FAIL (`basePay` is 0, not 1500).

- [ ] **Step 3: Treat a zero/absent hourly rate as "no hourly component" in HYBRID**

In `src/app/services/payroll-calc.ts`, change the HYBRID branch (lines 50-54):

```ts
    case 'HYBRID': {
      // Hourly base only if a POSITIVE hourly rate is set; otherwise salary base.
      // (A stored 0 means "no hourly component" and must not zero out the salary.)
      const hasHourly = input.hourlyRate != null && input.hourlyRate > 0;
      basePay = hasHourly ? hourlyBase : salary;
      overtimePay = hasHourly ? overtimePayHourly : 0;
      break;
    }
```

- [ ] **Step 4: Normalize 0 → null at the employee form boundary**

In `src/app/actions/employees.ts`, `parseEmployeeForm` (line 36), make an explicit-zero hourly rate normalize to null so it's stored as "no hourly component":

```ts
    hourlyRate: (formData.get('hourlyRate') && Number(formData.get('hourlyRate')) > 0) ? formData.get('hourlyRate') : null,
```

- [ ] **Step 5: Treat a null overtime threshold as overtime-disabled**

In `src/app/services/payroll-service.ts`, change the `splitRegularOvertime` call (lines 68-71):

```ts
    const otThreshold = num(e.overtimeThresholdHours);
    const { regularHours, overtimeHours } = splitRegularOvertime(totalHours, {
      // Overtime only applies when a positive threshold is configured; a null/0
      // threshold must NOT reclassify every hour as overtime.
      enabled: e.overtimeEnabled && otThreshold != null && otThreshold > 0,
      thresholdHours: otThreshold ?? 0,
    });
```

- [ ] **Step 6: Run tests and verify green**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -4`
Expected: PASS (count +1).

- [ ] **Step 7: Commit**

```bash
git add src/app/services/payroll-calc.ts src/app/services/payroll-calc.test.ts src/app/services/payroll-service.ts src/app/actions/employees.ts
git commit -m "fix(payroll): HYBRID hourlyRate 0 keeps salary; null overtime threshold no longer pays all-overtime"
```

### Task 4.2: Snapshot the charged price so commission ignores later price edits (fixes #1)

**Problem:** Commission revenue reads the *current* `Service.price` at payroll time, so raising a price before re-running a still-DRAFT month reprices every past appointment. Snapshot the price onto `Appointment` at booking time and compute commission from the snapshot.

**Scope note:** This task fixes the retroactive-price-edit drift (the frequent, money-affecting bug) by snapshotting **list price at booking**. Discount-adjusted commissionable revenue (a smaller, separate concern) is left as a follow-up and called out in the commit body — do not silently drop it.

**Files:**
- Modify: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`
- Migration files (Step 2)
- Modify: `src/app/services/booking-service.ts` (set `priceAtBooking` on create)
- Modify: `src/app/services/payroll-service.ts` (read the snapshot)

- [ ] **Step 1: Add the column to all three schemas**

In each schema's `Appointment` model add a nullable Decimal after `notes`:

```prisma
  priceAtBooking     Decimal?
```

Regenerate the client types:

Run: `pnpm db:vercel:generate`

- [ ] **Step 2: Create the migrations**

Preferred (with DB creds via `vercel env pull .env.vercel`):

```bash
pnpm db:dev:migrate --name add_price_at_booking
pnpm db:vercel:migrate --name add_price_at_booking
```

Or hand-author `prisma/vercel/migrations/<timestamp>_add_price_at_booking/migration.sql` (timestamp AFTER the session-version migration from Task 2.5):

```sql
ALTER TABLE "Appointment" ADD COLUMN "priceAtBooking" DECIMAL;
```

- [ ] **Step 3: Snapshot the price on both create paths**

In `src/app/services/booking-service.ts`, in `createBooking`'s `tx.appointment.create` (line 263) add `priceAtBooking` to the `data`:

```ts
    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId: data.stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        status: 'CONFIRMED',
        discountCodeId,
        priceAtBooking: service.price,
        notes: data.notes ?? null,
      },
```

And in `createBookingForFirstAvailable`'s `tx.appointment.create` (line 341) add the same line (`service` is in scope there too):

```ts
        priceAtBooking: service.price,
```

- [ ] **Step 4: Read the snapshot in payroll (fall back to live price for pre-migration rows)**

In `src/app/services/payroll-service.ts`, change the commission query + sum (lines 75-79):

```ts
      const appts = await prisma.appointment.findMany({
        where: { stylistId: e.stylistId, status: 'COMPLETED', date: { gte: start, lt: end } },
        select: { priceAtBooking: true, service: { select: { price: true } } },
      });
      commissionableRevenue = sumCommissionable(
        appts.map((a) => Number((a.priceAtBooking ?? a.service.price).toString())),
      );
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -3`
Expected: green. If tsc reports `priceAtBooking` missing on the Prisma type, re-run `pnpm db:vercel:generate`.

```bash
git add prisma/ src/app/services/booking-service.ts src/app/services/payroll-service.ts
git commit -m "fix(payroll): snapshot price at booking so later price edits don't reprice past commission

Follow-up: discount-adjusted commissionable revenue (booking with a discount code
still snapshots list price) is not yet handled — track separately."
```

---

## Phase 5 — Treatwell data WARNING

### Task 5.1: Skip cancelled iCal events (fixes #30)

**Problem:** `parseIcalBusyIntervals` never checks `ev.status`, so a Treatwell `STATUS:CANCELLED` event is kept as a busy block; the freed slot stays blocked indefinitely (prune never fires — the UID is still "seen").

**Files:**
- Modify: `src/app/services/treatwell-ical.ts`
- Modify: `src/app/services/treatwell-ical.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/services/treatwell-ical.test.ts` (match the existing fixture style in that file — Z-suffixed UTC):

```ts
test('parseIcalBusyIntervals — a STATUS:CANCELLED event is excluded', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:cancelled-1',
    'DTSTART:20260702T100000Z',
    'DTEND:20260702T110000Z',
    'STATUS:CANCELLED',
    'SUMMARY:Cancelled booking',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const result = parseIcalBusyIntervals(ics, { now });
  assert.deepEqual(result, []);
});
```

(If `parseIcalBusyIntervals` is not already imported at the top of the test file, add it.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test 2>&1 | grep -E "STATUS:CANCELLED" -A3 | head`
Expected: FAIL — the cancelled event is returned as one busy interval.

- [ ] **Step 3: Skip cancelled events in the parser**

In `src/app/services/treatwell-ical.ts`, inside the event loop, after the recurring-event skip (line 56), add:

```ts
    if (String((ev as { status?: unknown }).status ?? '').toUpperCase() === 'CANCELLED') continue;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test 2>&1 | tail -4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/treatwell-ical.ts src/app/services/treatwell-ical.test.ts
git commit -m "fix(treatwell): skip STATUS:CANCELLED events so freed slots don't stay blocked"
```

---

## Phase 6 — Test-coverage WARNINGs

### Task 6.1: Assert the external-busy overlap window structurally (fixes #33)

**Problem:** `external-busy.test.ts` only asserts the where-clause mentions `stylistId`; the overlap predicate (`start <= window.end`, `end >= window.start`) is unasserted, so a wrong window predicate passes.

**Files:** Modify `src/app/services/external-busy.test.ts`

- [ ] **Step 1: Read the current test and the `loadExternalBusy` where-clause**

Run: `sed -n '1,60p' src/app/services/external-busy.test.ts && sed -n '30,45p' src/app/services/external-busy.ts`
Note the exact object shape `loadExternalBusy` builds (stylistId filter + `start`/`end` comparators) so the assertion matches it verbatim.

- [ ] **Step 2: Replace the vague assertion with a structural one**

In the test that currently asserts the where clause "mentions stylistId" (around line 41), capture the `findMany` call args and assert the full overlap predicate. Using the fake `findMany` already in the file, assert:

```ts
assert.deepEqual(capturedWhere, {
  stylistId: { in: ['s1'] },
  start: { lte: window.end },
  end: { gte: window.start },
});
```

Adjust the exact key names/shape to match what `external-busy.ts` actually builds (from Step 1). If the fake records calls differently, assert `calls[0].where` instead of a captured local.

- [ ] **Step 3: Run to verify it still passes against the correct implementation**

Run: `pnpm test 2>&1 | grep -iE "external.busy|overlap" | head`
Expected: PASS. Then sanity-check it would fail on a mutation: temporarily flip `external-busy.ts` line ~39 to `start: { gte: window.start }`, run the test, confirm it FAILS, then revert.

- [ ] **Step 4: Commit**

```bash
git add src/app/services/external-busy.test.ts
git commit -m "test(external-busy): assert the full overlap-window predicate, not just stylistId"
```

### Task 6.2: Cover the payroll DB glue via an injectable db (fixes #27)

**Problem:** The pure payroll math is well tested, but the query predicates feeding it (`status: 'APPROVED'` entry selection, `status: 'COMPLETED'` commission, adjustment preservation across re-runs, month bounding) are untested — a dropped predicate silently mis-pays everyone.

**Fix strategy:** mirror the existing `treatwell-sync-service.ts` `Deps` pattern — refactor `runPayroll` to accept an injectable `db` so a fake can assert the where-clauses and the leaver/adjustment logic.

**Files:**
- Read first: `src/app/services/treatwell-sync-service.ts` and `src/app/services/treatwell-sync-service.test.ts` (copy the injectable-`Deps` pattern exactly)
- Modify: `src/app/services/payroll-service.ts` (extract a `runPayrollWith(db, year, month)` core; keep `runPayroll` as a thin wrapper passing the real `prisma`)
- Create: `src/app/services/payroll-service.test.ts`

- [ ] **Step 1: Study the existing injectable-db pattern**

Run: `sed -n '1,60p' src/app/services/treatwell-sync-service.ts && sed -n '1,40p' src/app/services/treatwell-sync-service.test.ts`
Replicate the same `type Deps = {...}` + default-real-deps approach.

- [ ] **Step 2: Extract the testable core**

In `src/app/services/payroll-service.ts`, define a `PayrollDb` type covering the exact prisma calls `runPayroll` makes (`payrollPeriod.upsert`, `timeEntry.findMany`, `payrollLine.findMany/findUnique/upsert`, `appointment.findMany`, `employee.findMany`). Extract `runPayrollWith(db: PayrollDb, year: number, month: number)` containing the current body, and make `runPayroll(year, month)` call `runPayrollWith(prisma, year, month)`. Do NOT change behavior.

- [ ] **Step 3: Write tests with a fake db**

Create `src/app/services/payroll-service.test.ts`. Build a fake `PayrollDb` whose `timeEntry.findMany`/`appointment.findMany` record the `where` they receive and return canned rows. Assert:
- the approved-entry query includes `status: 'APPROVED'` and `clockOut: { not: null }`;
- the commission query includes `status: 'COMPLETED'`;
- an existing line's `adjustments`/`adjustmentNote` are preserved into the upsert `update` on a re-run;
- `monthBounds` produces a salon-timezone month `[start, end)` (call the exported helper, or assert via the recorded query bounds).

Use exact assertions (`assert.equal`, `assert.deepEqual`), not `toBeTruthy`-style checks.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -4`
Expected: green, count up by the number of new tests.

```bash
git add src/app/services/payroll-service.ts src/app/services/payroll-service.test.ts
git commit -m "test(payroll): make runPayroll db-injectable and cover APPROVED/COMPLETED predicates + adjustment preservation"
```

### Task 6.3: Cover the booking gate stack (fixes #26)

**Problem:** The `submitBooking` gate decisions (consultation-only rejection, patch-test gate, past-date, "Anyone" resolution) have no tests; only the innermost `evaluatePatchTestEligibility` is covered. A refactor could drop the health/liability patch-test gate silently.

**Fix strategy:** extract the gate DECISIONS into a pure function and test it exhaustively. The DB fetches stay in `submitBooking`; the decision logic (given the already-fetched flags + eligibility + now) becomes pure and testable.

**Files:**
- Create: `src/app/services/booking-gates.ts`
- Create: `src/app/services/booking-gates.test.ts`
- Modify: `src/app/actions/booking.ts` (call the pure decider)

**Interfaces:**
- Produces: `evaluateBookingGates(input: { requiresConsultation: boolean; requiresPatchTest: boolean; patchTestEligible: boolean; patchTestReason: 'too_soon' | 'expired' | 'not_completed' | 'eligible'; bookingInstant: Date; now: Date }): { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

Create `src/app/services/booking-gates.test.ts` covering: consultation-only service rejected; past `bookingInstant` rejected; patch-test service with `patchTestEligible:false` + each reason returns the matching message; a normal service with no gates returns `{ ok: true }`; a patch-test service with `patchTestEligible:true` passes. Assert exact `error` strings.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test 2>&1 | grep -E "booking-gates|Cannot find module" | head`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure decider**

Create `src/app/services/booking-gates.ts` with `evaluateBookingGates` returning the same messages currently inlined in `submitBooking` (consultation-only; past-date; the three patch-test messages). Keep the message strings identical to today's.

- [ ] **Step 4: Use it in `submitBooking`**

In `src/app/actions/booking.ts`, replace the inline consultation/past-date/patch-test branches with a single call to `evaluateBookingGates(...)`, passing the already-fetched `service` flags, the eligibility result from `getValidPatchTest`, `fullDate`, and `new Date()`. Preserve current behavior (fetch eligibility only when `requiresPatchTest`). Keep the "Anyone"/`checkStylistHours` resolution as-is.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -4`
Expected: green.

```bash
git add src/app/services/booking-gates.ts src/app/services/booking-gates.test.ts src/app/actions/booking.ts
git commit -m "test(booking): extract + exhaustively test the consultation/patch-test/past-date gate decisions"
```

---

## Phase 7 — INFO cleanups (lower priority; batch as time allows)

These are quality improvements confirmed by the review. Each is small. Group into a few commits. For each, keep `tsc`/`lint`/`test` green.

### Task 7.1: Concurrency-safe create races → friendly errors (fixes #20, #43, #4)

- **`auth.ts` `register`** (#20): wrap the guest-update and the `user.create` in `try/catch`; on Prisma `P2002` (unique email) return `{ error: 'This email is already registered. Please sign in instead.' }` instead of throwing.
- **`reviews.ts` `createReview`** (#43): wrap the `prisma.review.create` in `try/catch`; on `P2002` (the `appointmentId @unique`) return a friendly "already reviewed" result.
- **`kiosk.ts` `clockToggle`** (#4): wrap the `$transaction` in `try/catch`; on failure return `{ ok: false, error: 'Please try again' }`. Reuse `runSerializableWithRetry` from `booking-service` (export it if needed) so a `P2034` retries transparently like booking does.

Commit: `fix(reliability): map create-race Prisma errors to friendly results (register/review/kiosk)`

### Task 7.2: Validate payroll month + admin catch-all (fixes #15, #42, #19)

- **`payroll.ts` `runPayroll` caller** (#15): add a Zod guard `z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) })` before calling the service; return a structured error on failure.
- **`admin.ts` create action catch-all** (#42): the catch that labels every error as "duplicate code" should re-throw / return a generic message for non-`P2002` errors (inspect `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'`).

Commit: `fix(admin): validate payroll month range; stop mislabeling all DB errors as duplicates`

### Task 7.3: Use the JSON-LD helper on /services (fixes #50)

- **`src/app/services/page.tsx`** (line ~105): replace the raw `JSON.stringify` inside `dangerouslySetInnerHTML` with the project's `jsonLdScript` helper from `src/app/lib/json-ld.ts` (it Unicode-escapes `<`/`>`/`&`). Follow the pattern already used elsewhere.

Commit: `fix(seo): render /services JSON-LD via the escaping jsonLdScript helper`

### Task 7.4: Per-request query dedup (fixes #44, #45)

- **`src/app/services/blog-service.ts` `getPublishedPostBySlug`** (#44): wrap in React `cache()` so `generateMetadata` + the page body share one query per request. Follow how `getSiteSettings` uses `cache()` in `site-settings-service.ts`.
- **`booking-service.ts` `getAvailableSlots`** (#45): the appointment query and the external-busy query are independent — run them with `Promise.all` instead of sequential awaits.

Commit: `perf: dedupe blog getter with cache(); parallelize independent slot queries`

### Task 7.5: Lazy-load MediaPipe on /try-color (fixes #47)

- **`src/app/try-color/TryColorClient.tsx`**: `segmentStill` and `@mediapipe/tasks-vision` are statically imported, pulling the wrapper into the eager route chunk even in landing mode. Convert to a dynamic `import()` performed only when segmentation actually starts (the first "start"/"upload" action), so the landing state doesn't ship the heavy dep.

Commit: `perf(try-color): dynamically import MediaPipe so landing mode doesn't load it`

### Task 7.6: Remaining test-coverage gaps (fixes #35, #36, #37, #38, #34)

Add tests only — no source changes:
- **`salon-time.test.ts`** (#35): add DST-transition-day assertions — `resolveSalonDateTime('2026-03-29','01:30')` (spring-forward) and `('2026-10-25','01:30')` (fall-back), plus `salonDayWindow('2026-10-25')` spanning ~25h.
- **`patch-test-eligibility.test.ts`** (#38): pin the 183-day (6-month) expiry boundary (currently only 150/200-day cases exist).
- **`treatwell-ical.test.ts`** (#36) and **`treatwell-sync-service.test.ts`** (#37): add a TZID-localized (non-`Z`) VEVENT fixture, and assert the sync's `treatwellIcalUrl: { not: null }` filter is actually applied (mutation-proof the mock).
- **cron reminders** (#34): if practical, extract the auth check (`safeCompare`) and the window math into a tiny pure helper and test them; otherwise document as an accepted gap in the PR.

Commit: `test: cover DST transitions, patch-test expiry boundary, TZID iCal, and sync url filter`

### Task 7.7: Remaining small hardening (fixes #3, #46, #48, #6, #7)

- **`admin.ts` `updateAppointmentStatus`** (#3): drop `'CONFIRMED'` from `ALLOWED_APPOINTMENT_STATUSES` (no UI passes it; leaving it accepts a latent double-booking via a hand-crafted call). If un-confirm is ever needed later, add it back WITH the same in-transaction conflict check `rescheduleAppointment` uses.
- **`payroll-service.ts` `updateAdjustment`/`finalizePayroll`** (#6, #7): note in the PR that these read-modify-write money paths are non-transactional; if touched, wrap the read+write in `$transaction`. (Low priority — the finalize claim is already atomic.)
- **`auth.ts` in-memory limiter** (#46) and **payroll N+1** (#48): documentation-only acknowledgements in the PR; do not change unless load becomes an issue.

Commit: `fix(admin): remove un-checked CONFIRMED re-confirm path from updateAppointmentStatus`

---

## Phase 8 — Final verification & rollout

### Task 8.1: Full local gate

- [ ] **Step 1: Run the complete gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test 2>&1 | tail -6`
Expected: tsc/lint clean; all tests pass (116 baseline + every test added above).

- [ ] **Step 2: Confirm no HIGH advisories remain**

Run: `pnpm audit --prod 2>&1 | tail -3`
Expected: no HIGH `next` advisories (low/moderate transitive ones are acceptable).

### Task 8.2: Open the PR and verify on a preview deploy

- [ ] **Step 1: Push and open a PR**

```bash
git push -u origin prod-hardening
gh pr create --title "Production hardening: CRITICAL booking fix, CVE bump, security + reliability + money fixes" --body "$(cat <<'EOF'
Implements docs/superpowers/plans/2026-07-06-production-hardening.md.

- CRITICAL: availability slots now built in salon timezone (BST grid was one hour off).
- Bumped next to 16.2.10 (clears 8 HIGH advisories incl. middleware bypass).
- Security: backslash open-redirect closed; sessions invalidated on password change; booking + unsubscribe rate-limited; services can't run past closing.
- Reliability: review requests include COMPLETED; reminder retries; Resend timeout; newsletter/kiosk resilience; category-page revalidation; error boundaries.
- Money: price snapshot for commission; HYBRID hourlyRate-0 and null overtime-threshold fixes.
- Treatwell: cancelled events skipped.
- Tests added across the above.

DB migrations: adds User.sessionVersion and Appointment.priceAtBooking (both additive, non-breaking). They deploy via `prisma migrate deploy` in vercel-build on production.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Verify the preview deploy**

On the Vercel preview: (a) build succeeds and runs the new migrations against the preview/branch DB; (b) the booking availability grid shows correct times for a stylist with an existing appointment (the CRITICAL fix — verify during BST); (c) admin service edits propagate to the public category page; (d) marketing pages still render. Note: preview URLs are login-gated per the team convention.

- [ ] **Step 3: Merge**

Squash-merge once CI is green; the merge to `main` triggers the GitHub Actions → Vercel production deploy, which runs `prisma migrate deploy` for the two new columns.

---

## Self-Review (completed by plan author)

- **Spec coverage:** All 20 confirmed WARNINGs and the CRITICAL have a dedicated task (Phases 1–6). The 8 HIGH CVEs are Phase 0.2. INFO items #3, #4, #6, #7, #15, #20, #34, #35, #36, #37, #38, #42, #43, #44, #45, #46, #47, #48, #50 are covered in Phase 7. INFO items #19, #21, #24, #32, #33 are covered (#32 folded into Task 2.1 tests; #33 is Task 6.1; #19 noted in 7.7; #21/#24 are addressed by the friendly-error and unsubscribe changes).
- **Migration safety:** both schema changes are additive columns with defaults/nullability, so `migrate deploy` is non-breaking on the live Neon DB. `verifySession` treats a missing `sessionVersion` claim as `0` to avoid mass-logout on rollout.
- **Type consistency:** `TimeSlot` is defined once in `scheduling.ts` and re-exported from `booking-service.ts`; `SessionPayload` is defined once in `jwt.ts` and imported by `session.ts`; `sanitizeRedirect`, `fitsWithinAvailability`, `buildSlotsForWindow`, `toSalonDateStr`, `evaluateBookingGates` names are used consistently across the tasks that produce and consume them.
- **Prisma-free test rule:** every new unit test targets a module that does NOT import `@/app/lib/prisma` (`scheduling`, `salon-time`, `redirect`, `jwt`, `payroll-calc`, `treatwell-ical`, `booking-gates`), and `payroll-service` tests use the injectable-db pattern — so none will crash on the missing-DB-URL throw.
