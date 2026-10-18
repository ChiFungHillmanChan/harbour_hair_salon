import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2026-09-11T12:00:00Z');
before(() => mock.timers.enable({ apis: ['Date'], now }));
after(() => mock.timers.reset());

function fixture(prefixSize = 100, advanceOnEnqueue = false, placeholderIds: string[] = [], lapseFails = false, requestLapseFails = false) {
  let dispatchCalls = 0;
  const createdAt: Date[] = [];
  let lapseCalls = 0;
  // Order of the steps that must happen before delivery in one run.
  const steps: string[] = [];
  type Notice = { eventKey: string; kind: string; status: string; createdAt?: Date };
  // Upcoming bookings whose reminder already failed for good: a terminal prefix the scan must get past.
  const existing = Array.from({ length: prefixSize }, (_, index) => {
    const id = `reminder-${String(index).padStart(5, '0')}`;
    return { id, status: 'CONFIRMED', date: new Date('2026-09-12T08:00:00Z'), notificationVersion: 0, reviewRequestSent: false, reminderSent: false, review: null, notifications: [{ eventKey: `appointment/${id}/0/REMINDER`, kind: 'REMINDER', status: 'FAILED' }] as Notice[] };
  });
  const rows = [
    ...existing,
    // Inside the review-invitation window: retired since 2026-10-18, so never queued.
    { id: 'review-target', status: 'COMPLETED', date: new Date('2026-09-10T10:00:00Z'), notificationVersion: 1, reviewRequestSent: false, reminderSent: true, review: null, notifications: [] as Notice[] },
    { id: 'reminder-target', status: 'CONFIRMED', date: new Date('2026-09-12T10:00:00Z'), notificationVersion: 0, reviewRequestSent: false, reminderSent: false, review: null, notifications: [] as Notice[] },
  ];
  const appointmentQueries: Record<string, unknown>[] = [];
  let enqueueAttempts = 0;
  const jobStates = new Map<string, Record<string, unknown>>();
  const queued: string[] = [];
  const cleanupCalls: unknown[] = [];
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => Object.entries(where).every(([field, value]) => {
    if (field === 'OR') return (value as Record<string, unknown>[]).some((branch) => matches(row, branch));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, expected]) => {
        const actual = row[field] as string | number;
        if (operator === 'in') return (expected as unknown[]).includes(actual);
        if (operator === 'gt') return actual > (expected as string | number);
        if (operator === 'gte') return actual >= (expected as string | number);
        if (operator === 'lt') return actual < (expected as string | number);
        if (operator === 'lte') return actual <= (expected as string | number);
        throw new Error(`Unhandled query operator ${operator}`);
      });
    }
    return row[field] === value;
  });
  const db = {
    backgroundJobState: {
      upsert: async ({ where, create, update }: { where: { name: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const row = jobStates.get(where.name) ?? { lastResultJson: null, lockedUntil: null, lockToken: null, ...create };
        Object.assign(row, update); jobStates.set(where.name, row); return { ...row };
      },
      findUnique: async ({ where }: { where: { name: string } }) => ({ ...jobStates.get(where.name) }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = jobStates.get(String(where.name));
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
      update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => { Object.assign(jobStates.get(where.name)!, data); },
    },
    appointment: {
      findMany: async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy: Record<string, unknown>; take: number }) => {
        appointmentQueries.push(where);
        const key = Object.keys(orderBy)[0] as 'id' | 'date';
        return rows.filter((row) => matches(row, where)).sort((left, right) => left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0).slice(0, take);
      },
    },
    notificationDelivery: { updateMany: async (args: unknown) => { cleanupCalls.push(args); return { count: 0 }; } },
  };
  const service = loadServerModule<typeof import('./notification-cron-service')>('src/app/services/notification-cron-service.ts', {
    '@/app/lib/prisma': db,
    './reschedule-request-lapse': { lapseExpiredRescheduleRequests: async () => { lapseCalls++; if (lapseFails) throw new Error('boom'); return { lapsed: 0, failed: 0 }; } },
    './pending-request-lapse': { lapseStartedPendingRequests: async (at: Date, options?: { takenDeposits?: boolean }) => {
      // Review I-E: a taken deposit is only ever lapsed (and refunded) by the daily housekeeping run.
      steps.push(`request-lapse@${at.toISOString()}${options?.takenDeposits ? '+taken-deposits' : ''}`);
      if (requestLapseFails) throw new Error('boom');
      return { lapsed: 2, failed: 0 };
    } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, row: (typeof rows)[number]) => {
        enqueueAttempts++;
        // The real outbox writes nothing (returns null) for walk-in placeholder addresses.
        if (placeholderIds.includes(row.id)) return null;
        const eventKey = `appointment/${row.id}/${row.notificationVersion}/${kind}`;
        if (!row.notifications.some((event) => event.eventKey === eventKey)) {
          if (advanceOnEnqueue) mock.timers.tick(5);
          createdAt.push(new Date());
          queued.push(row.id);
          row.notifications.push({ eventKey, kind, status: 'PENDING' });
        }
        return { id: eventKey };
      },
      dispatchPendingNotifications: async (options: { now?: Date }) => (dispatchCalls++, steps.push('dispatch'), { sent: advanceOnEnqueue ? createdAt.filter((date) => date <= (options.now ?? new Date())).length : 0, failed: 0, skipped: 0, deferred: 0 }),
    },
  });
  return { service, queued, jobStates, rows, cleanupCalls, steps, appointmentQueries, enqueueAttempts: () => enqueueAttempts, lapseCalls: () => lapseCalls, dispatchCalls: () => dispatchCalls };
}

test('a full batch of terminal reminder notices only delays an upcoming reminder to the next run', async () => {
  const f = fixture();
  await f.service.runNotificationCron('notifications');
  assert.ok(!f.queued.includes('reminder-target'), 'the first 100 were all terminal');
  await f.service.runNotificationCron('notifications');
  assert.ok(f.queued.includes('reminder-target'), 'the cursor moved past them');
});

test('a persistent cursor progresses beyond a large terminal prefix across both cron schedules', async () => {
  const f = fixture(350);
  for (let index = 0; index < 5; index++) await f.service.runNotificationCron(index % 2 === 0 ? 'notifications' : 'reminders');
  assert.equal(f.queued.filter((id) => id === 'reminder-target').length, 1);
  assert.ok(f.rows.filter((row) => row.id.startsWith('reminder-0')).every((row) => row.reminderSent === false), 'scanning must not mislabel terminal failures as delivered');
});

test('the two cron schedules share a lock and do not enqueue duplicate work', async () => {
  const f = fixture(0);
  const results = await Promise.all([f.service.runNotificationCron('notifications'), f.service.runNotificationCron('reminders')]);
  assert.equal(results.filter((result) => 'busy' in result && result.busy).length, 1);
  assert.deepEqual(f.queued.sort(), ['reminder-target']);
  assert.equal(f.jobStates.get('notification-worker')?.lockToken, null);
});

// Both schedules fire at 08:00 UTC and share one worker lock. The run that
// loses the lock used to return before touching its own row, so Admin ->
// Operations showed the losing schedule (usually "reminders") as stuck for days.
test('the schedule that finds the shared worker busy records that it fired, without claiming success', async () => {
  const f = fixture(0);
  const [first, second] = await Promise.all([f.service.runNotificationCron('notifications'), f.service.runNotificationCron('reminders')]);
  const busyName = 'busy' in second && second.busy ? 'reminders' : 'busy' in first && first.busy ? 'notifications' : null;
  assert.ok(busyName, 'one schedule found the worker busy');
  const row = f.jobStates.get(busyName);
  assert.ok(row, 'the busy schedule has a row');
  assert.equal((row.lastStartedAt as Date).getTime(), now.getTime());
  assert.equal(row.lastSucceededAt, undefined, 'it cannot know how the shared run ends');
  assert.deepEqual(JSON.parse(String(row.lastResultJson)), { busy: true, sharedWorker: 'notification-worker' });
});

test('an earlier notification version does not suppress a new reminder', async () => {
  const f = fixture(0);
  const target = f.rows.find((row) => row.id === 'reminder-target')!;
  target.notificationVersion = 1;
  target.notifications.push({ eventKey: 'appointment/reminder-target/0/REMINDER', kind: 'REMINDER', status: 'SENT' });
  await f.service.runNotificationCron('notifications');
  assert.ok(f.queued.includes('reminder-target'));
});

test('an obsolete or malformed cursor checkpoint starts a fresh scan', async () => {
  const f = fixture(0);
  f.jobStates.set('notification-worker', { name: 'notification-worker', lockedUntil: null, lockToken: null, lastResultJson: '{broken-json' });
  await f.service.runNotificationCron('notifications');
  assert.deepEqual(f.queued.sort(), ['reminder-target']);
});


test('notifications created during this cron run are eligible for delivery immediately', async () => {
  const f = fixture(0, true);
  try {
    const result = await f.service.runNotificationCron('notifications');
    assert.equal('sent' in result ? result.sent : 0, 1, 'do not use the earlier discovery timestamp as the delivery cutoff');
  } finally { mock.timers.setTime(now.getTime()); }
});

test('delivery cron leaves retention writes to independent bounded housekeeping', async () => {
  const f = fixture(0);
  await f.service.runNotificationCron('notifications');
  assert.equal(f.cleanupCalls.length, 0);
});

test('walk-in placeholder bookings are not counted as queued on every run', async () => {
  const f = fixture(0, false, ['reminder-target']);
  for (let run = 0; run < 3; run++) {
    const result = await f.service.runNotificationCron('notifications');
    assert.equal('queued' in result ? result.queued : undefined, 0, `run ${run}`);
  }
  assert.equal(f.enqueueAttempts(), 3, 'rescanned every run, never counted');
});

// Owner decision 2026-10-18 ("short version"): REVIEW_REQUEST is a retired
// customer email (RETIRED_CUSTOMER_EMAIL_KINDS), so its phase is skipped
// before any query — the cron only ever looks for reminders.
test('the review-invitation phase is retired: no query for it, nothing queued, its saved cursor kept', async () => {
  const f = fixture(0);
  f.jobStates.set('notification-worker', { name: 'notification-worker', lockedUntil: null, lockToken: null, lastResultJson: JSON.stringify({ enqueueCursors: { REMINDER: null, REVIEW_REQUEST: 'review-00042' } }) });
  await f.service.runNotificationCron('notifications');
  assert.equal(f.appointmentQueries.length, 1, 'one appointment query per run: reminders only');
  assert.equal(f.appointmentQueries[0].reminderSent, false);
  assert.ok(f.appointmentQueries.every((where) => !('reviewRequestSent' in where)), 'never the review-invitation query');
  assert.ok(!f.queued.includes('review-target'));
  assert.equal(JSON.parse(String(f.jobStates.get('notification-worker')?.lastResultJson)).enqueueCursors.REVIEW_REQUEST, 'review-00042', 'kept for the day it is switched back on');
});

// Owner decision 2026-10-18: a REMINDER only for a booking confirmed at least
// 24 hours before its start (its earliest CONFIRMATION notice); with none, as before.
test('a booking confirmed less than 24 hours before its start gets no reminder; 24 hours or more, or no confirmation notice, gets one', async () => {
  const start = new Date('2026-09-12T10:00:00Z');
  const confirmation = (hoursBefore: number) => ({ eventKey: `confirmation-${hoursBefore}`, kind: 'CONFIRMATION', status: 'SENT', createdAt: new Date(start.getTime() - hoursBefore * 3_600_000) });
  for (const [label, notices, expected] of [
    ['confirmed 23h59m before', [confirmation(23 + 59 / 60)], false],
    ['confirmed 2 hours before (a staff booking for today)', [confirmation(2)], false],
    ['confirmed exactly 24 hours before', [confirmation(24)], true],
    ['confirmed 3 days before', [confirmation(72)], true],
    // The earliest confirmation counts: a later re-confirmation does not hide it.
    ['confirmed 3 days before and again 1 hour before', [confirmation(1), confirmation(72)], true],
    ['no confirmation notice', [], true],
  ] as const) {
    const f = fixture(0);
    f.rows.find((row) => row.id === 'reminder-target')!.notifications.push(...notices);
    const result = await f.service.runNotificationCron('notifications');
    assert.equal(f.queued.includes('reminder-target'), expected, label);
    assert.equal('remindersNotWanted' in result ? result.remindersNotWanted : undefined, expected ? 0 : 1, label);
  }
});

test('each claimed cron run lapses stale reschedule requests once; a busy run does not', async () => {
  const f = fixture(0);
  await Promise.all([f.service.runNotificationCron('notifications'), f.service.runNotificationCron('reminders')]);
  assert.equal(f.lapseCalls(), 1);
});

test('a failing lapse step never blocks discovery or delivery and is recorded', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture(0, false, [], true);
  const result = await f.service.runNotificationCron('notifications');
  assert.equal(f.dispatchCalls(), 1);
  assert.equal('lapseFailed' in result ? result.lapseFailed : undefined, 1);
});

test('each claimed run closes started booking requests before delivery, so their emails go out in the same tick', async () => {
  const f = fixture(0);
  const [first, second] = await Promise.all([f.service.runNotificationCron('notifications'), f.service.runNotificationCron('reminders')]);
  assert.deepEqual(f.steps, [`request-lapse@${now.toISOString()}`, 'dispatch'], 'once per claimed run, before dispatch; a busy run does not; never taken deposits');
  const claimed = 'busy' in first ? second : first;
  assert.equal('requestsLapsed' in claimed ? claimed.requestsLapsed : undefined, 2);
});

test('a failing booking-request lapse step never blocks delivery and is recorded', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = fixture(0, false, [], false, true);
  const result = await f.service.runNotificationCron('notifications');
  assert.equal(f.dispatchCalls(), 1);
  assert.equal('requestLapseFailed' in result ? result.requestLapseFailed : undefined, 1);
});

test('a busy hand-over leaves an earlier failure on that schedule visible', async () => {
  const f = fixture(0);
  const failedAt = new Date('2026-09-10T08:00:00Z');
  f.jobStates.set('reminders', { name: 'reminders', lastFailedAt: failedAt, lastError: 'Notification worker failed.', lastResultJson: null });
  f.jobStates.set('notification-worker', { name: 'notification-worker', lockedUntil: new Date(now.getTime() + 60_000), lockToken: 'other-run', lastResultJson: null });
  assert.deepEqual(await f.service.runNotificationCron('reminders'), { busy: true, failed: 0 });
  const row = f.jobStates.get('reminders')!;
  assert.equal((row.lastStartedAt as Date).getTime(), now.getTime());
  assert.equal(row.lastError, 'Notification worker failed.');
  assert.equal((row.lastFailedAt as Date).getTime(), failedAt.getTime());
});
