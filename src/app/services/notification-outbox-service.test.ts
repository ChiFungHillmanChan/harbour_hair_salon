import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

let previousNotificationsEnabled: string | undefined;
beforeEach(() => {
  previousNotificationsEnabled = process.env.NOTIFICATIONS_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'true';
});
afterEach(() => {
  if (previousNotificationsEnabled === undefined) delete process.env.NOTIFICATIONS_ENABLED;
  else process.env.NOTIFICATIONS_ENABLED = previousNotificationsEnabled;
});

function fixture({ obsolete = false, fail = false, changeDuringPreparation = false, unprepared = false } = {}) {
  const now = new Date('2026-09-11T12:00:00Z');
  const row = { id: 'job-1', eventKey: 'appointment/a/0/CONFIRMATION', kind: 'CONFIRMATION', appointmentId: 'a', status: 'PENDING', attempts: 0, firstAttemptAt: null as Date | null, nextAttemptAt: now, createdAt: now, lockedAt: null as Date | null, lockToken: null as string | null, payloadJson: JSON.stringify({ version: 0, date: '2026-09-12T12:00:00.000Z', email: { from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>' } }) };
  let sends = 0;
  let reads = 0;
  let renders = 0;
  const keys: string[] = [];
  let changed = obsolete;
  if (changeDuringPreparation || unprepared) row.payloadJson = JSON.stringify({ version: 0, date: '2026-09-12T12:00:00.000Z', appointment: { id: 'a', date: '2026-09-12T12:00:00.000Z', user: { name: 'Customer', email: 'customer@example.com' }, stylist: { name: 'Stylist' }, service: { name: 'Cut', price: 80, duration: 60 } } });
  const db = {
    notificationDelivery: {
      findMany: async () => { reads++; return [row]; },
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.lockToken && where.lockToken !== row.lockToken) return { count: 0 };
        if (where.OR && row.status !== 'PENDING') return { count: 0 };
        const increment = data.attempts as { increment?: number } | undefined;
        Object.assign(row, data, { attempts: row.attempts + (increment?.increment ?? 0) });
        return { count: 1 };
      },
    },
    appointment: {
      findUnique: async () => ({ id: 'a', status: changed ? 'CANCELLED' : 'CONFIRMED', date: new Date('2026-09-12T12:00:00Z'), notificationVersion: changed ? 1 : 0, review: null }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async () => { renders++; if (changeDuringPreparation) changed = true; return { from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>' }; },
      sendPreparedEmail: async (_email: unknown, key: string) => { sends++; keys.push(key); if (fail) throw new Error('Provider refused customer@example.com'); },
    },
  });
  return { service, db, row, keys, sends: () => sends, sideEffects: () => ({ reads, renders, sends }), now };
}

for (const flag of [undefined, 'false']) {
  test(`disabled notifications (${flag ?? 'unset'}) leave immediate and scheduled delivery untouched`, async () => {
    const f = fixture({ unprepared: true });
    const originalRow = structuredClone(f.row);
    if (flag === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = flag;

    const scheduled = await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
    const immediate = await f.service.dispatchAppointmentNotifications('a');

    assert.deepEqual(scheduled, { sent: 0, failed: 0, skipped: 0, deferred: 0 });
    assert.deepEqual(immediate, { sent: 0, failed: 0, skipped: 0, deferred: 0 });
    assert.deepEqual(f.sideEffects(), { reads: 0, renders: 0, sends: 0 });
    assert.deepEqual(f.row, originalRow, 'disabled delivery must preserve the queued payload and retry state');
  });
}

test('enabling notifications resumes a valid queued email through immediate delivery', async (t) => {
  const f = fixture({ unprepared: true });
  t.mock.timers.enable({ apis: ['Date'], now: f.now });
  process.env.NOTIFICATIONS_ENABLED = 'false';
  await f.service.dispatchAppointmentNotifications('a');
  assert.equal(f.row.status, 'PENDING');
  assert.equal(f.row.attempts, 0);

  process.env.NOTIFICATIONS_ENABLED = 'true';
  const result = await f.service.dispatchAppointmentNotifications('a');
  assert.deepEqual(result, { sent: 1, failed: 0, skipped: 0, deferred: 0 });
  assert.deepEqual(f.sideEffects(), { reads: 1, renders: 1, sends: 1 });
  assert.equal(f.row.status, 'SENT');
  assert.equal(f.row.attempts, 1);
  assert.deepEqual(f.keys, [f.row.eventKey]);
});

test('concurrent workers claim one notification and deliver using its stable event key', async () => {
  const f = fixture();
  await Promise.all([f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now }), f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now })]);
  assert.equal(f.sends(), 1);
  assert.equal(f.row.status, 'SENT');
  assert.deepEqual(f.keys, [f.row.eventKey]);
});

test('a cancelled or changed appointment suppresses an obsolete confirmation', async () => {
  const f = fixture({ obsolete: true });
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(f.sends(), 0);
  assert.equal(f.row.status, 'SKIPPED');
});

test('a cancellation committed during email preparation suppresses the stale confirmation before HTTP', async () => {
  const f = fixture({ changeDuringPreparation: true });
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(f.sends(), 0);
  assert.equal(f.row.status, 'SKIPPED');
  assert.equal(f.row.payloadJson, '{}');
});

test('provider failure persists a retry without recording customer data in its error', async () => {
  const f = fixture({ fail: true });
  const result = await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(result.failed, 1);
  assert.equal(f.row.status, 'PENDING');
  assert.ok(f.row.nextAttemptAt > f.now);
  assert.ok(!JSON.stringify(f.row).includes('Provider refused customer'));
});

test('an old ambiguous attempt is not retried beyond the provider deduplication window', async () => {
  const f = fixture();
  f.row.attempts = 1;
  f.row.firstAttemptAt = new Date(f.now.getTime() - 24 * 60 * 60 * 1000);
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(f.sends(), 0);
  assert.equal(f.row.status, 'FAILED');
});

test('disabled delivery still enqueues notification fields and frozen values without provider calls', async () => {
  process.env.NOTIFICATIONS_ENABLED = 'false';
  let payload = '';
  let rendered = false;
  const db = {
    notificationDelivery: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: { payloadJson: string } }) => { payload = create.payloadJson; return { id: 'queued' }; },
    },
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': { prepareAppointmentEmail: async () => { rendered = true; throw new Error('Provider unavailable'); } },
  });
  const appointment = {
    id: 'a', date: new Date('2026-09-12T12:00:00Z'), notificationVersion: 2, priceAtBooking: 80, durationAtBooking: 60, notes: null,
    user: { name: 'Customer', email: 'customer@example.com', password: 'secret-hash-never-queue', sessionVersion: 4 },
    stylist: { name: 'Stylist', icalToken: 'secret-calendar-token' },
    service: { name: 'Cut', price: 100, duration: 30 },
  };
  await service.enqueueAppointmentNotification(db as never, 'CONFIRMATION', appointment as never);
  assert.equal(rendered, false);
  assert.ok(!payload.includes('secret-'));
  const saved = JSON.parse(payload);
  assert.equal(saved.appointment.service.price, 80);
  assert.equal(saved.appointment.service.duration, 60);
  assert.equal(saved.version, 2);
});
