import test from 'node:test';
import assert from 'node:assert/strict';
import { feedFingerprint, FEED_RETRY_MS, MAX_IMPORT_TICKS_PER_HOUR, MIRROR_RETRY_MS, runFreshaWatch, type FreshaWatchDependencies, type FreshaWatchState } from './fresha-watch';
import type { FreshaMirrorGateway } from './fresha-mirror';
import { GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';

const NOW = Date.parse('2026-11-02T09:00:00Z');

function feed(stamp: string, start = '20261102T110000Z') {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fresha//EN',
    'BEGIN:VEVENT', 'UID:fresha-1', `DTSTAMP:${stamp}`, `DTSTART:${start}`, 'DTEND:20261102T120000Z', 'SUMMARY:Fresha Appointment', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

test('the fingerprint ignores DTSTAMP (Fresha stamps every request) and line endings, and nothing else', () => {
  const base = feedFingerprint(feed('20261102T090000Z'));
  assert.equal(feedFingerprint(feed('20261102T090100Z')), base);
  assert.equal(feedFingerprint(feed('20261102T090000Z').replace(/\r\n/g, '\n')), base);
  assert.equal(feedFingerprint(feed('20261102T090000Z').replace('DTSTAMP:', 'DTSTAMP;VALUE=DATE-TIME:')), base);
  assert.notEqual(feedFingerprint(feed('20261102T090000Z', '20261102T113000Z')), base);
  // A folded DTSTART is the same line once unfolded, and still counts.
  assert.equal(feedFingerprint(feed('x').replace('DTSTART:20261102T110000Z', 'DTSTART:2026110\r\n 2T110000Z')), base);
});

type Calls = { imports: string[]; fetches: string[]; writes: FreshaWatchState[]; google: string[] };

function setup(options: {
  state?: FreshaWatchState | null; feeds?: Record<string, string | Error>; mirror?: boolean;
  importResult?: (id: string) => { ok: boolean; skipped?: 'locked' } | Error; googleError?: GoogleCalendarError;
} = {}) {
  const calls: Calls = { imports: [], fetches: [], writes: [], google: [] };
  const feeds = options.feeds ?? { 'https://fresha.test/a.ics': feed('1'), 'https://fresha.test/b.ics': feed('1') };
  const mirror: FreshaMirrorGateway = {
    listEvents: async () => { if (options.googleError) throw options.googleError; return []; },
    insertEvent: async (event: GoogleEvent) => { calls.google.push(`insert ${event.summary}`); return event; },
    putEvent: async (event: GoogleEvent) => event,
    deleteEvent: async () => undefined,
  };
  const deps: FreshaWatchDependencies = {
    store: {
      read: async () => options.state === undefined ? null : options.state,
      write: async (state) => { calls.writes.push(structuredClone(state)); },
    },
    loadSnapshot: async () => ({
      locale: 'en-GB',
      connections: Object.keys(feeds).map((url, index) => ({ id: `conn-${index}`, stylistName: `Stylist ${index}`, googleColorId: null, inboundUrl: url })),
    }),
    fetchFeed: async (url) => {
      calls.fetches.push(url);
      const value = feeds[url];
      if (value instanceof Error) throw value;
      return value;
    },
    importFeed: async (connectionId) => {
      calls.imports.push(connectionId);
      const outcome = options.importResult?.(connectionId) ?? { ok: true };
      if (outcome instanceof Error) throw outcome;
      return [{ connectionId, stylistId: 's', provider: 'FRESHA', upserted: 1, pruned: 0, ...outcome }];
    },
    mirror: options.mirror ? mirror : null,
    deadline: Infinity,
    now: () => NOW,
  };
  return { deps, calls };
}

const seen = (text: string) => feedFingerprint(text);

test('first run: every feed is imported once and remembered', async () => {
  const { deps, calls } = setup();
  const result = await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, ['conn-0', 'conn-1']);
  assert.deepEqual(result, { checked: 2, changed: 2, imported: 2, mirrored: 0, failed: 0, deferred: 0 });
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].feeds['conn-0'].imported, seen(feed('1')));
});

test('an unchanged minute imports nothing and writes no state (no database wake)', async () => {
  const fingerprint = seen(feed('1'));
  const { deps, calls } = setup({
    state: { feeds: { 'conn-0': { imported: fingerprint }, 'conn-1': { imported: fingerprint } }, importTicks: [] },
    feeds: { 'https://fresha.test/a.ics': feed('2'), 'https://fresha.test/b.ics': feed('3') },
  });
  const result = await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, []);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(result, { checked: 2, changed: 0, imported: 0, mirrored: 0, failed: 0, deferred: 0 });
});

test('only the feed that changed is imported', async () => {
  const fingerprint = seen(feed('1'));
  const { deps, calls } = setup({
    state: { feeds: { 'conn-0': { imported: fingerprint }, 'conn-1': { imported: fingerprint } }, importTicks: [] },
    feeds: { 'https://fresha.test/a.ics': feed('1'), 'https://fresha.test/b.ics': feed('1', '20261102T100000Z') },
  });
  await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, ['conn-1']);
});

test('without its state the watch does nothing at all', async () => {
  const { deps, calls } = setup();
  deps.store.read = async () => { throw new Error('redis down'); };
  let snapshotRead = false;
  deps.loadSnapshot = async () => { snapshotRead = true; return { locale: 'en-GB', connections: [] }; };
  assert.equal((await runFreshaWatch(deps)).skipped, 'state-unavailable');
  assert.equal(snapshotRead, false, 'the feed list (a possible database read) must not be loaded');
  assert.deepEqual(calls.fetches, []);
});

test('a feed that cannot be fetched waits FEED_RETRY_MS and is not imported', async () => {
  const { deps, calls } = setup({ feeds: { 'https://fresha.test/a.ics': new Error('timeout') } });
  const result = await runFreshaWatch(deps);
  assert.equal(result.failed, 1);
  assert.deepEqual(calls.imports, []);
  assert.equal(calls.writes[0].feeds['conn-0'].feedRetryAt, NOW + FEED_RETRY_MS);

  const waiting = setup({ state: { feeds: { 'conn-0': { feedRetryAt: NOW + 1 } }, importTicks: [] } });
  await runFreshaWatch(waiting.deps);
  assert.deepEqual(waiting.calls.fetches, ['https://fresha.test/b.ics']);
});

test('a failed import is remembered anyway: each attempt wakes Neon, and the half-hourly import retries', async () => {
  for (const outcome of [{ ok: false }, new Error('database unreachable')]) {
    const { deps, calls } = setup({ importResult: () => outcome });
    const result = await runFreshaWatch(deps);
    assert.equal(result.failed, 2);
    assert.equal(calls.writes[0].feeds['conn-0'].imported, seen(feed('1')));
  }
});

test('an import that found the lease taken is tried again next minute', async () => {
  const { deps, calls } = setup({ importResult: () => ({ ok: true, skipped: 'locked' }) });
  await runFreshaWatch(deps);
  assert.equal(calls.writes[0].feeds['conn-0'].imported, undefined);
  // Asking for the lease reached the database, so the tick still counts against the budget.
  assert.deepEqual(calls.writes[0].importTicks, [NOW]);
});

test('a removed connection\'s entry is dropped', async () => {
  const { deps, calls } = setup({ state: { feeds: { 'conn-0': { imported: seen(feed('1')) }, 'conn-1': { imported: seen(feed('1')) }, 'conn-old': { imported: seen(feed('1')) } }, importTicks: [] } });
  await runFreshaWatch(deps);
  assert.deepEqual(Object.keys(calls.writes[0].feeds).sort(), ['conn-0', 'conn-1']);
});

test('with the mirror on, a changed feed is also copied to Google, and remembered when complete', async () => {
  const { deps, calls } = setup({ mirror: true });
  const result = await runFreshaWatch(deps);
  assert.equal(result.mirrored, 2);
  assert.deepEqual(calls.google, ['insert Stylist 0 · Fresha booking', 'insert Stylist 1 · Fresha booking']);
  assert.equal(calls.writes[0].feeds['conn-0'].mirrored, seen(feed('1')));
});

test('a mirror behind the import catches up without importing again', async () => {
  const fingerprint = seen(feed('1'));
  const { deps, calls } = setup({ mirror: true, state: { feeds: { 'conn-0': { imported: fingerprint }, 'conn-1': { imported: fingerprint, mirrored: fingerprint } }, importTicks: [] } });
  await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, []);
  assert.deepEqual(calls.google, ['insert Stylist 0 · Fresha booking']);
});

test('a Google hiccup is retried next minute; a refusal only after MIRROR_RETRY_MS', async () => {
  const hiccup = setup({ mirror: true, googleError: new GoogleCalendarError('retryable', 503) });
  await runFreshaWatch(hiccup.deps);
  assert.equal(hiccup.calls.writes[0].feeds['conn-0'].mirrored, undefined);
  assert.equal(hiccup.calls.writes[0].feeds['conn-0'].mirrorRetryAt, undefined);

  const refused = setup({ mirror: true, googleError: new GoogleCalendarError('not_found', 404) });
  await runFreshaWatch(refused.deps);
  assert.equal(refused.calls.writes[0].feeds['conn-0'].mirrorRetryAt, NOW + MIRROR_RETRY_MS);
});

test('an unreadable feed is not mirrored: the copy keeps its last good state', async () => {
  const broken = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VCALENDAR';
  const { deps, calls } = setup({ mirror: true, feeds: { 'https://fresha.test/a.ics': broken } });
  await runFreshaWatch(deps);
  assert.deepEqual(calls.google, []);
  assert.equal(calls.writes[0].feeds['conn-0'].mirrored, seen(broken));
});

test('past the deadline no import starts', async () => {
  const { deps, calls } = setup();
  deps.deadline = NOW - 1;
  await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, []);
});

test('one tick that imports spends one unit of the hourly budget, however many feeds it imports', async () => {
  const { deps, calls } = setup({ state: { feeds: {}, importTicks: [NOW - 61 * 60_000, NOW - 10 * 60_000] } });
  await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, ['conn-0', 'conn-1']);
  // The tick over an hour old is dropped; this one is added.
  assert.deepEqual(calls.writes[0].importTicks, [NOW - 10 * 60_000, NOW]);
});

test('a feed that changes every minute cannot pin Neon: past the hourly budget nothing is imported', async () => {
  const spent = Array.from({ length: MAX_IMPORT_TICKS_PER_HOUR }, (_, index) => NOW - (index + 1) * 60_000);
  const { deps, calls } = setup({ mirror: true, state: { feeds: {}, importTicks: spent } });
  const result = await runFreshaWatch(deps);
  assert.deepEqual(calls.imports, []);
  assert.equal(result.deferred, 2);
  // Not recorded as imported, so the first tick the budget allows imports it; the mirror (no Neon) still runs.
  assert.equal(calls.writes[0].feeds['conn-0'].imported, undefined);
  assert.equal(calls.writes[0].feeds['conn-0'].mirrored, seen(feed('1')));
  assert.equal(calls.writes[0].importTicks.length, MAX_IMPORT_TICKS_PER_HOUR);
});
