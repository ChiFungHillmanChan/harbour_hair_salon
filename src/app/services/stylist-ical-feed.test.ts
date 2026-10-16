import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStylistIcalFeed } from './stylist-ical-feed';

type FakeBlock = { externalUid: string; source: string; stylistId: string; start: Date; end: Date };
type FakeAppt = { id: string; date: Date; service: { duration: number }; status?: string };

/** Applies the query's status filter, so a too-narrow filter drops the row. */
function statusMatches(row: FakeAppt, filter: unknown): boolean {
  const status = row.status ?? 'CONFIRMED';
  if (!filter || typeof filter !== 'object') return filter === undefined || filter === status;
  if ('in' in filter) return (filter.in as string[]).includes(status);
  if ('not' in filter) return status !== filter.not;
  throw new Error(`Unhandled status filter ${JSON.stringify(filter)}`);
}

function fakeDb(
  stylist: { id: string; icalToken: string | null } | null,
  appointments: FakeAppt[] = [],
  blocks: FakeBlock[] = [],
) {
  const blockQueries: { where: Record<string, unknown>; select: unknown }[] = [];
  const findUniqueCalls: { where: unknown; select: unknown }[] = [];
  const findManyCalls: { where: unknown; select: unknown; orderBy: unknown }[] = [];
  return {
    findUniqueCalls,
    findManyCalls,
    blockQueries,
    stylist: {
      findUnique: async (args: { where: unknown; select: unknown }) => {
        findUniqueCalls.push(args);
        return stylist;
      },
    },
    appointment: {
      findMany: async (args: { where: unknown; select: unknown; orderBy: unknown }) => {
        findManyCalls.push(args);
        return appointments.filter((row) => statusMatches(row, (args.where as { status?: unknown }).status));
      },
    },
    // Applies the query's own filters, so a missing source/stylist/end filter leaks rows.
    externalBusyBlock: {
      findMany: async (args: { where: Record<string, unknown>; select: unknown }) => {
        blockQueries.push(args);
        const where = args.where as { stylistId: string; source?: string; end?: { gt: Date } };
        return blocks.filter(
          (b) =>
            b.stylistId === where.stylistId &&
            (where.source === undefined || b.source === where.source) &&
            (where.end === undefined || b.end > where.end.gt),
        );
      },
    },
  };
}

const NOW = new Date('2026-07-21T12:00:00Z');

test('returns 404 when the stylist does not exist', async () => {
  const db = fakeDb(null);
  const result = await buildStylistIcalFeed('missing', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 404);
});

test('returns 404 when the stylist has no feed token configured', async () => {
  const db = fakeDb({ id: 's1', icalToken: null });
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 404);
});

test('returns 404 on token mismatch without querying appointments', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'correct-token' }, []);
  const result = await buildStylistIcalFeed('s1', 'wrong-token', { db: db as never, now: NOW });
  assert.equal(result.status, 404);
  assert.equal(db.findManyCalls.length, 0);
});

test('returns 404 for an empty supplied token even if it matches an empty stored token', async () => {
  const db = fakeDb({ id: 's1', icalToken: '' });
  const result = await buildStylistIcalFeed('s1', '', { db: db as never, now: NOW });
  assert.equal(result.status, 404);
});

test('emits one UTC VEVENT per appointment with padded date maths', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [
    { id: 'a1', date: new Date('2026-08-05T09:05:00Z'), service: { duration: 45 } },
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  const body = (result as { status: 200; body: string }).body;
  assert.match(body, /UID:a1@harbourhair\.co\.uk/);
  assert.match(body, /DTSTART:20260805T090500Z/);
  assert.match(body, /DTEND:20260805T095000Z/);
  assert.match(body, /SUMMARY:Busy/);
});

test('excludes appointments that already ended but keeps in-progress ones', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [
    // Ended 11:00, an hour before NOW — must be dropped.
    { id: 'past', date: new Date('2026-07-21T10:00:00Z'), service: { duration: 60 } },
    // Started 11:30, ends 13:30 — still occupying the chair, must stay.
    { id: 'ongoing', date: new Date('2026-07-21T11:30:00Z'), service: { duration: 120 } },
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  const body = (result as { status: 200; body: string }).body;
  assert.doesNotMatch(body, /UID:past@/);
  assert.match(body, /UID:ongoing@/);
});

test('body is a well-formed CRLF calendar and leaks no customer fields', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [
    { id: 'a1', date: new Date('2026-08-05T09:00:00Z'), service: { duration: 30 } },
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  const body = (result as { status: 200; body: string }).body;
  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(body.trimEnd().endsWith('END:VCALENDAR'));
  // Every newline is CRLF — no bare \n.
  assert.doesNotMatch(body, /[^\r]\n/);
  assert.match(body, /VERSION:2\.0/);
  assert.match(body, /DTSTAMP:20260721T120000Z/);
  // Fixed summary only — never customer names, notes, or emails.
  assert.doesNotMatch(body, /name|email|notes/i);
});

test('queries every non-cancelled appointment for the right stylist', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, []);
  await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(db.findManyCalls.length, 1);
  const where = db.findManyCalls[0].where as {
    stylistId: string;
    status: unknown;
    date: { gte: Date };
  };
  assert.equal(where.stylistId, 's1');
  // Same rule as the website's own availability (booking-service.ts): only a
  // cancellation frees the chair. A COMPLETED booking that has not ended yet
  // still occupies it, so it must stay in the feed or Fresha resells the slot.
  assert.deepEqual(where.status, { not: 'CANCELLED' });
  // Superset cut-off in the query; exact end-time filtering happens in memory.
  assert.ok(where.date.gte instanceof Date);
  assert.ok(where.date.gte < NOW);
});

test('a booking marked completed before it ends keeps blocking the rest of its time', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [
    // Started 11:30, ends 13:30, already marked COMPLETED by staff at 12:00.
    { id: 'finished-early', date: new Date('2026-07-21T11:30:00Z'), service: { duration: 120 }, status: 'COMPLETED' } as FakeAppt,
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  if (result.status === 200) assert.match(result.body, /UID:finished-early@/);
});

test('booked duration remains fixed when the current service duration changes', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [
    { id: 'a1', date: new Date('2026-08-05T09:00:00Z'), durationAtBooking: 90, service: { duration: 30 } } as FakeAppt,
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  if (result.status === 200) assert.match(result.body, /DTEND:20260805T103000Z/);
  assert.equal((db.findManyCalls[0].select as { durationAtBooking?: boolean }).durationAtBooking, true);
});

const block = (externalUid: string, start: string, end: string, extra: Partial<FakeBlock> = {}): FakeBlock => ({
  externalUid, source: 'GOOGLE', stylistId: 's1', start: new Date(start), end: new Date(end), ...extra,
});

test('Google-only busy time is exported with a stable g- UID and its own length', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [], [
    block('abc123', '2026-08-05T09:00:00Z', '2026-08-05T10:30:00Z'),
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  assert.match(result.body, /UID:g-abc123@harbourhair\.co\.uk/);
  assert.match(result.body, /DTSTART:20260805T090000Z/);
  assert.match(result.body, /DTEND:20260805T103000Z/);
  assert.match(result.body, /SUMMARY:Busy/);
});

test('Fresha and Treatwell blocks are NEVER exported (a calendar echo loop)', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [], [
    block('fresha-1', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z', { source: 'FRESHA' }),
    block('tw-1', '2026-08-05T11:00:00Z', '2026-08-05T12:00:00Z', { source: 'TREATWELL' }),
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  assert.doesNotMatch(result.body, /BEGIN:VEVENT/);
  assert.equal(db.blockQueries[0].where.source, 'GOOGLE');
});

test('Google blocks of another stylist, and ones already over, are left out', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, [], [
    block('other', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z', { stylistId: 's2' }),
    block('over', '2026-07-21T09:00:00Z', '2026-07-21T10:00:00Z'),
    block('now', '2026-07-21T11:00:00Z', '2026-07-21T13:00:00Z'),
  ]);
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  assert.doesNotMatch(result.body, /g-other@/);
  assert.doesNotMatch(result.body, /g-over@/);
  assert.match(result.body, /g-now@/);
  assert.deepEqual(db.blockQueries[0].where, { stylistId: 's1', source: 'GOOGLE', end: { gt: NOW } });
});

test('appointments and Google blocks share one feed, ordered by start', async () => {
  const db = fakeDb(
    { id: 's1', icalToken: 'tok' },
    [{ id: 'a1', date: new Date('2026-08-05T12:00:00Z'), service: { duration: 30 } }],
    [block('early', '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z')],
  );
  const result = await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  assert.ok(result.body.indexOf('UID:g-early@') >= 0);
  assert.ok(result.body.indexOf('UID:g-early@') < result.body.indexOf('UID:a1@'));
});
