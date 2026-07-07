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
  const findManyCalls: { where: unknown; select: unknown }[] = [];
  return {
    upserts,
    prunes,
    findManyCalls,
    stylist: {
      // NOTE: this fake still filters in-memory by `treatwellIcalUrl` truthiness
      // (so the other tests' fixtures behave as expected) rather than by
      // interpreting the captured `where` — capturing it separately is what
      // makes the filter assertion below mutation-proof: it fails if the
      // production `where` clause is dropped or changed, independent of the
      // fake's own filtering behaviour.
      findMany: async (args: { where: unknown; select: unknown }) => {
        findManyCalls.push(args);
        return stylists.filter((s) => s.treatwellIcalUrl);
      },
    },
    externalBusyBlock: {
      upsert: async (a: unknown) => { upserts.push(a); },
      deleteMany: async (a: unknown) => { prunes.push(a); return { count: 0 }; },
    },
  };
}

function fakeResp(ok: boolean, status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
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

test('does NOT prune when the feed returns garbage with HTTP 200 (wipe guard)', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  const res = await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    // A login/maintenance HTML page served with 200 — must NOT be read as "empty".
    fetchImpl: (async () => fakeResp(true, 200, '<html><body>Sign in</body></html>')) as never,
  });
  assert.equal(res[0].ok, false);
  assert.match(res[0].error ?? '', /invalid/);
  assert.equal(db.upserts.length, 0);
  assert.equal(db.prunes.length, 0); // preserved last-known blocks
});

test('rejects an oversized feed (by content-length) without pruning', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  const res = await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    fetchImpl: (async () =>
      fakeResp(true, 200, ICS, { 'content-length': String(10 * 1024 * 1024) })) as never,
  });
  assert.equal(res[0].ok, false);
  assert.match(res[0].error ?? '', /too large/);
  assert.equal(db.prunes.length, 0);
});

test('queries stylists with the treatwellIcalUrl: { not: null } filter', async () => {
  const db = fakeDb([{ id: 's1', treatwellIcalUrl: 'https://tw/s1.ics' }]);
  await syncTreatwellFeeds({
    db: db as never,
    now: new Date('2026-06-01T00:00:00Z'),
    fetchImpl: (async () => fakeResp(true, 200, ICS)) as never,
  });
  assert.equal(db.findManyCalls.length, 1);
  // Mutation-proof: if the production `where` filter is dropped or weakened
  // (e.g. changed to `{}` or the `not: null` removed), this deepEqual fails —
  // regardless of how the fake happens to filter its own fixture data.
  assert.deepEqual(db.findManyCalls[0], {
    where: { treatwellIcalUrl: { not: null } },
    select: { id: true, treatwellIcalUrl: true },
  });
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
