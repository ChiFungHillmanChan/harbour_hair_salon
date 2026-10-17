import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { OPERATIONS_MESSAGES } from './operations-messages';

// The Google Calendar step that rides the existing crons (task G8 of
// docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md, spec §7):
// calendar-sync pushes what changed, pulls as a safety net and checks the
// sync's health (spec §8); housekeeping also keeps the watch channel alive and
// reconciles the whole window. Each part is isolated, each run lands in its
// own job row, and with the sync off nothing is imported, queried or called.

const CONFIG = { calendarId: 'cal@group.calendar.google.com', clientEmail: 'sa@harbour.iam.gserviceaccount.com', privateKey: 'k', webhookSecret: 's' };
const PUSHED = { written: 2, deleted: 0, unchanged: 5, failed: 0 };
const PULLED = { reverted: 0, blocks: 1, entries: 1, changed: false, diaryChanged: false };
const HOUR = 60 * 60_000;
type SyncState = { channelId: string | null; channelExpiresAt: Date | null; lastPullAt: Date | null; lastPullSuccessAt: Date | null };
/** A live channel and a check of Google that has just succeeded. */
const healthyState = (): SyncState => ({
  channelId: 'channel-1', channelExpiresAt: new Date(Date.now() + 5 * 24 * HOUR), lastPullAt: new Date(), lastPullSuccessAt: new Date(),
});
const HEALTHY = { channel: 'ok', pull: 'ok' };

type Options = {
  enabled?: boolean;
  channel?: 'created' | 'renewed' | 'current' | Error;
  push?: typeof PUSHED & { stopped?: 'setup' } | Error;
  pull?: { reverted: number; blocks: number; entries: number; changed: boolean; diaryChanged: boolean; failed?: true } | Error;
  /** The single-flight lock was held: the holder pulls, this caller does not. */
  deferred?: boolean;
  jobRowFails?: boolean;
  /** GoogleCalendarSyncState as the 30-minute run reads it (null: no row yet). */
  state?: SyncState | null;
};

function harness(options: Options = {}) {
  const order: string[] = [];
  const jobRows: { name: string; op: 'upsert' | 'update'; data: Record<string, unknown> }[] = [];
  const counts = { imports: 0, queries: 0, stateReads: 0 };
  const db = {
    googleCalendarSyncState: {
      findUnique: async () => {
        counts.queries++;
        counts.stateReads++;
        order.push('health');
        return options.state === undefined ? healthyState() : options.state;
      },
    },
    backgroundJobState: {
      upsert: async ({ where, update }: { where: { name: string }; update: Record<string, unknown> }) => {
        counts.queries++;
        if (options.jobRowFails) throw new Error('connect ECONNREFUSED db.internal:5432');
        order.push('job:start');
        jobRows.push({ name: where.name, op: 'upsert', data: update });
        return {};
      },
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => {
        counts.queries++;
        if (options.jobRowFails) throw new Error('connect ECONNREFUSED db.internal:5432');
        order.push('job:end');
        jobRows.push({ name: where.name, op: 'update', data });
        return {};
      },
    },
  };
  const outcome = <T>(value: T | Error | undefined, fallback: T): T => {
    if (value instanceof Error) throw value;
    return value ?? fallback;
  };
  const counted = <T extends object>(module: T): T => new Proxy(module, {
    get(target, key) { counts.imports++; return target[key as keyof T]; },
  });
  const job = loadServerModule<typeof import('./google-calendar-job')>('src/app/services/google-calendar-job.ts', {
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => (options.enabled === false ? null : CONFIG) },
    '@/app/lib/prisma': counted({ __esModule: true, default: db }),
    './google-calendar-channel': counted({
      ensureGoogleWatchChannel: async (input: unknown) => {
        order.push(`channel:${JSON.stringify(input)}`);
        return outcome(options.channel, 'current');
      },
      runPullSingleFlight: async (pull: () => Promise<unknown>) => {
        order.push('single-flight');
        if (!options.deferred) await pull();
      },
    }),
    './google-calendar-push': counted({
      pushGoogleCalendar: async (input: { mode: string }) => {
        order.push(`push:${input.mode}`);
        return outcome(options.push, PUSHED);
      },
    }),
    './google-calendar-pull': counted({
      pullGoogleCalendar: async (...args: unknown[]) => {
        assert.deepEqual(args, [], 'the default client, clock and gateway');
        order.push('pull');
        return outcome(options.pull, PULLED);
      },
    }),
  });
  const finalRow = () => jobRows.filter((row) => row.op === 'update').at(-1)?.data;
  return { job, order, jobRows, counts, finalRow };
}

test('with the sync off nothing is imported, queried or called, for either run', async () => {
  for (const run of ['calendar-sync', 'daily'] as const) {
    const h = harness({ enabled: false });
    assert.deepEqual(await h.job.runGoogleCalendarJob(run), { skipped: 'disabled' });
    assert.deepEqual(h.order, []);
    assert.deepEqual(h.counts, { imports: 0, queries: 0, stateReads: 0 });
  }
});

test('calendar-sync: pushes what changed recently, pulls single-flight, then checks health, in its own job row', async () => {
  const h = harness();
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual(h.order, ['job:start', 'push:recent', 'single-flight', 'pull', 'health', 'job:end']);
  assert.deepEqual(result, { ok: true, push: PUSHED, pull: PULLED, health: HEALTHY });
  assert.ok(h.jobRows.every((row) => row.name === 'google-calendar'));
  const row = h.finalRow()!;
  assert.ok(row.lastSucceededAt instanceof Date);
  assert.equal(row.lastError, null);
  assert.deepEqual(JSON.parse(String(row.lastResultJson)), { ok: true, push: PUSHED, pull: PULLED, health: HEALTHY });
});

test('daily: keeps the watch channel alive, reconciles the whole window, then pulls — in its own job row, no health read', async () => {
  const h = harness({ channel: 'renewed' });
  const result = await h.job.runGoogleCalendarJob('daily');
  assert.deepEqual(h.order, ['job:start', 'channel:{"renew":false}', 'push:all', 'single-flight', 'pull', 'job:end']);
  assert.deepEqual(result, { ok: true, channel: 'renewed', push: PUSHED, pull: PULLED });
  assert.ok(h.jobRows.every((row) => row.name === 'google-calendar-daily'));
  assert.ok(h.finalRow()!.lastSucceededAt instanceof Date);
  assert.equal(h.counts.stateReads, 0);
});

test('a 03:15 channel failure stays on the daily row: the next 30-minute success writes only its own row', async (t) => {
  t.mock.method(console, 'error', () => {});
  const nightly = harness({ channel: new Error('Google refused the watch request') });
  await nightly.job.runGoogleCalendarJob('daily');
  assert.deepEqual([...new Set(nightly.jobRows.map((row) => row.name))], ['google-calendar-daily']);
  assert.equal(nightly.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED);
  const morning = harness();
  await morning.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual([...new Set(morning.jobRows.map((row) => row.name))], ['google-calendar']);
});

test('health: no channel, or one that has run out, flags the 30-minute row while the sync is on', async () => {
  for (const [state, channel] of [
    [null, 'missing'],
    [{ ...healthyState(), channelId: null, channelExpiresAt: null }, 'missing'],
    [{ ...healthyState(), channelExpiresAt: new Date(Date.now() - 1000) }, 'expired'],
  ] as const) {
    const h = harness({ state });
    const result = await h.job.runGoogleCalendarJob('calendar-sync');
    assert.equal((result as { ok: boolean }).ok, false, JSON.stringify(state));
    assert.equal((result as { health: { channel: string } }).health.channel, channel);
    const row = h.finalRow()!;
    assert.ok(row.lastFailedAt instanceof Date);
    assert.equal(row.lastSucceededAt, undefined);
    assert.equal(row.lastError, OPERATIONS_MESSAGES.GOOGLE_CHANNEL_MISSING);
  }
});

test('health: no successful check of Google for over 24 hours is stale; a fresh setup that never pulled is not', async () => {
  const day = 24 * HOUR;
  // The pull was deferred to a holder whose own pull is failing: the last success is a day old.
  const stale = harness({ deferred: true, state: { ...healthyState(), lastPullAt: new Date(), lastPullSuccessAt: new Date(Date.now() - day - HOUR) } });
  assert.deepEqual((await stale.job.runGoogleCalendarJob('calendar-sync') as { health: unknown }).health, { channel: 'ok', pull: 'stale' });
  assert.equal(stale.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_PULL_STALE);
  // Tried and never succeeded.
  const never = harness({ deferred: true, state: { ...healthyState(), lastPullAt: new Date(), lastPullSuccessAt: null } });
  await never.job.runGoogleCalendarJob('calendar-sync');
  assert.equal(never.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_PULL_STALE);
  // Within the day: fine.
  const recent = harness({ deferred: true, state: { ...healthyState(), lastPullSuccessAt: new Date(Date.now() - day + HOUR) } });
  await recent.job.runGoogleCalendarJob('calendar-sync');
  assert.equal(recent.finalRow()!.lastError, null);
  // Nothing attempted yet (the first run, its pull skipped for time): no alarm about the pull.
  const fresh = harness({ state: { ...healthyState(), lastPullAt: null, lastPullSuccessAt: null } });
  const result = await fresh.job.runGoogleCalendarJob('calendar-sync', { deadline: Date.now() + 30_000 });
  assert.deepEqual((result as { health: unknown }).health, { channel: 'ok', pull: 'none-yet' });
  assert.equal(fresh.finalRow()!.lastError, null);
});

test('health ranks after a step that could not complete, and before the channel and failing bookings', async (t) => {
  t.mock.method(console, 'error', () => {});
  const stalePull = { ...healthyState(), lastPullSuccessAt: new Date(Date.now() - 48 * HOUR) };
  const noChannel = { ...healthyState(), channelId: null, channelExpiresAt: null };
  const failedStep = harness({ pull: new Error('x'), state: { ...stalePull, channelId: null } });
  await failedStep.job.runGoogleCalendarJob('calendar-sync');
  assert.equal(failedStep.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED);
  const staleAndNoChannel = harness({ deferred: true, state: { ...stalePull, channelId: null } });
  await staleAndNoChannel.job.runGoogleCalendarJob('calendar-sync');
  assert.equal(staleAndNoChannel.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_PULL_STALE);
  const channelAndEvents = harness({ push: { ...PUSHED, failed: 2 }, state: noChannel });
  await channelAndEvents.job.runGoogleCalendarJob('calendar-sync');
  assert.equal(channelAndEvents.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_CHANNEL_MISSING);
});

test('renew: true (Sync now) replaces the watch channel at once; the crons never ask for it', async () => {
  const renewed = harness({ channel: 'renewed' });
  await renewed.job.runGoogleCalendarJob('daily', { renew: true });
  assert.deepEqual(renewed.order, ['job:start', 'channel:{"renew":true}', 'push:all', 'single-flight', 'pull', 'job:end']);
  // Housekeeping passes no renew: the nightly run must not replace the channel every night.
  const nightly = harness();
  await nightly.job.runGoogleCalendarJob('daily', { renew: false });
  assert.ok(nightly.order.includes('channel:{"renew":false}'));
  // The 30-minute run never touches the channel, whatever it is asked.
  const cron = harness();
  await cron.job.runGoogleCalendarJob('calendar-sync', { renew: true });
  assert.ok(!cron.order.some((step) => step.startsWith('channel:')));
});

test('a pull already running elsewhere covers this one: recorded as deferred, not as a failure', async () => {
  const h = harness({ deferred: true });
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual(h.order, ['job:start', 'push:recent', 'single-flight', 'health', 'job:end']);
  assert.deepEqual(result, { ok: true, push: PUSHED, pull: 'deferred', health: HEALTHY });
  assert.equal(h.finalRow()!.lastError, null);
});

test('a watch channel that cannot be made is recorded in the job row; the push and pull still run', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const h = harness({ channel: new Error('Google refused: https://www.googleapis.com/calendar/v3/calendars/secret-id') });
  const result = await h.job.runGoogleCalendarJob('daily');
  assert.deepEqual(h.order, ['job:start', 'channel:{"renew":false}', 'push:all', 'single-flight', 'pull', 'job:end']);
  assert.deepEqual(result, { ok: false, channel: 'failed', push: PUSHED, pull: PULLED });
  const row = h.finalRow()!;
  assert.ok(row.lastFailedAt instanceof Date);
  assert.equal(row.lastSucceededAt, undefined);
  assert.equal(row.lastError, OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED);
  assert.doesNotMatch(JSON.stringify(logged), /secret-id/, 'only the error name is logged');
});

test('a push that throws never stops the pull; the job row says the step could not complete', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ push: new Error('database unavailable') });
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual(h.order, ['job:start', 'push:recent', 'single-flight', 'pull', 'health', 'job:end']);
  assert.deepEqual(result, { ok: false, push: 'failed', pull: PULLED, health: HEALTHY });
  assert.equal(h.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED);
});

test('a pull that throws is recorded the same way', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = harness({ pull: new Error('lock store exploded') });
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual(result, { ok: false, push: PUSHED, pull: 'failed', health: HEALTHY });
  assert.equal(h.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED);
});

test('a pull that could not complete (recorded on the sync state) flags the job row too', async () => {
  const failedPull = { ...PULLED, failed: true as const };
  const h = harness({ pull: failedPull });
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual(result, { ok: false, push: PUSHED, pull: failedPull, health: HEALTHY });
  assert.ok(h.finalRow()!.lastFailedAt instanceof Date);
  assert.equal(h.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED);
});

test('with too little of the function\'s time left the pull is skipped and said so; the push still runs', async () => {
  for (const run of ['calendar-sync', 'daily'] as const) {
    const h = harness();
    const result = await h.job.runGoogleCalendarJob(run, { deadline: Date.now() + 30_000 });
    assert.ok(!h.order.includes('pull') && !h.order.includes('single-flight'), run);
    assert.ok(h.order.some((step) => step.startsWith('push:')), run);
    assert.deepEqual(result, { ok: true, ...(run === 'daily' ? { channel: 'current' } : { health: HEALTHY }), push: PUSHED, pull: 'skipped: no time left' });
    assert.equal(h.finalRow()!.lastError, null, 'the next run pulls: nothing failed');
  }
  const roomy = harness();
  await roomy.job.runGoogleCalendarJob('calendar-sync', { deadline: Date.now() + 120_000 });
  assert.ok(roomy.order.includes('pull'));
});

test('the deadline is checked after the push, when the time it took is known', async () => {
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  try {
    const h = harness();
    // 100 s left at the start; the push takes 70 s of it.
    const push = h.job.runGoogleCalendarJob('calendar-sync', { deadline: clock + 100_000 });
    clock += 70_000;
    const result = await push;
    assert.deepEqual(h.order.filter((step) => step === 'pull'), []);
    assert.equal((result as { pull: unknown }).pull, 'skipped: no time left');
  } finally {
    Date.now = realNow;
  }
});

test('bookings Google would not take are counted on their rows and flag the job row', async () => {
  const failing = { ...PUSHED, failed: 3 };
  const h = harness({ push: failing });
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.deepEqual(result, { ok: false, push: failing, pull: PULLED, health: HEALTHY });
  assert.ok(h.finalRow()!.lastFailedAt instanceof Date);
  assert.equal(h.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_EVENTS_FAILED);
});

test('a push stopped by a setup failure is recorded once on the job row as a step that could not complete', async () => {
  const stopped = { ...PUSHED, failed: 1, stopped: 'setup' as const };
  const h = harness({ push: stopped });
  const result = await h.job.runGoogleCalendarJob('calendar-sync');
  assert.equal((result as { ok: boolean }).ok, false);
  assert.equal(h.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED);
});

test('a step that could not complete outranks a channel failure, which outranks failing bookings', async (t) => {
  t.mock.method(console, 'error', () => {});
  const all = harness({ channel: new Error('x'), push: new Error('y') });
  await all.job.runGoogleCalendarJob('daily');
  assert.equal(all.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_SYNC_FAILED);
  const channelAndEvents = harness({ channel: new Error('x'), push: { ...PUSHED, failed: 1 } });
  await channelAndEvents.job.runGoogleCalendarJob('daily');
  assert.equal(channelAndEvents.finalRow()!.lastError, OPERATIONS_MESSAGES.GOOGLE_CHANNEL_FAILED);
});

test('a database that cannot record the job never throws to the cron', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const h = harness({ jobRowFails: true });
  assert.deepEqual(await h.job.runGoogleCalendarJob('calendar-sync'), { ok: false, error: true });
  assert.deepEqual(h.order, [], 'nothing runs against a database that cannot be written');
  assert.doesNotMatch(JSON.stringify(logged), /db\.internal/);
});
