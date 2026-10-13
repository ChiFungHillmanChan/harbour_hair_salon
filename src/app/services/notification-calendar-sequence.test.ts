import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

/**
 * The customer's calendar file is numbered (SEQUENCE) by the version its event
 * was queued at, read from the queued payload at dispatch — so the latest
 * confirmation, move or cancellation wins in the customer's calendar, and
 * building it costs no extra database read.
 */
test('dispatch hands the queued version to the email as the calendar SEQUENCE', async () => {
  const now = new Date('2099-09-01T12:00:00Z');
  const date = '2099-09-14T12:00:00.000Z';
  const row = {
    id: 'job-c', eventKey: 'appointment/a/3/CONFIRMATION', kind: 'CONFIRMATION', appointmentId: 'a', status: 'PENDING', attempts: 0,
    firstAttemptAt: null as Date | null, nextAttemptAt: now, createdAt: now, lockedAt: null as Date | null, lockToken: null as string | null,
    payloadJson: JSON.stringify({
      version: 3, date, locale: 'en-GB',
      appointment: { schema: 2, id: 'a', date, notes: null, user: { name: 'Amy', email: 'amy@example.test' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 }, price: { known: false } },
      options: {},
    }),
  };
  const appointmentReads: unknown[] = [];
  const prepared: { sequence?: number }[] = [];
  const db = {
    notificationDelivery: {
      findMany: async () => [row],
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.lockToken && where.lockToken !== row.lockToken) return { count: 0 };
        const increment = data.attempts as { increment?: number } | undefined;
        Object.assign(row, data, { attempts: row.attempts + (increment?.increment ?? 0) });
        return { count: 1 };
      },
    },
    appointment: {
      // isCurrent's status/version check only: the calendar file needs nothing more.
      findUnique: async (args: unknown) => { appointmentReads.push(args); return { id: 'a', status: 'CONFIRMED', date: new Date(date), notificationVersion: 3, review: null, rescheduleRequestedAt: null }; },
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async (_kind: string, _appointment: unknown, options: { sequence?: number }) => {
        prepared.push(options);
        return { from: 'Salon <b@example.com>', to: 'amy@example.test', subject: 'S', html: '<p>S</p>' };
      },
      sendPreparedEmail: async () => undefined,
    },
  });
  const enabled = process.env.NOTIFICATIONS_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'true';
  try {
    await service.dispatchPendingNotifications({ db: db as never, now });
  } finally {
    if (enabled === undefined) delete process.env.NOTIFICATIONS_ENABLED; else process.env.NOTIFICATIONS_ENABLED = enabled;
  }
  assert.equal(row.status, 'SENT');
  assert.equal(prepared[0].sequence, 3);
  assert.equal(appointmentReads.length, 2, 'only the two freshness checks read the appointment');
});
