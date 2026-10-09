import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2026-09-11T12:00:00Z');
before(() => mock.timers.enable({ apis: ['Date'], now }));
after(() => mock.timers.reset());

function fixture(prefixSize = 100, advanceOnEnqueue = false, placeholderIds: string[] = [], lapseFails = false) {
  let dispatchCalls = 0;
  const createdAt: Date[] = [];
  let lapseCalls = 0;
  const existing = Array.from({ length: prefixSize }, (_, index) => {
    const id = `review-${String(index).padStart(5, '0')}`;
    return { id, status: 'COMPLETED', date: new Date('2026-09-02T12:00:00Z'), notificationVersion: 0, reviewRequestSent: false, reminderSent: true, review: null, notifications: [{ eventKey: `appointment/${id}/0/REVIEW_REQUEST`, kind: 'REVIEW_REQUEST', status: 'FAILED' }] };
  });
  const rows = [
    ...existing,
    { id: 'review-target', status: 'COMPLETED', date: new Date('2026-09-10T10:00:00Z'), notificationVersion: 1, reviewRequestSent: false, reminderSent: true, review: null, notifications: [] },
    { id: 'reminder-target', status: 'CONFIRMED', date: new Date('2026-09-12T10:00:00Z'), notificationVersion: 0, reviewRequestSent: false, reminderSent: false, review: null, notifications: [] },
  ];
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
        const key = Object.keys(orderBy)[0] as 'id' | 'date';
        return rows.filter((row) => matches(row, where)).sort((left, right) => left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0).slice(0, take);
      },
    },
    notificationDelivery: { updateMany: async (args: unknown) => { cleanupCalls.push(args); return { count: 0 }; } },
  };
  const service = loadServerModule<typeof import('./notification-cron-service')>('src/app/services/notification-cron-service.ts', {
    '@/app/lib/prisma': db,
    './reschedule-request-lapse': { lapseExpiredRescheduleRequests: async () => { lapseCalls++; if (lapseFails) throw new Error('boom'); return { lapsed: 0, failed: 0 }; } },
    './notification-outbox-service': {
      enqueueAppointmentNotification: async (_db: unknown, kind: string, row: (typeof rows)[number]) => {
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
      dispatchPendingNotifications: async (options: { now?: Date }) => (dispatchCalls++, { sent: advanceOnEnqueue ? createdAt.filter((date) => date <= (options.now ?? new Date())).length : 0, failed: 0, skipped: 0, deferred: 0 }),
    },
  });
  return { service, queued, jobStates, rows, cleanupCalls, lapseCalls: () => lapseCalls, dispatchCalls: () => dispatchCalls };
}

test('terminal review notices do not keep an upcoming reminder out of the next run', async () => {
  const f = fixture();
  await f.service.runNotificationCron('notifications');
  assert.ok(f.queued.includes('reminder-target'));
});

test('a persistent cursor progresses beyond a large terminal prefix across both cron schedules', async () => {
  const f = fixture(350);
  for (let index = 0; index < 5; index++) await f.service.runNotificationCron(index % 2 === 0 ? 'notifications' : 'reminders');
  assert.equal(f.queued.filter((id) => id === 'review-target').length, 1);
  assert.equal(f.queued.filter((id) => id === 'reminder-target').length, 1);
  assert.ok(f.rows.filter((row) => row.id !== 'reminder-target').every((row) => row.reviewRequestSent === false), 'scanning must not mislabel terminal failures as delivered');
});

test('the two cron schedules share a lock and do not enqueue duplicate work', async () => {
  const f = fixture(0);
  const results = await Promise.all([f.service.runNotificationCron('notifications'), f.service.runNotificationCron('reminders')]);
  assert.equal(results.filter((result) => 'busy' in result && result.busy).length, 1);
  assert.deepEqual(f.queued.sort(), ['reminder-target', 'review-target']);
  assert.equal(f.jobStates.get('notification-worker')?.lockToken, null);
});

test('an earlier notification version does not suppress a new review event', async () => {
  const f = fixture(0);
  f.rows.find((row) => row.id === 'review-target')!.notifications.push({ eventKey: 'appointment/review-target/0/REVIEW_REQUEST', kind: 'REVIEW_REQUEST', status: 'SENT' });
  await f.service.runNotificationCron('notifications');
  assert.ok(f.queued.includes('review-target'));
});

test('an obsolete or malformed cursor checkpoint starts a fresh scan', async () => {
  const f = fixture(0);
  f.jobStates.set('notification-worker', { name: 'notification-worker', lockedUntil: null, lockToken: null, lastResultJson: '{broken-json' });
  await f.service.runNotificationCron('notifications');
  assert.deepEqual(f.queued.sort(), ['reminder-target', 'review-target']);
});


test('notifications created during this cron run are eligible for delivery immediately', async () => {
  const f = fixture(0, true);
  try {
    const result = await f.service.runNotificationCron('notifications');
    assert.equal('sent' in result ? result.sent : 0, 2, 'do not use the earlier discovery timestamp as the delivery cutoff');
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
    assert.equal('queued' in result ? result.queued : undefined, run === 0 ? 1 : 0, `run ${run}`);
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
