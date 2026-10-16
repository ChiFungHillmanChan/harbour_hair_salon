import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadServerModule } from '../../../../test/load-server-module';
import { channelToken } from '../../../lib/google-channel-token';

// POST /api/webhooks/google-calendar (task G7 of
// docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md). Google
// calls it for every change on the salon calendar — a public endpoint
// something external calls — so every refusal comes before the database, and
// the pull runs after the answer has gone.

const CONFIG = { calendarId: 'cal@group.calendar.google.com', clientEmail: 'sa@harbour.iam.gserviceaccount.com', privateKey: 'k', webhookSecret: 'webhook-secret' };

function harness(options: { config?: typeof CONFIG | null } = {}) {
  const deferred: (() => Promise<void>)[] = [];
  const counts = { databaseOpened: 0, singleFlights: 0, pulls: 0, pushes: 0 };
  const route = loadServerModule<typeof import('./route')>('src/app/api/webhooks/google-calendar/route.ts', {
    'next/server': { after: (callback: () => Promise<void>) => { deferred.push(callback); } },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => (options.config === undefined ? CONFIG : options.config) },
    // Counted: nothing in the answer path may open the database.
    '@/app/lib/prisma': { __esModule: true, get default() { counts.databaseOpened++; return {}; } },
    '@/app/services/google-calendar-channel': {
      runPullSingleFlight: async (pull: () => Promise<unknown>) => { counts.singleFlights++; await pull(); },
    },
    '@/app/services/google-calendar-pull': {
      pullGoogleCalendar: async (...args: unknown[]) => { assert.deepEqual(args, [], 'the default client and clock'); counts.pulls++; return { reverted: 0, blocks: 0, changed: false }; },
    },
    // Never reached: a push from here would close a loop (push → notification → pull → push).
    '@/app/services/google-calendar-push': { pushGoogleCalendar: async () => { counts.pushes++; } },
  });
  const post = (headers: Record<string, string>) => route.POST(new Request('https://www.harbourhair.co.uk/api/webhooks/google-calendar', { method: 'POST', headers }));
  return {
    post, deferred, counts,
    /** What `after()` was given, run as Next does once the answer has gone. */
    runAfter: async () => { while (deferred.length) await deferred.shift()!(); },
  };
}

const notification = (state: string, channelId = 'channel-1', token = channelToken(CONFIG.webhookSecret, channelId)) => ({
  'X-Goog-Channel-ID': channelId,
  'X-Goog-Channel-Token': token,
  'X-Goog-Resource-State': state,
  'X-Goog-Resource-ID': 'resource-1',
  'X-Goog-Message-Number': '2',
});

async function assertEmpty(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(await response.text(), '', 'nothing is echoed');
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

test('the route is a dynamic Node.js function', async () => {
  const route = await import('./route');
  assert.equal(route.runtime, 'nodejs');
  assert.equal(route.dynamic, 'force-dynamic');
  assert.ok(route.maxDuration >= 60, 'room for a pull and its re-run after the answer');
});

test('sync switched off: 404, with nothing scheduled and the database never opened', async () => {
  const h = harness({ config: null });
  await assertEmpty(await h.post(notification('exists')), 404);
  assert.equal(h.deferred.length, 0);
  assert.equal(h.counts.databaseOpened, 0);
});

test('a missing or wrong channel token is refused with 401 before anything is opened', async () => {
  const h = harness();
  const good = notification('exists');
  const cases: Record<string, string>[] = [
    {},
    { 'X-Goog-Resource-State': 'exists' },
    { ...good, 'X-Goog-Channel-Token': '' },
    { 'X-Goog-Channel-Token': good['X-Goog-Channel-Token'], 'X-Goog-Resource-State': 'exists' },
    { 'X-Goog-Channel-ID': 'channel-1', 'X-Goog-Resource-State': 'exists' },
    notification('exists', 'channel-1', channelToken('another-secret', 'channel-1')),
    notification('exists', 'channel-2', channelToken(CONFIG.webhookSecret, 'channel-1')),
    notification('exists', 'channel-1', 'not-a-token'),
  ];
  for (const headers of cases) await assertEmpty(await h.post(headers), 401);
  assert.equal(h.deferred.length, 0);
  assert.equal(h.counts.databaseOpened, 0);
});

test('the sync handshake when a channel is created is acknowledged with no work', async () => {
  const h = harness();
  await assertEmpty(await h.post(notification('sync')), 200);
  assert.equal(h.deferred.length, 0);
  assert.equal(h.counts.databaseOpened, 0);
});

test('a change notification is answered at once; one single-flight pull runs after the answer', async () => {
  for (const state of ['exists', 'not_exists']) {
    const h = harness();
    await assertEmpty(await h.post(notification(state)), 200);
    assert.equal(h.deferred.length, 1, state);
    assert.equal(h.counts.pulls, 0, 'nothing ran before the answer');
    assert.equal(h.counts.databaseOpened, 0);
    await h.runAfter();
    assert.deepEqual({ singleFlights: h.counts.singleFlights, pulls: h.counts.pulls }, { singleFlights: 1, pulls: 1 });
    assert.equal(h.counts.pushes, 0, 'only a pull, never a push');
  }
});

test('the notification path never pushes to Google: route, lock and pull never name the push', () => {
  // Webhook → push → Google notification → pull → push… would never end.
  for (const file of [
    'src/app/api/webhooks/google-calendar/route.ts',
    'src/app/services/google-calendar-channel.ts',
    'src/app/services/google-calendar-pull.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /pushGoogleCalendar/, file);
  }
  const route = readFileSync('src/app/api/webhooks/google-calendar/route.ts', 'utf8');
  assert.doesNotMatch(route, /google-calendar-push/, 'the route does not even import the push module');
  const channel = readFileSync('src/app/services/google-calendar-channel.ts', 'utf8');
  assert.doesNotMatch(channel, /google-calendar-push/, 'nor does the lock and channel module');
});

test('a failing pull after the answer is logged, never thrown into the runtime', async (t) => {
  const deferred: (() => Promise<void>)[] = [];
  const errors = t.mock.method(console, 'error', () => undefined);
  const route = loadServerModule<typeof import('./route')>('src/app/api/webhooks/google-calendar/route.ts', {
    'next/server': { after: (callback: () => Promise<void>) => { deferred.push(callback); } },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => CONFIG },
    '@/app/services/google-calendar-channel': { runPullSingleFlight: async () => { throw new Error('redis and database down'); } },
    '@/app/services/google-calendar-pull': { pullGoogleCalendar: async () => ({}) },
  });
  const response = await route.POST(new Request('https://www.harbourhair.co.uk/api/webhooks/google-calendar', { method: 'POST', headers: notification('exists') }));
  assert.equal(response.status, 200);
  await deferred[0]();
  assert.equal(errors.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(errors.mock.calls[0].arguments), /redis and database down/, 'names and codes only');
});
