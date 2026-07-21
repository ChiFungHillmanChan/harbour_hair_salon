import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStylistIcalFeed } from './stylist-ical-feed';

type FakeAppt = { id: string; date: Date; service: { duration: number } };

function fakeDb(
  stylist: { id: string; icalToken: string | null } | null,
  appointments: FakeAppt[] = [],
) {
  const findUniqueCalls: { where: unknown; select: unknown }[] = [];
  const findManyCalls: { where: unknown; select: unknown; orderBy: unknown }[] = [];
  return {
    findUniqueCalls,
    findManyCalls,
    stylist: {
      findUnique: async (args: { where: unknown; select: unknown }) => {
        findUniqueCalls.push(args);
        return stylist;
      },
    },
    appointment: {
      findMany: async (args: { where: unknown; select: unknown; orderBy: unknown }) => {
        findManyCalls.push(args);
        return appointments;
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

test('queries only bookable appointments for the right stylist', async () => {
  const db = fakeDb({ id: 's1', icalToken: 'tok' }, []);
  await buildStylistIcalFeed('s1', 'tok', { db: db as never, now: NOW });
  assert.equal(db.findManyCalls.length, 1);
  const where = db.findManyCalls[0].where as {
    stylistId: string;
    status: { in: string[] };
    date: { gte: Date };
  };
  assert.equal(where.stylistId, 's1');
  assert.deepEqual([...where.status.in].sort(), ['CONFIRMED', 'PENDING']);
  // Superset cut-off in the query; exact end-time filtering happens in memory.
  assert.ok(where.date.gte instanceof Date);
  assert.ok(where.date.gte < NOW);
});
