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

function fakeResp(ok: boolean, status: number, body: string) {
  return { ok, status, text: async () => body } as unknown as Response;
}

test('upserts parsed events and prunes stale uids on success', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  const res = await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    fetchImpl: (async () => fakeResp(true, 200, ICS)) as never,
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
    fetchImpl: (async () => fakeResp(false, 503, 'down')) as never,
  });
  assert.equal(res[0].ok, false);
  assert.match(res[0].error ?? '', /503/);
  assert.equal(db.upserts.length, 0);
  assert.equal(db.prunes.length, 0); // preserved last-known blocks
});

test('does NOT prune when fetch throws (network error)', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  const res = await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as never,
  });
  assert.equal(res[0].ok, false);
  assert.match(res[0].error ?? '', /ECONNRESET/);
  assert.equal(db.prunes.length, 0);
});

test('no stylists with a feed URL → empty result, no fetch', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: null }]);
  let fetched = false;
  const res = await syncTreatwellFeeds({
    db: db as never,
    fetchImpl: (async () => { fetched = true; return fakeResp(true, 200, ICS); }) as never,
  });
  assert.deepEqual(res, []);
  assert.equal(fetched, false);
});
