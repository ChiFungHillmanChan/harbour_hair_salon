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
