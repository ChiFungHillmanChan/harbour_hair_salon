import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { loadServerModule } from '../../test/load-server-module';
import { channelToken, channelTokenMatches } from '../lib/google-channel-token';
import { SITE_URL } from '../lib/site-url';
import { GoogleCalendarError } from './google-calendar-gateway';

// Task G7 of docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md:
// the push channel Google notifies the webhook through, and the single-flight
// pull a burst of those notifications runs.

const NOW = new Date('2099-09-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60_000;
const CONFIG = { calendarId: 'cal@group.calendar.google.com', clientEmail: 'sa@harbour.iam.gserviceaccount.com', privateKey: 'k', webhookSecret: 'webhook-secret' };
const ADDRESS = `${SITE_URL}/api/webhooks/google-calendar`;

type State = { id: string; channelId: string | null; resourceId: string | null; channelExpiresAt: Date | null; busyHash: string | null };
type Call =
  | { op: 'watch'; id: string; token: string; address: string; expiration: Date }
  | { op: 'stop'; id: string; resourceId: string };

/** Any property read throws: proves nothing touched the database. */
const untouchable = new Proxy({}, { get(_target, key) { throw new Error(`database touched: ${String(key)}`); } });

function load(config: typeof CONFIG | null = CONFIG) {
  return loadServerModule<typeof import('./google-calendar-channel')>('src/app/services/google-calendar-channel.ts', {
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => config },
    '@/app/lib/prisma': untouchable,
  });
}

const blank = (id: string): State => ({ id, channelId: null, resourceId: null, channelExpiresAt: null, busyHash: null });

/** The singleton row as Prisma treats it: a conditional updateMany, and a create that a second writer loses. */
function fakeDb(state: State | null, options: { failWrite?: boolean } = {}) {
  const store = { state, writes: 0 };
  const db = {
    googleCalendarSyncState: {
      async findUnique({ where }: { where: { id: string } }) {
        return store.state && store.state.id === where.id ? { ...store.state } : null;
      },
      async updateMany({ where, data }: { where: { id: string; channelId: string | null }; data: Partial<State> }) {
        if (options.failWrite) throw new Error('database unavailable');
        if (!store.state || store.state.id !== where.id || store.state.channelId !== where.channelId) return { count: 0 };
        store.writes += 1;
        store.state = { ...store.state, ...data };
        return { count: 1 };
      },
      async create({ data }: { data: Partial<State> & { id: string } }) {
        if (options.failWrite) throw new Error('database unavailable');
        if (store.state) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        store.writes += 1;
        store.state = { ...blank(data.id), ...data };
        return store.state;
      },
    },
  };
  return { db, store };
}

/** Google's channel API, recording each call in order. */
function fakeGoogle(options: {
  grantedExpiration?: (asked: Date) => Date; failWatch?: boolean; failStop?: boolean;
  /** Runs while Google creates the channel: another writer acting in between. */
  duringWatch?: () => Promise<void> | void;
} = {}) {
  const calls: Call[] = [];
  let created = 0;
  const gateway = {
    async watch(channel: { id: string; token: string; address: string; expiration: Date }) {
      calls.push({ op: 'watch', ...channel });
      if (options.failWatch) throw new GoogleCalendarError('retryable', 503);
      await options.duringWatch?.();
      created += 1;
      return { resourceId: `resource-${created}`, expiration: options.grantedExpiration?.(channel.expiration) ?? channel.expiration };
    },
    async stopChannel(channel: { id: string; resourceId: string }) {
      calls.push({ op: 'stop', ...channel });
      if (options.failStop) throw new GoogleCalendarError('retryable', 503);
    },
  };
  return { gateway, calls };
}

const existing = (expiresInMs: number): State => ({
  id: 'singleton', channelId: 'old-channel', resourceId: 'old-resource', channelExpiresAt: new Date(NOW.getTime() + expiresInMs), busyHash: 'h',
});

test('sync switched off: disabled, without reading the database or calling Google', async () => {
  const channel = load(null);
  const google = fakeGoogle();
  assert.equal(await channel.ensureGoogleWatchChannel({ db: untouchable as never, gateway: google.gateway, now: NOW }), 'disabled');
  // Without an injected client the default one is never imported either.
  assert.equal(await channel.ensureGoogleWatchChannel({ gateway: google.gateway, now: NOW }), 'disabled');
  assert.deepEqual(google.calls, []);
});

test('no channel yet: one is created at the webhook address with a signed, expiring token, and what Google grants is stored', async () => {
  const channel = load();
  // Google may grant less than the seven days asked for.
  const google = fakeGoogle({ grantedExpiration: () => new Date(NOW.getTime() + 6 * DAY_MS) });
  const { db, store } = fakeDb(null);
  assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'created');
  assert.equal(google.calls.length, 1);
  const watch = google.calls[0];
  assert.equal(watch.op, 'watch');
  if (watch.op !== 'watch') return;
  assert.equal(watch.address, ADDRESS);
  assert.equal(watch.address, 'https://www.harbourhair.co.uk/api/webhooks/google-calendar');
  assert.match(watch.id, /^[A-Za-z0-9_-]{1,64}$/, 'a channel id Google accepts');
  assert.equal(watch.expiration.getTime(), NOW.getTime() + 7 * DAY_MS);
  // The token lives as long as the channel asked for, plus an hour for clock skew.
  assert.equal(watch.token, channelToken(CONFIG.webhookSecret, watch.id, new Date(NOW.getTime() + 7 * DAY_MS + 3600_000)));
  assert.equal(channelTokenMatches(CONFIG.webhookSecret, watch.id, watch.token, NOW), true);
  assert.equal(channelTokenMatches(CONFIG.webhookSecret, watch.id, watch.token, new Date(NOW.getTime() + 7 * DAY_MS + 3600_000)), false);
  assert.deepEqual(store.state, {
    id: 'singleton', channelId: watch.id, resourceId: 'resource-1', channelExpiresAt: new Date(NOW.getTime() + 6 * DAY_MS), busyHash: null,
  });
});

test('a state row without a channel (the pull wrote it first) gets one created', async () => {
  const channel = load();
  const google = fakeGoogle();
  const { db, store } = fakeDb({ id: 'singleton', channelId: null, resourceId: null, channelExpiresAt: null, busyHash: 'h' });
  assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'created');
  assert.deepEqual(google.calls.map((call) => call.op), ['watch']);
  assert.equal(store.state?.resourceId, 'resource-1');
  assert.equal(store.state?.busyHash, 'h', 'the busy-time hash is kept');
});

test('a channel with more than 48 hours left is current: no Google call, no write', async () => {
  const channel = load();
  const google = fakeGoogle();
  const { db, store } = fakeDb(existing(5 * DAY_MS));
  assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'current');
  assert.deepEqual(google.calls, []);
  assert.equal(store.writes, 0);
});

test('a channel expiring within 48 hours is replaced: the new one first, then the old one stopped', async () => {
  const channel = load();
  const google = fakeGoogle();
  const { db, store } = fakeDb(existing(DAY_MS));
  assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'renewed');
  assert.deepEqual(google.calls.map((call) => call.op), ['watch', 'stop']);
  assert.deepEqual(google.calls[1], { op: 'stop', id: 'old-channel', resourceId: 'old-resource' });
  const watch = google.calls[0];
  assert.equal(store.state?.channelId, watch.id);
  assert.notEqual(watch.id, 'old-channel');
  assert.equal(store.state?.resourceId, 'resource-1');
  assert.equal(store.state?.channelExpiresAt?.getTime(), NOW.getTime() + 7 * DAY_MS);
});

test('an expired channel is replaced, and renew forces a current one to be replaced', async () => {
  const channel = load();
  for (const [state, renew] of [[existing(-DAY_MS), false], [existing(5 * DAY_MS), true]] as const) {
    const google = fakeGoogle();
    const { db, store } = fakeDb(state);
    assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW, renew }), 'renewed');
    assert.deepEqual(google.calls.map((call) => call.op), ['watch', 'stop']);
    assert.equal(store.state?.channelId, google.calls[0].id);
  }
});

test('the old channel failing to stop does not undo the renewal', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const channel = load();
  const google = fakeGoogle({ failStop: true });
  const { db, store } = fakeDb(existing(DAY_MS));
  assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'renewed');
  assert.equal(store.state?.channelId, google.calls[0].id);
});

test('Google refusing the new channel throws, keeps the old one and stops nothing', async () => {
  const channel = load();
  const google = fakeGoogle({ failWatch: true });
  const { db, store } = fakeDb(existing(DAY_MS));
  await assert.rejects(channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), GoogleCalendarError);
  assert.deepEqual(google.calls.map((call) => call.op), ['watch']);
  assert.equal(store.state?.channelId, 'old-channel');
  assert.equal(store.writes, 0);
});

test('a new channel that cannot be recorded is stopped again, so no unknown channel keeps notifying', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const channel = load();
  const google = fakeGoogle();
  const { db } = fakeDb(existing(DAY_MS), { failWrite: true });
  await assert.rejects(channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), /database unavailable/);
  const watch = google.calls[0];
  assert.deepEqual(google.calls.slice(1), [{ op: 'stop', id: watch.id, resourceId: 'resource-1' }], 'the new one, not the old one');
});

test('two renewals at once leave one recorded channel: the loser stops the channel it just created', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const channel = load();
  const { db, store } = fakeDb(existing(DAY_MS));
  // Both read the old channel before either has recorded a new one.
  let arrived = 0;
  let release!: () => void;
  const bothCreating = new Promise<void>((resolve) => { release = resolve; });
  const google = fakeGoogle({ duringWatch: async () => { if (++arrived === 2) release(); await bothCreating; } });
  const results = await Promise.all([1, 2].map(() => channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW })));
  assert.deepEqual([...results].sort(), ['current', 'renewed']);
  const created = google.calls.filter((call) => call.op === 'watch').map((call) => call.id);
  const stopped = google.calls.filter((call) => call.op === 'stop').map((call) => call.id);
  assert.equal(created.length, 2);
  const winner = store.state?.channelId;
  assert.ok(winner && created.includes(winner));
  const loser = created.find((id) => id !== winner);
  assert.deepEqual([...stopped].sort(), [loser, 'old-channel'].sort(), 'the stray new channel and the old one, once each');
  assert.equal(store.writes, 1);
});

test('the first channel: a create raced by another channel loses; one raced by the pull creating the row is recorded', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const channel = load();
  // Another caller recorded its channel while Google created this one.
  {
    const { db, store } = fakeDb(null);
    const google = fakeGoogle({ duringWatch: () => { store.state = { ...blank('singleton'), channelId: 'other', resourceId: 'other-resource', channelExpiresAt: new Date(NOW.getTime() + 7 * DAY_MS) }; } });
    assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'current');
    assert.equal(store.state?.channelId, 'other');
    assert.deepEqual(google.calls.map((call) => call.op), ['watch', 'stop']);
    assert.equal(google.calls[1].id, google.calls[0].id, 'it stops its own channel, never the winner');
  }
  // The pull created the row (busy-time hash, no channel) in between.
  {
    const { db, store } = fakeDb(null);
    const google = fakeGoogle({ duringWatch: () => { store.state = { ...blank('singleton'), busyHash: 'h' }; } });
    assert.equal(await channel.ensureGoogleWatchChannel({ db: db as never, gateway: google.gateway, now: NOW }), 'created');
    assert.equal(store.state?.channelId, google.calls[0].id);
    assert.equal(store.state?.busyHash, 'h');
    assert.deepEqual(google.calls.map((call) => call.op), ['watch']);
  }
});

// ── single-flight pull ──────────────────────────────────────────────────────

type SetOptions = { nx?: boolean; ex?: number };
const LOCK = 'google-calendar-pull';
const AGAIN = 'google-calendar-pull-again';

/** Upstash's commands as Redis runs them, with each call recorded. */
function fakeRedis(hooks: {
  onSet?: (key: string, store: Map<string, string>, value: string) => void;
  fail?: (command: string, key: string) => boolean;
  /** The command takes effect, then its reply is lost (a timeout after Redis acted). */
  landThenFail?: (command: string, key: string) => boolean;
  /** Runs after a release has taken effect, before its reply arrives. */
  afterEval?: () => Promise<void>;
} = {}) {
  const store = new Map<string, string>();
  const calls: { command: string; key: string; options?: SetOptions }[] = [];
  const check = (command: string, key: string) => {
    if (hooks.fail?.(command, key)) throw new Error(`redis ${command} failed`);
  };
  const lost = (command: string, key: string) => {
    if (hooks.landThenFail?.(command, key)) throw new Error(`redis ${command} timed out`);
  };
  const redis = {
    async set(key: string, value: string, options?: SetOptions) {
      calls.push({ command: 'set', key, options });
      check('set', key);
      hooks.onSet?.(key, store, value);
      if (options?.nx && store.has(key)) return null;
      store.set(key, String(value));
      lost('set', key);
      return 'OK' as const;
    },
    async get(key: string) {
      calls.push({ command: 'get', key });
      check('get', key);
      return store.get(key) ?? null;
    },
    async del(key: string) {
      calls.push({ command: 'del', key });
      check('del', key);
      return store.delete(key) ? 1 : 0;
    },
    /** The only script the lock runs: delete the key if it still holds this owner's value. */
    async eval(_script: string, keys: string[], args: string[]) {
      calls.push({ command: 'eval', key: keys[0] });
      check('eval', keys[0]);
      const released = store.get(keys[0]) === args[0];
      if (released) store.delete(keys[0]);
      await hooks.afterEval?.();
      return released ? 1 : 0;
    },
  };
  return { redis, store, calls };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A pull that waits on `finish()` the first time it runs. */
function gatedPull() {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const pull = { runs: 0, finish: () => finish(), fn: async () => { pull.runs += 1; if (pull.runs === 1) await gate; } };
  return pull;
}

test('without Redis credentials the pull just runs', async () => {
  const channel = load();
  let runs = 0;
  await channel.runPullSingleFlight(async () => { runs += 1; }, { redis: null });
  assert.equal(runs, 1);
});

test('a lone pull takes the lock for 90 seconds (the webhook\'s whole run), runs once and releases it', async () => {
  const channel = load();
  const { redis, store, calls } = fakeRedis();
  let runs = 0;
  await channel.runPullSingleFlight(async () => {
    runs += 1;
    assert.ok(store.has(LOCK), 'held while pulling');
  }, { redis: redis as never });
  assert.equal(runs, 1);
  assert.deepEqual(calls[0], { command: 'set', key: LOCK, options: { nx: true, ex: 90 } });
  assert.equal(store.size, 0, 'released, nothing left behind');
});

test('two overlapping pulls: one pull, then one trailing re-run for the change that came in during it', async () => {
  const channel = load();
  const { redis, store, calls } = fakeRedis();
  const first = gatedPull();
  const running = channel.runPullSingleFlight(first.fn, { redis: redis as never });
  await settle();
  assert.equal(first.runs, 1);

  let secondRuns = 0;
  // Returns at once: the running pull is asked to go again instead.
  await channel.runPullSingleFlight(async () => { secondRuns += 1; }, { redis: redis as never });
  assert.equal(secondRuns, 0);
  assert.equal(first.runs, 1, 'never two pulls at once');
  assert.ok(calls.some((call) => call.command === 'set' && call.key === AGAIN && call.options?.ex === 120));

  first.finish();
  await running;
  assert.equal(first.runs, 2, 'one trailing re-run');
  assert.equal(secondRuns, 0);
  assert.equal(store.size, 0, 'lock released and the re-run request consumed');
});

test('a burst of notifications during a pull still brings only one trailing re-run', async () => {
  const channel = load();
  const { redis, store } = fakeRedis();
  const first = gatedPull();
  const running = channel.runPullSingleFlight(first.fn, { redis: redis as never });
  await settle();
  let others = 0;
  await Promise.all(Array.from({ length: 8 }, () => channel.runPullSingleFlight(async () => { others += 1; }, { redis: redis as never })));
  first.finish();
  await running;
  assert.equal(first.runs, 2);
  assert.equal(others, 0);
  assert.equal(store.size, 0);
});

test('a re-run requested of a new holder is never consumed by the old one', async () => {
  const channel = load();
  // The old holder is slow between its release and its look for a request.
  let paused!: () => void;
  let resume!: () => void;
  const pausedAfterRelease = new Promise<void>((resolve) => { paused = resolve; });
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  let evals = 0;
  const { redis, store } = fakeRedis({ afterEval: async () => { if (++evals === 1) { paused(); await resumed; } } });

  let oldRuns = 0;
  const old = channel.runPullSingleFlight(async () => { oldRuns += 1; }, { redis: redis as never });
  await pausedAfterRelease;
  // Meanwhile a new caller takes the freed lock and starts pulling…
  const holder = gatedPull();
  const holding = channel.runPullSingleFlight(holder.fn, { redis: redis as never });
  await settle();
  assert.equal(holder.runs, 1);
  // …and a change made during its pull asks it for a re-run.
  let lateRuns = 0;
  await channel.runPullSingleFlight(async () => { lateRuns += 1; }, { redis: redis as never });
  assert.equal(store.get(AGAIN), '1');

  resume();
  await old;
  assert.equal(store.get(AGAIN), '1', 'the old holder could not take the lock, so it left the request alone');
  holder.finish();
  await holding;
  assert.deepEqual({ oldRuns, holderRuns: holder.runs, lateRuns }, { oldRuns: 1, holderRuns: 2, lateRuns: 0 }, 'the holder ran one more pass');
  assert.equal(store.size, 0);
});

test('a holder that finished in between is not relied on: the late caller pulls itself', async () => {
  const channel = load();
  // Another instance holds the lock; it releases (and has already looked for
  // a re-run request) just as this caller asks for one.
  const { redis, store } = fakeRedis({
    onSet: (key, map) => { if (key === AGAIN) map.delete(LOCK); },
  });
  store.set(LOCK, 'another-instance');
  let runs = 0;
  await channel.runPullSingleFlight(async () => { runs += 1; }, { redis: redis as never });
  assert.equal(runs, 1, 'it took the freed lock and pulled, once');
  assert.equal(store.size, 0);
});

test('a SET that landed but whose reply was lost: the fallback pull still releases the lock it took', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const channel = load();
  const { redis, store } = fakeRedis({ landThenFail: (command, key) => command === 'set' && key === LOCK });
  let runs = 0;
  await channel.runPullSingleFlight(async () => { runs += 1; }, { redis: redis as never });
  assert.equal(runs, 1);
  assert.equal(store.has(LOCK), false, 'not left to block every notification for 90 seconds');
});

test('a retried SET that finds its own first try counts as holding the lock', async () => {
  const channel = load();
  // The first try landed, its reply was lost, and the client's retry (NX) found the key.
  let landed = false;
  const { redis, store } = fakeRedis({ onSet: (key, map, value) => { if (key === LOCK && !landed) { landed = true; map.set(key, value); } } });
  let runs = 0;
  await channel.runPullSingleFlight(async () => { runs += 1; }, { redis: redis as never });
  assert.equal(runs, 1);
  assert.equal(store.size, 0);
});

test('re-runs stop after three passes', async () => {
  const channel = load();
  const { redis, store } = fakeRedis();
  let runs = 0;
  // A notification arrives during every pass.
  await channel.runPullSingleFlight(async () => { runs += 1; store.set(AGAIN, '1'); }, { redis: redis as never });
  assert.equal(runs, 3);
  assert.equal(store.get(AGAIN), '1', 'the last request is left for the next notification');
  assert.equal(store.has(LOCK), false);
});

test('no new pass starts once 60 seconds have gone, so the run ends inside the webhook\'s 90', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
  const channel = load();
  const { redis, store } = fakeRedis();
  let runs = 0;
  await channel.runPullSingleFlight(async () => {
    runs += 1;
    store.set(AGAIN, '1');
    t.mock.timers.tick(31_000);
  }, { redis: redis as never });
  assert.equal(runs, 2, 'a second pass at 31 s, none at 62 s');
  assert.equal(store.get(AGAIN), '1');
  assert.equal(store.has(LOCK), false);
});

test('a Redis failure never stops the pull', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const channel = load();
  for (const [command, key] of [['set', LOCK], ['set', AGAIN]] as const) {
    const { redis, store } = fakeRedis({ fail: (failed, failedKey) => failed === command && failedKey === key });
    if (key === AGAIN) store.set(LOCK, 'another-instance');
    let runs = 0;
    await channel.runPullSingleFlight(async () => { runs += 1; }, { redis: redis as never });
    assert.equal(runs, 1, `${command} ${key}`);
  }
  // Failing bookkeeping around a pull that ran costs nothing more.
  for (const command of ['del', 'eval', 'get']) {
    const { redis } = fakeRedis({ fail: (failed) => failed === command });
    let runs = 0;
    await channel.runPullSingleFlight(async () => { runs += 1; }, { redis: redis as never });
    assert.equal(runs, 1, command);
  }
});

test('a pull that throws still releases the lock', async () => {
  const channel = load();
  const { redis, store } = fakeRedis();
  await assert.rejects(channel.runPullSingleFlight(async () => { throw new Error('boom'); }, { redis: redis as never }), /boom/);
  assert.equal(store.has(LOCK), false);
});

test('the lock is only released by its owner', async () => {
  const channel = load();
  const { redis, store } = fakeRedis();
  await channel.runPullSingleFlight(async () => {
    // The lock ran out mid-pull and another instance took it.
    store.set(LOCK, 'another-instance');
  }, { redis: redis as never });
  assert.equal(store.get(LOCK), 'another-instance');
});
