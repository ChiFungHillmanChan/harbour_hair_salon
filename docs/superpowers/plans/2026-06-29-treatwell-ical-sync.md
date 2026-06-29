# Treatwell ↔ Salon iCal Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop double-bookings between Treatwell and our own booking system by importing each stylist's Treatwell calendar (iCal feed) and treating those busy times as unavailable in our availability + booking logic, triggered every 5 minutes by AWS EventBridge.

**Architecture:** There is no Treatwell public API, so we use iCal. **Phase 1 (inbound, this plan):** an AWS EventBridge Scheduler fires every 5 min → invokes a tiny Lambda → the Lambda GETs our `/api/cron/treatwell-sync` route (Bearer `CRON_SECRET`). That route fetches each stylist's Treatwell iCal URL, parses the events, and upserts them into a new `ExternalBusyBlock` table. The four existing conflict-check sites in `booking-service.ts` then merge those blocks into their busy intervals so a Treatwell-booked slot is hidden and cannot be booked. **Phase 2 (outbound, appendix):** we expose our own per-stylist iCal feed that Treatwell subscribes to, closing the loop. All heavy logic lives in the Next.js app; AWS only schedules.

**Tech Stack:** Next.js 16 App Router, Prisma 5 (triple schema), `node-ical` (new dep), `date-fns` / `date-fns-tz` (already used), `node:test` + `node:assert/strict`, AWS EventBridge Scheduler + Lambda (Node 20).

## Global Constraints

- **Edit all three Prisma schemas** for any model change: `prisma/dev/schema.prisma` (SQLite), `prisma/vercel/schema.prisma` (PostgreSQL — the one the app's Prisma client is generated from), `prisma/prod/schema.prisma` (MS SQL Server).
- **Never access env vars at module level** — read `process.env.*` inside the request handler / function body (mirror `src/app/api/cron/reminders/route.ts`).
- **Cron endpoints are API routes** (not server actions), auth'd with `Bearer ${CRON_SECRET}` via the existing `safeCompare` (timing-safe) pattern.
- **Store all instants as absolute UTC** `DateTime`. Salon wall-clock conversions go through `src/app/services/salon-time.ts` (`SALON_TIMEZONE = 'Europe/London'`, `salonDayWindow`).
- **Tests** run via `pnpm test` (`node --import tsx --test "src/**/*.test.ts"`), style: `import test from 'node:test'; import assert from 'node:assert/strict';`.
- **Local `pnpm build` fails on DB** — verify with `pnpm test`, `pnpm lint`, and `npx tsc --noEmit`, not `pnpm build`.
- Booking source of truth stays our DB; iCal syncs **time blocking only** (not services/prices/staff).

## File Structure

| File | Responsibility |
|---|---|
| `prisma/{dev,vercel,prod}/schema.prisma` | Add `ExternalBusyBlock` model + `Stylist.treatwellIcalUrl` field |
| `src/app/services/treatwell-ical.ts` | **NEW** Pure: parse iCal text → `BusyInterval[]`. No network/DB. |
| `src/app/services/treatwell-ical.test.ts` | **NEW** Unit tests for the parser |
| `src/app/services/external-busy.ts` | **NEW** Load `ExternalBusyBlock` rows for stylist(s)+window; convert to `BookedInterval` / `SlotAppointment` |
| `src/app/services/external-busy.test.ts` | **NEW** Unit tests for the converters (pure helpers) |
| `src/app/services/treatwell-sync-service.ts` | **NEW** Orchestrate: fetch each feed → upsert → prune stale. Network injected for tests. |
| `src/app/services/treatwell-sync-service.test.ts` | **NEW** Tests with injected fetch + a fake DB layer |
| `src/app/api/cron/treatwell-sync/route.ts` | **NEW** Auth + invoke sync service; return summary JSON |
| `src/app/services/booking-service.ts` | **MODIFY** Merge external busy into the 4 conflict sites |
| `src/app/actions/admin-stylists.ts` | **MODIFY** Accept/persist `treatwellIcalUrl` |
| `infra/aws/treatwell-sync/index.mjs` | **NEW** Lambda trigger (10 lines) |
| `infra/aws/treatwell-sync/README.md` | **NEW** AWS deploy runbook |

---

## Task 1: Database schema — `ExternalBusyBlock` + stylist feed URL

**Files:**
- Modify: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`
- Migrate: `pnpm db:dev:push` then `pnpm db:vercel:push`

**Interfaces:**
- Produces: Prisma model `ExternalBusyBlock { id, source, externalUid, stylistId, stylist, start, end, summary, lastSyncAt }` with `@@unique([source, externalUid])`; `Stylist.treatwellIcalUrl String?` and relation `externalBusyBlocks ExternalBusyBlock[]`.

- [ ] **Step 1: Add the model + field to all three schemas**

In each of the three schema files, add to `model Stylist { ... }`:

```prisma
  treatwellIcalUrl   String?
  externalBusyBlocks ExternalBusyBlock[]
```

And add the new model (place near `Appointment`):

```prisma
model ExternalBusyBlock {
  id          String   @id @default(cuid())
  source      String   @default("TREATWELL") // TREATWELL (future: other channels)
  externalUid String   // iCal VEVENT UID — natural key for upsert/dedup
  stylistId   String
  stylist     Stylist  @relation(fields: [stylistId], references: [id], onDelete: Cascade)
  start       DateTime
  end         DateTime
  summary     String?  // raw event title, for debugging only
  lastSyncAt  DateTime @default(now())

  @@unique([source, externalUid])
  @@index([stylistId, start])
}
```

- [ ] **Step 2: Push to dev (SQLite) and regenerate the client**

Run: `pnpm db:dev:push && pnpm db:vercel:generate`
Expected: "Your database is now in sync with your Prisma schema" and a regenerated client (the app generates from the **vercel** schema — see `postinstall`).

- [ ] **Step 3: Push to Vercel Postgres**

Run: `pnpm db:vercel:push`
Expected: schema applied to Neon, no data loss warnings on the new table.

- [ ] **Step 4: Commit**

```bash
git add prisma/dev/schema.prisma prisma/vercel/schema.prisma prisma/prod/schema.prisma
git commit -m "feat(db): add ExternalBusyBlock + Stylist.treatwellIcalUrl for Treatwell sync"
```

---

## Task 2: iCal parser (pure, network-free)

**Files:**
- Create: `src/app/services/treatwell-ical.ts`
- Test: `src/app/services/treatwell-ical.test.ts`
- Add dep: `node-ical`

**Interfaces:**
- Produces: `type BusyInterval = { uid: string; start: Date; end: Date; summary?: string }` and `parseIcalBusyIntervals(icsText: string, opts?: { now?: Date; windowEnd?: Date }): BusyInterval[]` — returns only events that end at/after `now` and start before `windowEnd` (default now → +90 days). Skips recurring (`rrule`) events and events missing start/end.

- [ ] **Step 1: Install the parser**

Run: `pnpm add node-ical`
Expected: `node-ical` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// src/app/services/treatwell-ical.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcalBusyIntervals } from './treatwell-ical';

const ICS = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', body, 'END:VCALENDAR'].join('\r\n');

const EVENT = ICS(
  [
    'BEGIN:VEVENT',
    'UID:abc-123',
    'SUMMARY:Treatwell booking',
    'DTSTART:20260701T090000Z',
    'DTEND:20260701T100000Z',
    'END:VEVENT',
  ].join('\r\n'),
);

test('parses a single timed VEVENT into one interval', () => {
  const out = parseIcalBusyIntervals(EVENT, { now: new Date('2026-06-01T00:00:00Z') });
  assert.equal(out.length, 1);
  assert.equal(out[0].uid, 'abc-123');
  assert.equal(out[0].start.toISOString(), '2026-07-01T09:00:00.000Z');
  assert.equal(out[0].end.toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(out[0].summary, 'Treatwell booking');
});

test('drops events that already ended before now', () => {
  const out = parseIcalBusyIntervals(EVENT, { now: new Date('2026-08-01T00:00:00Z') });
  assert.equal(out.length, 0);
});

test('drops events beyond the window end', () => {
  const out = parseIcalBusyIntervals(EVENT, {
    now: new Date('2026-06-01T00:00:00Z'),
    windowEnd: new Date('2026-06-15T00:00:00Z'),
  });
  assert.equal(out.length, 0);
});

test('returns [] for empty / non-calendar text', () => {
  assert.deepEqual(parseIcalBusyIntervals(''), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep treatwell-ical`
Expected: FAIL — `parseIcalBusyIntervals` not found / module missing.

- [ ] **Step 4: Implement the parser**

```ts
// src/app/services/treatwell-ical.ts
import ical from 'node-ical';

export type BusyInterval = { uid: string; start: Date; end: Date; summary?: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse an iCal (.ics) document into busy intervals, keeping only events that
 * overlap the forward window [now, windowEnd). Pure: no network, no DB.
 *
 * Scope (v1): non-recurring timed VEVENTs only. Recurring events (rrule) are
 * skipped — Treatwell appointment feeds emit discrete events. All-day events
 * (datetype === 'date') block the whole salon day they cover.
 */
export function parseIcalBusyIntervals(
  icsText: string,
  opts: { now?: Date; windowEnd?: Date } = {},
): BusyInterval[] {
  if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) return [];

  const now = opts.now ?? new Date();
  const windowEnd = opts.windowEnd ?? new Date(now.getTime() + 90 * DAY_MS);

  let parsed: Record<string, ical.CalendarComponent>;
  try {
    parsed = ical.sync.parseICS(icsText);
  } catch {
    return [];
  }

  const out: BusyInterval[] = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT') continue;
    if ((ev as { rrule?: unknown }).rrule) continue; // skip recurring (v1)
    if (!ev.start) continue;

    const start = new Date(ev.start as Date);
    let end: Date;
    if (ev.end) {
      end = new Date(ev.end as Date);
    } else if ((ev as { datetype?: string }).datetype === 'date') {
      end = new Date(start.getTime() + DAY_MS); // all-day with no DTEND
    } else {
      continue; // timed event without DTEND — cannot bound it
    }
    if (!(end > start)) continue;

    // Keep only events overlapping [now, windowEnd)
    if (end <= now) continue;
    if (start >= windowEnd) continue;

    out.push({
      uid: String(ev.uid ?? key),
      start,
      end,
      summary: ev.summary ? String(ev.summary) : undefined,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test 2>&1 | grep -E "treatwell-ical|pass|fail"`
Expected: the 4 new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/services/treatwell-ical.ts src/app/services/treatwell-ical.test.ts
git commit -m "feat(treatwell): add network-free iCal busy-interval parser"
```

---

## Task 3: External-busy loader + interval converters

**Files:**
- Create: `src/app/services/external-busy.ts`
- Test: `src/app/services/external-busy.test.ts`

**Interfaces:**
- Consumes: Prisma `ExternalBusyBlock`; `BookedInterval` from `./scheduling`.
- Produces:
  - `type ExternalBlockRow = { stylistId: string; start: Date; end: Date }`
  - `toBookedInterval(row): BookedInterval` → `{ start, durationMin }`
  - `toSlotAppointment(row): { date: Date; service: { duration: number } }`
  - `async loadExternalBusy(db, stylistIds: string[], window: { start: Date; end: Date }): Promise<ExternalBlockRow[]>` where `db` is a Prisma client **or** a `$transaction` tx (anything exposing `externalBusyBlock.findMany`).

- [ ] **Step 1: Write the failing test (pure converters)**

```ts
// src/app/services/external-busy.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { toBookedInterval, toSlotAppointment, loadExternalBusy } from './external-busy';

const row = {
  stylistId: 's1',
  start: new Date('2026-07-01T09:00:00Z'),
  end: new Date('2026-07-01T09:45:00Z'),
};

test('toBookedInterval converts end→durationMin', () => {
  assert.deepEqual(toBookedInterval(row), {
    start: new Date('2026-07-01T09:00:00Z'),
    durationMin: 45,
  });
});

test('toSlotAppointment shapes a pseudo-appointment', () => {
  assert.deepEqual(toSlotAppointment(row), {
    date: new Date('2026-07-01T09:00:00Z'),
    service: { duration: 45 },
  });
});

test('loadExternalBusy queries the overlap window and passes through rows', async () => {
  const calls: unknown[] = [];
  const fakeDb = {
    externalBusyBlock: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return [row];
      },
    },
  };
  const out = await loadExternalBusy(fakeDb as never, ['s1'], {
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-07-01T23:59:59Z'),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].stylistId, 's1');
  // overlap predicate: start <= window.end AND end >= window.start
  assert.ok(JSON.stringify(calls[0]).includes('stylistId'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep external-busy`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loader + converters**

```ts
// src/app/services/external-busy.ts
import type { BookedInterval } from './scheduling';

export type ExternalBlockRow = { stylistId: string; start: Date; end: Date };

const durationMin = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

export function toBookedInterval(row: ExternalBlockRow): BookedInterval {
  return { start: row.start, durationMin: durationMin(row.start, row.end) };
}

export function toSlotAppointment(row: ExternalBlockRow): {
  date: Date;
  service: { duration: number };
} {
  return { date: row.start, service: { duration: durationMin(row.start, row.end) } };
}

/** Minimal shape we need from a Prisma client or transaction. */
type BusyReader = {
  externalBusyBlock: {
    findMany: (args: {
      where: unknown;
      select: { stylistId: true; start: true; end: true };
    }) => Promise<ExternalBlockRow[]>;
  };
};

/**
 * Load external busy blocks for the given stylists that overlap [window.start,
 * window.end]. Overlap = block.start <= window.end AND block.end >= window.start.
 * `db` may be the Prisma client or a transaction client.
 */
export async function loadExternalBusy(
  db: BusyReader,
  stylistIds: string[],
  window: { start: Date; end: Date },
): Promise<ExternalBlockRow[]> {
  if (stylistIds.length === 0) return [];
  return db.externalBusyBlock.findMany({
    where: {
      stylistId: { in: stylistIds },
      start: { lte: window.end },
      end: { gte: window.start },
    },
    select: { stylistId: true, start: true, end: true },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test 2>&1 | grep -E "external-busy|pass|fail"`
Expected: 3 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/external-busy.ts src/app/services/external-busy.test.ts
git commit -m "feat(treatwell): add external-busy loader + interval converters"
```

---

## Task 4: Sync service (fetch → upsert → prune)

**Files:**
- Create: `src/app/services/treatwell-sync-service.ts`
- Test: `src/app/services/treatwell-sync-service.test.ts`

**Interfaces:**
- Consumes: `parseIcalBusyIntervals` (Task 2); Prisma client.
- Produces: `async syncTreatwellFeeds(deps?: { db?; fetchImpl?; now? }): Promise<SyncResult[]>` where `type SyncResult = { stylistId: string; ok: boolean; upserted: number; pruned: number; error?: string }`. On a feed fetch/parse failure for a stylist, that stylist's future blocks are **left intact** (no prune) and `ok:false` is recorded — a transient Treatwell outage must never open a slot to double-booking.

- [ ] **Step 1: Write the failing test (injected fetch + fake db)**

```ts
// src/app/services/treatwell-sync-service.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTreatwellFeeds } from './treatwell-sync-service';

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN',
  'BEGIN:VEVENT', 'UID:tw-1', 'DTSTART:20260701T090000Z', 'DTEND:20260701T100000Z', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

function fakeDb(stylists: { id: string; treatwellIcalUrl: string | null }[]) {
  const upserts: unknown[] = [];
  const prunes: unknown[] = [];
  return {
    upserts,
    prunes,
    stylist: { findMany: async () => stylists.filter((s) => s.treatwellIcalUrl) },
    externalBusyBlock: {
      upsert: async (a: unknown) => { upserts.push(a); },
      deleteMany: async (a: unknown) => { prunes.push(a); return { count: 0 }; },
    },
  };
}

test('upserts parsed events and prunes stale uids on success', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  const res = await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => ICS }) as never,
  });
  assert.equal(res[0].ok, true);
  assert.equal(res[0].upserted, 1);
  assert.equal(db.upserts.length, 1);
  assert.equal(db.prunes.length, 1); // prune ran because fetch succeeded
});

test('does NOT prune when a feed fetch fails', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  const res = await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'down' }) as never,
  });
  assert.equal(res[0].ok, false);
  assert.match(res[0].error ?? '', /503/);
  assert.equal(db.upserts.length, 0);
  assert.equal(db.prunes.length, 0); // preserved last-known blocks
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test 2>&1 | grep treatwell-sync`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sync service**

```ts
// src/app/services/treatwell-sync-service.ts
import 'server-only';
import prismaDefault from '@/app/lib/prisma';
import { parseIcalBusyIntervals } from './treatwell-ical';

export type SyncResult = {
  stylistId: string;
  ok: boolean;
  upserted: number;
  pruned: number;
  error?: string;
};

type Deps = {
  db?: typeof prismaDefault;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function syncTreatwellFeeds(deps: Deps = {}): Promise<SyncResult[]> {
  const db = deps.db ?? prismaDefault;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();

  const stylists = await db.stylist.findMany({
    where: { treatwellIcalUrl: { not: null } },
    select: { id: true, treatwellIcalUrl: true },
  });

  const results: SyncResult[] = [];

  for (const s of stylists) {
    const url = s.treatwellIcalUrl as string;
    try {
      const resp = await doFetch(url, { headers: { Accept: 'text/calendar' } });
      if (!resp.ok) {
        results.push({ stylistId: s.id, ok: false, upserted: 0, pruned: 0, error: `HTTP ${resp.status}` });
        continue; // do NOT prune — preserve last-known blocks
      }
      const text = await resp.text();
      const intervals = parseIcalBusyIntervals(text, { now });

      for (const iv of intervals) {
        await db.externalBusyBlock.upsert({
          where: { source_externalUid: { source: 'TREATWELL', externalUid: iv.uid } },
          create: {
            source: 'TREATWELL',
            externalUid: iv.uid,
            stylistId: s.id,
            start: iv.start,
            end: iv.end,
            summary: iv.summary ?? null,
          },
          update: { stylistId: s.id, start: iv.start, end: iv.end, summary: iv.summary ?? null, lastSyncAt: now },
        });
      }

      const seen = intervals.map((iv) => iv.uid);
      const pruned = await db.externalBusyBlock.deleteMany({
        where: { source: 'TREATWELL', stylistId: s.id, start: { gte: now }, externalUid: { notIn: seen } },
      });

      results.push({ stylistId: s.id, ok: true, upserted: intervals.length, pruned: pruned.count });
    } catch (err) {
      results.push({
        stylistId: s.id,
        ok: false,
        upserted: 0,
        pruned: 0,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  return results;
}
```

> Note: `source_externalUid` is Prisma's generated compound-unique key name from `@@unique([source, externalUid])`. Confirm it after `pnpm db:vercel:generate`; if Prisma named it differently, match the generated name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test 2>&1 | grep -E "treatwell-sync|pass|fail"`
Expected: 2 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/treatwell-sync-service.ts src/app/services/treatwell-sync-service.test.ts
git commit -m "feat(treatwell): add feed sync service (upsert + fail-safe prune)"
```

---

## Task 5: Cron route `/api/cron/treatwell-sync`

**Files:**
- Create: `src/app/api/cron/treatwell-sync/route.ts`

**Interfaces:**
- Consumes: `syncTreatwellFeeds` (Task 4); `CRON_SECRET` env.
- Produces: `GET` handler returning `{ ok, results }` JSON; 401 on bad auth; 500 if `CRON_SECRET` unset.

- [ ] **Step 1: Implement the route (mirror reminders auth)**

```ts
// src/app/api/cron/treatwell-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { syncTreatwellFeeds } from '@/app/services/treatwell-sync-service';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await syncTreatwellFeeds();
  const ok = results.every((r) => r.ok);
  if (!ok) console.error('Treatwell sync had failures', results.filter((r) => !r.ok));
  return NextResponse.json({ ok, results });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test (optional, against dev server)**

Run: `curl -s -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/treatwell-sync`
Expected: `{"ok":true,"results":[]}` (empty until a stylist has a `treatwellIcalUrl`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/treatwell-sync/route.ts
git commit -m "feat(treatwell): add /api/cron/treatwell-sync route"
```

> **Important:** Do **not** add this path to `vercel.json` crons — Vercel Hobby caps cron at once-per-day. AWS EventBridge (Task 8) drives it instead.

---

## Task 6: Merge external busy into the 4 booking conflict sites

**Files:**
- Modify: `src/app/services/booking-service.ts`

**Interfaces:**
- Consumes: `loadExternalBusy`, `toBookedInterval`, `toSlotAppointment` (Task 3); `salonDayWindow` (already imported).

All four sites already build busy intervals from `appointment.findMany`. We additionally load `ExternalBusyBlock` for the same stylist(s) over the salon day window and merge.

- [ ] **Step 1: Add the import**

At the top of `src/app/services/booking-service.ts`, add:

```ts
import { loadExternalBusy, toBookedInterval, toSlotAppointment } from './external-busy';
```

- [ ] **Step 2: Site A — `getAvailableSlots` (single stylist listing)**

After the `existingAppointments` query (the `prisma.appointment.findMany` around line 93) and before `return buildStylistSlots(...)`, merge:

```ts
  const dayWindow = salonDayWindow(date);
  const externalBlocks = await loadExternalBusy(prisma, [stylistId], dayWindow);
  const busy = [...existingAppointments, ...externalBlocks.map(toSlotAppointment)];

  // 3. Generate slots
  return buildStylistSlots(availability, busy, date, serviceDuration);
```

(Replace the existing `return buildStylistSlots(availability, existingAppointments, date, serviceDuration);`.)

- [ ] **Step 3: Site B — `getAvailableSlotsUnion` (Anyone listing)**

After `apptsByStylist` is built (around line 132–139), merge external blocks per stylist:

```ts
  const dayWindow = salonDayWindow(date);
  const externalBlocks = await loadExternalBusy(prisma, stylistIds, dayWindow);
  for (const row of externalBlocks) {
    const list = apptsByStylist.get(row.stylistId) ?? [];
    list.push(toSlotAppointment(row));
    apptsByStylist.set(row.stylistId, list);
  }
```

- [ ] **Step 4: Site C — `createBooking` (single stylist, Serializable tx)**

Inside the `$transaction`, after `existingAppointments` is fetched (around line 199), load external blocks **through the tx** and fold into the conflict check:

```ts
    const externalBlocks = await loadExternalBusy(tx, [data.stylistId], { start: dayStart, end: dayEnd });
    const blocking = [
      ...existingAppointments.map((a) => ({ start: new Date(a.date), durationMin: a.service.duration })),
      ...externalBlocks.map(toBookedInterval),
    ];

    const hasConflict = blocking.some((b) => {
      const bEnd = addMinutes(b.start, b.durationMin);
      return data.date < bEnd && b.start < appointmentEnd; // half-open overlap
    });

    if (hasConflict) {
      throw new SlotUnavailableError();
    }
```

(Replace the existing `existingAppointments.some(...)` conflict block with the unified `blocking` check above.)

- [ ] **Step 5: Site D — `createBookingForFirstAvailable` (Anyone, Serializable tx)**

After `bookedByStylist` is built (around line 273–278), merge external blocks (via `tx`):

```ts
    const externalBlocks = await loadExternalBusy(tx, data.candidateStylistIds, { start: dayStart, end: dayEnd });
    for (const row of externalBlocks) {
      const list = bookedByStylist.get(row.stylistId) ?? [];
      list.push(toBookedInterval(row));
      bookedByStylist.set(row.stylistId, list);
    }
```

- [ ] **Step 6: Write an integration-style test for the merge logic**

Add `src/app/services/external-busy-merge.test.ts` proving a block hides a slot. Because `buildStylistSlots` is module-private, test the public conflict shape via `hasConflict` from `scheduling` fed by `toBookedInterval`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasConflict } from './scheduling';
import { toBookedInterval } from './external-busy';

test('an external block makes an overlapping slot conflict', () => {
  const block = toBookedInterval({
    stylistId: 's1',
    start: new Date('2026-07-01T09:00:00Z'),
    end: new Date('2026-07-01T09:30:00Z'),
  });
  // booking 09:15–09:45 overlaps the 09:00–09:30 Treatwell block
  assert.equal(hasConflict(new Date('2026-07-01T09:15:00Z'), 30, [block]), true);
  // booking 09:30–10:00 is back-to-back → no conflict
  assert.equal(hasConflict(new Date('2026-07-01T09:30:00Z'), 30, [block]), false);
});
```

- [ ] **Step 7: Run tests + type-check + lint**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/services/booking-service.ts src/app/services/external-busy-merge.test.ts
git commit -m "feat(treatwell): block Treatwell busy times across all 4 conflict sites"
```

---

## Task 7: Admin — set a stylist's Treatwell iCal URL

**Files:**
- Modify: `src/app/actions/admin-stylists.ts` (and the stylist edit form component it serves)

**Interfaces:**
- Consumes: existing `stylistSchema` (Zod) + admin update action.
- Produces: persisted `Stylist.treatwellIcalUrl`.

- [ ] **Step 1: Add the field to the Zod schema**

In `stylistSchema`, add:

```ts
  treatwellIcalUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
```

- [ ] **Step 2: Persist it in the create/update Prisma calls**

Wherever the action does `prisma.stylist.create`/`update`, include `treatwellIcalUrl` in the `data` object (it is already parsed by the schema).

- [ ] **Step 3: Add an input to the stylist edit form**

In the admin stylist form component, add a text input named `treatwellIcalUrl` (label: "Treatwell iCal feed URL", placeholder `https://…/staff.ics`), defaulting to the current value.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/admin-stylists.ts src/components/admin
git commit -m "feat(admin): manage per-stylist Treatwell iCal URL"
```

---

## Task 8: AWS EventBridge Scheduler + Lambda trigger (runbook)

**Files:**
- Create: `infra/aws/treatwell-sync/index.mjs`
- Create: `infra/aws/treatwell-sync/README.md`

**Interfaces:**
- Consumes: env `SYNC_URL` (= `https://<your-vercel-domain>/api/cron/treatwell-sync`), `CRON_SECRET` (same value as Vercel).

- [ ] **Step 1: Write the Lambda handler**

```js
// infra/aws/treatwell-sync/index.mjs  (Node 20 runtime — global fetch available)
export const handler = async () => {
  const url = process.env.SYNC_URL;
  const secret = process.env.CRON_SECRET;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Treatwell sync failed: HTTP ${res.status} ${body}`);
  console.log('Treatwell sync ok:', body);
  return { statusCode: res.status, body };
};
```

- [ ] **Step 2: Package + create the Lambda**

```bash
cd infra/aws/treatwell-sync
zip function.zip index.mjs

# One-time IAM role for the Lambda (basic logging only — no VPC, so no NAT needed)
aws iam create-role --role-name treatwell-sync-lambda \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name treatwell-sync-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws lambda create-function --function-name treatwell-sync \
  --runtime nodejs20.x --handler index.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::<ACCOUNT_ID>:role/treatwell-sync-lambda \
  --timeout 30 \
  --environment "Variables={SYNC_URL=https://<your-domain>/api/cron/treatwell-sync,CRON_SECRET=<same-as-vercel>}"
```

- [ ] **Step 3: Create the EventBridge schedule (every 5 minutes)**

```bash
# Role allowing Scheduler to invoke the Lambda
aws iam create-role --role-name treatwell-sync-scheduler \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name treatwell-sync-scheduler --policy-name invoke \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"lambda:InvokeFunction","Resource":"arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:treatwell-sync"}]}'

aws scheduler create-schedule --name treatwell-sync-5min \
  --schedule-expression "rate(5 minutes)" \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target '{"Arn":"arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:treatwell-sync","RoleArn":"arn:aws:iam::<ACCOUNT_ID>:role/treatwell-sync-scheduler"}'
```

- [ ] **Step 4: Verify end-to-end**

```bash
aws lambda invoke --function-name treatwell-sync /dev/stdout
```
Expected: `{"statusCode":200,"body":"{\"ok\":true,...}"}`. Then add a real Treatwell iCal URL to one stylist, book that slot on Treatwell, wait ≤5 min, and confirm the slot disappears from our booking page.

- [ ] **Step 5: Document + commit the runbook**

Write `infra/aws/treatwell-sync/README.md` capturing the account ID, region, function/schedule names, and the "no VPC → no NAT Gateway" cost note. Then:

```bash
git add infra/aws/treatwell-sync
git commit -m "chore(infra): AWS EventBridge+Lambda trigger for Treatwell sync"
```

---

## Self-Review notes

- **Spec coverage:** inbound double-book prevention (Tasks 2–6), 5-min trigger without paying Vercel Pro (Task 8), admin control of feed URLs (Task 7), schema (Task 1). ✅
- **Fail-safe:** sync never prunes on fetch failure (Task 4) — a Treatwell outage can't free a blocked slot. ✅
- **Type consistency:** `toBookedInterval` → `{start, durationMin}` matches `BookedInterval` in `scheduling.ts`; `toSlotAppointment` → `{date, service:{duration}}` matches `SlotAppointment` consumed by `buildStylistSlots`. ✅
- **Known v1 limitations (documented, not bugs):** recurring (rrule) events skipped; outbound (our→Treatwell) deferred to Phase 2; sync latency = 5 min on our side, plus Treatwell's own feed-refresh cadence on the outbound side.

---

## Appendix — Phase 2 (outbound, optional, later)

Goal: Treatwell stops double-booking a slot a direct customer just took.

- Add `GET /api/ical/[stylistId]/route.ts` returning `text/calendar`: one `VEVENT` per future non-cancelled appointment for that stylist, summary fixed to `"Busy"` (no customer PII), guarded by an unguessable per-stylist token (new `Stylist.icalToken String? @unique`).
- In Treatwell Connect, paste that URL into each staff member's "external calendar" field.
- **Hard limit (cannot be engineered away):** Treatwell refreshes subscribed external feeds on *its own* cadence (often hours), so outbound protection lags. Neither AWS nor Vercel Pro changes this — it's Treatwell's polling, not ours.
