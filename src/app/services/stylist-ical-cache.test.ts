import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

// The busy-feed cache helpers also start the Google Calendar push (task G8 of
// docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md, spec §5
// "Real time"): a Server Action that changed a booking schedules one push after
// its response, and nothing at all while the sync is off. The cron variant never
// pushes: the pull calls it, and a push from there would close a loop
// (push → Google notification → pull → push).

const CONFIG = { calendarId: 'cal@group.calendar.google.com', clientEmail: 'sa@harbour.iam.gserviceaccount.com', privateKey: 'k', webhookSecret: 's' };

function harness(options: { enabled?: boolean; afterThrows?: boolean; pushThrows?: boolean } = {}) {
  const deferred: (() => Promise<void>)[] = [];
  const tags: string[] = [];
  const pushes: unknown[] = [];
  const counts = { pushImports: 0, configReads: 0 };
  const cache = loadServerModule<typeof import('./stylist-ical-cache')>('src/app/services/stylist-ical-cache.ts', {
    'next/cache': {
      unstable_cache: (callback: unknown) => callback,
      updateTag: (tag: string) => { tags.push(`update:${tag}`); },
      revalidateTag: (tag: string) => { tags.push(`revalidate:${tag}`); },
    },
    'next/server': {
      after: (callback: () => Promise<void>) => {
        if (options.afterThrows) throw new Error('`after` was called outside a request scope');
        deferred.push(callback);
      },
    },
    './stylist-ical-feed': {},
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => { counts.configReads++; return options.enabled === false ? null : CONFIG; } },
    './google-calendar-push': {
      get pushGoogleCalendar() {
        counts.pushImports++;
        return async (input: unknown) => {
          pushes.push(input);
          if (options.pushThrows) throw new Error('database unavailable at db.internal:5432');
          return { written: 1, deleted: 0, unchanged: 0, failed: 0 };
        };
      },
    },
  });
  return {
    cache, deferred, tags, pushes, counts,
    /** Runs what `after()` was given, as Next does once the response has gone. */
    runAfter: async () => { while (deferred.length) await deferred.shift()!(); },
  };
}

test('a booking change drops the busy feed and schedules exactly one recent push after the response', async () => {
  const h = harness();
  h.cache.invalidateStylistIcalFeed();
  assert.deepEqual(h.tags, ['update:stylist-ical-feed']);
  assert.equal(h.deferred.length, 1, 'one push scheduled');
  assert.deepEqual(h.pushes, [], 'nothing runs before the response');
  await h.runAfter();
  assert.deepEqual(h.pushes, [{ mode: 'recent' }]);
});

test('with the Google sync off a booking change schedules nothing and never loads the push', async () => {
  const h = harness({ enabled: false });
  h.cache.invalidateStylistIcalFeed();
  h.cache.scheduleGoogleCalendarPush();
  h.cache.scheduleGoogleCalendarPush(['appt-1']);
  assert.deepEqual(h.tags, ['update:stylist-ical-feed'], 'the feed still drops');
  assert.equal(h.deferred.length, 0);
  assert.equal(h.counts.pushImports, 0);
});

test('the cron variant never schedules a push, even with the sync on', async () => {
  const h = harness();
  h.cache.invalidateStylistIcalFeedFromCron();
  assert.deepEqual(h.tags, ['revalidate:stylist-ical-feed']);
  assert.equal(h.deferred.length, 0);
  assert.equal(h.counts.configReads, 0, 'not even the configuration is read');
  assert.equal(h.counts.pushImports, 0);
});

test('a text-only change pushes the named bookings (reaching past the window), or the recent ones without names', async () => {
  const h = harness();
  h.cache.scheduleGoogleCalendarPush(['appt-1', 'appt-2']);
  h.cache.scheduleGoogleCalendarPush();
  assert.equal(h.deferred.length, 2);
  assert.deepEqual(h.tags, [], 'the busy feed is untouched: no time changed');
  await h.runAfter();
  assert.deepEqual(h.pushes, [{ appointmentIds: ['appt-1', 'appt-2'] }, { mode: 'recent' }]);
});

test('an empty list of bookings schedules nothing', () => {
  const h = harness();
  h.cache.scheduleGoogleCalendarPush([]);
  assert.equal(h.deferred.length, 0);
});

test('the ids are copied when scheduled: a caller changing its array later does not change the push', async () => {
  const h = harness();
  const ids = ['appt-1'];
  h.cache.scheduleGoogleCalendarPush(ids);
  ids.push('appt-2');
  await h.runAfter();
  assert.deepEqual(h.pushes, [{ appointmentIds: ['appt-1'] }]);
});

test('a push that fails after the response is logged without its message, never thrown', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const h = harness({ pushThrows: true });
  h.cache.invalidateStylistIcalFeed();
  await h.runAfter();
  assert.equal(logged.length, 1);
  assert.doesNotMatch(JSON.stringify(logged), /db\.internal/, 'a driver message can quote the host');
});

test('outside a request (a script) the booking change still succeeds; the next calendar sync pushes instead', (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const h = harness({ afterThrows: true });
  assert.doesNotThrow(() => h.cache.invalidateStylistIcalFeed());
  assert.doesNotThrow(() => h.cache.scheduleGoogleCalendarPush(['appt-1']));
  assert.deepEqual(h.tags, ['update:stylist-ical-feed']);
  assert.equal(logged.length, 2);
});

test('a feed request with no token is refused before any database read', async () => {
  const lookups: string[] = [];
  const cache = loadServerModule<typeof import('./stylist-ical-cache')>('src/app/services/stylist-ical-cache.ts', {
    'next/cache': { unstable_cache: (callback: unknown) => callback, updateTag: () => {}, revalidateTag: () => {} },
    'next/server': { after: () => {} },
    './stylist-ical-feed': {
      loadStylistToken: async (stylistId: string) => { lookups.push(stylistId); return 'right-token'; },
      loadBusyEvents: async () => [],
      renderIcalFeed: () => 'BEGIN:VCALENDAR',
      tokenMatches: (supplied: string, stored: string | null) => Boolean(supplied) && supplied === stored,
    },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => null },
  });

  assert.deepEqual(await cache.buildCachedStylistIcalFeed('made-up-id', ''), { status: 404 });
  assert.deepEqual(lookups, [], 'a tokenless probe never reaches the token lookup');
  assert.equal((await cache.buildCachedStylistIcalFeed('stylist-1', 'right-token')).status, 200, 'a real poller still gets its feed');
  assert.deepEqual(lookups, ['stylist-1']);
});


// Treatwell's view (2026-11-03) reads Fresha's time from its OWN entry, so a
// Fresha import never empties the entry Fresha's feed is served from, and only
// a changed Fresha import (calendar-sync-service.ts) drops it.
function viewHarness() {
  const reads: string[] = [];
  const entries: { keyParts: string[]; tags: string[]; revalidate: number }[] = [];
  const revalidated: { tag: string; profile: unknown }[] = [];
  const deferred: unknown[] = [];
  const cache = loadServerModule<typeof import('./stylist-ical-cache')>('src/app/services/stylist-ical-cache.ts', {
    'next/cache': {
      unstable_cache: (callback: unknown, keyParts: string[], options: { tags: string[]; revalidate: number }) => {
        entries.push({ keyParts, tags: options.tags, revalidate: options.revalidate });
        return callback;
      },
      updateTag: () => {},
      revalidateTag: (tag: string, profile: unknown) => { revalidated.push({ tag, profile }); },
    },
    'next/server': { after: (callback: unknown) => { deferred.push(callback); } },
    './stylist-ical-feed': {
      loadStylistToken: async () => 'right-token',
      loadBusyEvents: async () => { reads.push('website'); return [{ id: 'a1', startMs: 2, minutes: 30 }]; },
      loadFreshaBusyEvents: async () => { reads.push('fresha'); return [{ id: 'f-1', startMs: 1, minutes: 60 }]; },
      mergeBusyEvents: (...lists: { startMs: number }[][]) => lists.flat().sort((a, b) => a.startMs - b.startMs),
      renderIcalFeed: (events: { id: string }[]) => events.map((event) => event.id).join(','),
      tokenMatches: (supplied: string, stored: string | null) => Boolean(supplied) && supplied === stored,
    },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => CONFIG },
  });
  return { cache, reads, entries, revalidated, deferred };
}

test('Fresha\'s feed never reads Fresha time; Treatwell\'s adds it in start order', async () => {
  const h = viewHarness();
  assert.deepEqual(await h.cache.buildCachedStylistIcalFeed('stylist-1', 'right-token'), { status: 200, body: 'a1' });
  assert.deepEqual(h.reads, ['website']);
  h.reads.length = 0;
  assert.deepEqual(await h.cache.buildCachedStylistIcalFeed('stylist-1', 'right-token', new Date(), 'treatwell'), { status: 200, body: 'f-1,a1' });
  assert.deepEqual(h.reads.sort(), ['fresha', 'website']);
  h.reads.length = 0;
  assert.deepEqual(await h.cache.buildCachedStylistIcalFeed('stylist-1', 'wrong', new Date(), 'treatwell'), { status: 404 });
  assert.deepEqual(h.reads, [], 'a wrong token reads no busy time in either view');
});

test('Fresha time has its own cache entry, kept a day like the others', () => {
  const h = viewHarness();
  const fresha = h.entries.find((entry) => entry.tags.includes('stylist-ical-fresha'));
  assert.ok(fresha);
  assert.equal(fresha.revalidate, h.cache.EVENTS_REVALIDATE_SECONDS);
  assert.ok(h.cache.EVENTS_REVALIDATE_SECONDS >= 24 * 60 * 60, 'a timed expiry is a poll: keep it a day or more');
  const website = h.entries.find((entry) => entry.tags.includes('stylist-ical-feed'));
  assert.ok(website && !website.tags.includes('stylist-ical-fresha'), 'a Fresha import must not empty Fresha\'s own feed entry');
});

test('dropping Treatwell\'s Fresha time expires only that entry, at once, and never pushes to Google', () => {
  const h = viewHarness();
  h.cache.invalidateTreatwellFreshaBusy();
  assert.deepEqual(h.revalidated, [{ tag: 'stylist-ical-fresha', profile: { expire: 0 } }]);
  assert.equal(h.deferred.length, 0);
});
