/** Integration checks only against a disposable local PostgreSQL database. */
import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { resolveSalonDateTime } from '../src/app/services/salon-time';
import { loadServerModule } from '../src/test/load-server-module';

async function main() {
  const connection = process.env.SALON_TEST_DATABASE_URL;
  if (!connection) throw new Error('Set SALON_TEST_DATABASE_URL to a migrated disposable localhost database named salon_test.');
  const url = new URL(connection);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/salon_test' || url.searchParams.has('host')) throw new Error('Refusing to modify anything except a localhost database named salon_test.');
  process.env.POSTGRES_URL = connection;
  process.env.POSTGRES_URL_NON_POOLING = connection;
  process.env.NOTIFICATIONS_ENABLED = 'true';
  const queries: string[] = [];
  const db = new PrismaClient({ datasources: { db: { url: connection } }, log: [{ level: 'query', emit: 'event' }] });
  db.$on('query', event => queries.push(event.query));
  Object.assign(process.env, { EMAIL_FROM: 'Salon <bookings@example.com>', SALON_NOTIFY_EMAIL: 'owner@example.com', RESEND_API_KEY: 'test-key', KV_REST_API_URL: 'https://test.upstash.io', KV_REST_API_TOKEN: 'test-token', CRON_SECRET: 'test-secret', CALENDAR_SYNC_ENABLED: 'true' });
  const future = (days: number) => resolveSalonDateTime(new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10), '10:00').utc;
  let fixturesStarted = false;
  try {
    // This deliberately refuses a reused database containing real-looking users.
    assert.equal(await db.user.count(), 0, 'Use an empty disposable test database.');
    fixturesStarted = true;
    await db.siteSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', bookingEnabled: true }, update: { bookingEnabled: true } });
    const user = await db.user.create({ data: { id: 'verify-user', email: 'verify@example.invalid', name: 'Test Customer' } });
    const stylist = await db.stylist.create({ data: { id: 'verify-stylist', name: 'Test Stylist', role: 'Stylist', availabilities: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '18:00', isOff: false })) } } });
    const service = await db.service.create({ data: { id: 'verify-service', name: 'Test Cut', category: 'Cut', price: 100, duration: 60 } });
    await db.discountCode.create({ data: { id: 'verify-discount', code: 'VERIFY20', type: 'PERCENTAGE', value: 20, maxUses: 10 } });
    const booking = loadServerModule<typeof import('../src/app/services/booking-service')>('src/app/services/booking-service.ts', {
      '@/app/lib/prisma': db,
      './offers-service': { getActiveGlobalOffer: async () => null },
    });
    const { runOperationsDiagnostics } = await import('../src/app/services/operations-readiness');
    await runOperationsDiagnostics({ db, fetchImpl: async (url) => String(url).includes('resend.com') ? Response.json({ data: [{ name: 'example.com', status: 'verified', capabilities: { sending: 'enabled' } }], has_more: false }) : Response.json({ result: 'PONG' }) });
    const date = future(14);
    const attempts = await Promise.allSettled(Array.from({ length: 2 }, () => booking.createBooking({ stylistId: stylist.id, serviceId: service.id, userId: user.id, date, discountCode: 'VERIFY20' })));
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1, 'Concurrent requests must reserve one slot only');
    const booked = await db.appointment.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(Number(booked.priceAtBooking), 80);
    assert.equal(booked.durationAtBooking, 60);
    assert.equal((await db.discountCode.findUniqueOrThrow({ where: { id: 'verify-discount' } })).usedCount, 1);
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: booked.id } }), 2, 'Two notifications must commit with the request');
    const queue = await db.notificationDelivery.findMany({ where: { appointmentId: booked.id } });
    assert.ok(queue.every((job) => !job.payloadJson.includes('password')));
    let deliveries = 0;
    const worker = loadServerModule<typeof import('../src/app/services/notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
      '@/app/lib/prisma': db,
      './email-service': {
        prepareAppointmentEmail: async () => ({ from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'Synthetic', html: '<p>Test</p>' }),
        sendPreparedEmail: async () => { deliveries++; },
      },
    });
    await Promise.all([worker.dispatchPendingNotifications({ db }), worker.dispatchPendingNotifications({ db })]);
    assert.equal(deliveries, 2, 'Concurrent workers must each deliver a given notification once');
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: booked.id, status: 'SENT', payloadJson: '{}' } }), 2);
    const failedQueueBooking = loadServerModule<typeof import('../src/app/services/booking-service')>('src/app/services/booking-service.ts', {
      '@/app/lib/prisma': db,
      './offers-service': { getActiveGlobalOffer: async () => null },
      './notification-outbox-service': { enqueueAppointmentNotification: async () => { throw new Error('Simulated queue persistence failure'); } },
    });
    await assert.rejects(failedQueueBooking.createBooking({ stylistId: stylist.id, serviceId: service.id, userId: user.id, date: future(15), discountCode: 'VERIFY20' }));
    assert.equal(await db.appointment.count({ where: { userId: user.id } }), 1);
    assert.equal((await db.discountCode.findUniqueOrThrow({ where: { id: 'verify-discount' } })).usedCount, 1, 'Failed queue persistence rolls back the discount claim');
    // Distinct slots still contend on this customer's six-booking limit.
    await db.appointment.createMany({ data: Array.from({ length: 4 }, (_, i) => ({
      id: `verify-cap-${i}`, userId: user.id, stylistId: stylist.id, serviceId: service.id,
      date: future(20 + i), status: 'CONFIRMED', priceAtBooking: 100, durationAtBooking: 60,
    })) });
    const capAttempts = await Promise.allSettled([24, 25].map(days => booking.createBooking({
      stylistId: stylist.id, serviceId: service.id, userId: user.id, date: future(days),
    })));
    assert.equal(capAttempts.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent distinct slots cannot exceed six active bookings');
    assert.equal(await db.appointment.count({ where: { userId: user.id, status: { in: ['PENDING', 'CONFIRMED'] } } }), 6);
    await db.stylist.update({ where: { id: stylist.id }, data: { isActive: false } });
    await assert.rejects(booking.createBooking({ stylistId: stylist.id, serviceId: service.id, userId: user.id, date: future(26) }));
    await db.stylist.update({ where: { id: stylist.id }, data: { isActive: true } });

    // Audit persistence is part of the sensitive mutation, never best-effort.
    const audited = loadServerModule<typeof import('../src/app/lib/audited-write')>('src/app/lib/audited-write.ts', {
      './prisma': db, './audit': { appendAuditEvent: async () => { throw new Error('Synthetic audit write failure'); } },
    });
    await assert.rejects(audited.auditedWrite({ actorUserId: user.id, action: 'TEST.CHANGE', targetType: 'User', targetId: user.id },
      tx => tx.user.update({ where: { id: user.id }, data: { name: 'SHOULD_ROLL_BACK' } })), /Synthetic audit/);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name, 'Test Customer');

    // Payroll reads stay fixed as team size grows. Mutations share one period lock.
    await db.employee.createMany({ data: Array.from({ length: 10 }, (_, i) => ({
      id: `verify-employee-${i}`, name: `Synthetic Employee ${i}`, title: 'Stylist', pinHash: 'synthetic-not-a-real-pin',
      hourlyRate: 20, ...(i === 0 ? { stylistId: stylist.id } : {}),
    })) });
    await db.timeEntry.createMany({ data: Array.from({ length: 10 }, (_, i) => ({
      employeeId: `verify-employee-${i}`, clockIn: new Date('2026-09-01T09:00:00Z'),
      clockOut: new Date('2026-09-01T17:00:00Z'), status: 'APPROVED',
    })) });
    const payroll = loadServerModule<typeof import('../src/app/services/payroll-service')>('src/app/services/payroll-service.ts', { '@/app/lib/prisma': db });
    queries.length = 0;
    const { periodId } = await payroll.runPayrollWith(db, 2026, 9, user.id);
    const payrollReadQueries = queries.filter(sql => /^SELECT/i.test(sql));
    // Four bulk source reads, plus at most one relation read for live legacy prices.
    assert.ok(payrollReadQueries.filter(sql => /"TimeEntry"/.test(sql)).length <= 1);
    assert.ok(payrollReadQueries.filter(sql => /"Appointment"/.test(sql)).length <= 1);
    assert.ok(payrollReadQueries.filter(sql => /"Employee"/.test(sql)).length <= 1);
    const line = await db.payrollLine.findFirstOrThrow({ where: { periodId } });
    const concurrentPayroll = await Promise.allSettled([
      payroll.finalizePayroll(periodId, user.id),
      payroll.runPayrollWith(db, 2026, 9, user.id),
      payroll.updateAdjustment(line.id, 7, 'synthetic adjustment', user.id),
    ]);
    for (const result of concurrentPayroll) {
      if (result.status === 'rejected') assert.match(String(result.reason), /finalized/);
    }
    assert.equal((await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } })).status, 'FINALIZED');
    const finalizedLines = await db.payrollLine.findMany({ where: { periodId } });
    assert.equal(finalizedLines.length, 10);
    assert.ok(finalizedLines.every(row => JSON.parse(row.snapshotJson).grossPay === Number(row.grossPay)), 'A finalized period cannot contain stale/missing snapshots');
    await payroll.reopenPayroll(periodId, user.id);
    let snapshotWrites = 0;
    const failingDb = {
      $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }) =>
        db.$transaction(tx => run(new Proxy(tx, {
          get(target, key) {
            if (key !== 'payrollLine') return Reflect.get(target, key);
            return new Proxy(target.payrollLine, { get(delegate, method) {
              if (method !== 'update') return Reflect.get(delegate, method);
              return async (args: Prisma.PayrollLineUpdateArgs) => {
                if (++snapshotWrites === 2) throw new Error('Synthetic snapshot storage failure');
                return delegate.update(args);
              };
            } });
          },
        })), options),
    };
    const failingPayroll = loadServerModule<typeof import('../src/app/services/payroll-service')>('src/app/services/payroll-service.ts', { '@/app/lib/prisma': failingDb });
    await assert.rejects(failingPayroll.finalizePayroll(periodId, user.id), /Synthetic snapshot/);
    assert.equal((await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } })).status, 'DRAFT');
    assert.ok((await db.payrollLine.findMany({ where: { periodId } })).every(row => row.snapshotJson === ''), 'A failed finalization rolls back both status and all snapshots');
    assert.ok(await db.auditEvent.count({ where: { targetId: periodId } }) >= 3);
    console.log(`PASS: six-booking cap race; inactive stylist rejected; payroll10employees bulk reads=${payrollReadQueries.length}, finalize/recompute/adjust race and snapshot rollback.`);

    await db.appointment.create({ data: {
      id: 'verify-london-boundary', userId: user.id, stylistId: stylist.id, serviceId: service.id,
      date: new Date('2061-08-31T23:00:00Z'), status: 'COMPLETED', priceAtBooking: 80, durationAtBooking: 60,
    } });
    for (const zone of ['UTC', 'Europe/London', 'Pacific/Auckland']) {
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
        const calendarData = loadServerModule<typeof import('../src/app/services/admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
          '@/app/lib/prisma': { __esModule: true, default: tx, getDatabaseProvider: () => 'postgresql' },
          '@/app/lib/session': { requireAdmin: async () => ({ userId: user.id, role: 'ADMIN' }) },
          './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
        });
        const annual = await calendarData.getAdminCalendarData({ date: '2061-09-01', view: 'year' });
        assert.deepEqual(annual.monthCounts, [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], `London month counts must be independent of PostgreSQL session timezone ${zone}`);
        assert.deepEqual(annual.appointments, []);
      });
    }
    console.log('PASS: actual PostgreSQL year aggregation observes London midnight with UTC/London/Auckland database sessions.');

    const { syncCalendarFeeds } = await import('../src/app/services/calendar-sync-service');
    const connectionRow = await db.calendarConnection.create({ data: { stylistId: stylist.id, provider: 'FRESHA', receivesBookings: true, inboundEnabled: true, inboundUrl: 'https://calendar.example.com/feed.ics' } });
    const now = new Date();
    const icalDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-busy\r\nDTSTART:${icalDate(future(15))}\r\nDTEND:${icalDate(new Date(future(15).getTime() + 3600_000))}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    assert.equal((await syncCalendarFeeds({ db, now, connectionId: connectionRow.id, fetchFeed: async () => feed }))[0].ok, true);
    assert.equal(await db.externalBusyBlock.count({ where: { stylistId: stylist.id } }), 1);
    assert.equal((await syncCalendarFeeds({ db, now, connectionId: connectionRow.id, fetchFeed: async () => { throw new Error('Disconnected'); } }))[0].ok, false);
    assert.equal(await db.externalBusyBlock.count({ where: { stylistId: stylist.id } }), 1, 'A failed import must retain occupied periods');
    await assert.rejects(booking.createBooking({ stylistId: stylist.id, serviceId: service.id, userId: user.id, date: future(15) }), /closed/);
    console.log('PASS: real PostgreSQL booking/worker concurrency, price snapshot, discount rollback, transactional notification queue, calendar reconciliation/failure preservation, and booking readiness gate. No external messages were sent.');
  } finally {
    if (fixturesStarted) {
    await db.auditEvent.deleteMany({ where: { actorUserId: 'verify-user' } });
    await db.payrollLine.deleteMany({ where: { employeeId: { startsWith: 'verify-employee-' } } });
    await db.payrollPeriod.deleteMany({ where: { year: 2026, month: 9 } });
    await db.timeEntry.deleteMany({ where: { employeeId: { startsWith: 'verify-employee-' } } });
    await db.employee.deleteMany({ where: { id: { startsWith: 'verify-employee-' } } });
    await db.notificationDelivery.deleteMany({ where: { appointment: { userId: 'verify-user' } } });
    await db.appointment.deleteMany({ where: { userId: 'verify-user' } });
    await db.calendarConnection.deleteMany({ where: { stylistId: 'verify-stylist' } });
    await db.externalBusyBlock.deleteMany({ where: { stylistId: 'verify-stylist' } });
    await db.availability.deleteMany({ where: { stylistId: 'verify-stylist' } });
    await db.stylist.deleteMany({ where: { id: 'verify-stylist' } });
    await db.service.deleteMany({ where: { id: 'verify-service' } });
    await db.discountCode.deleteMany({ where: { id: 'verify-discount' } });
    await db.user.deleteMany({ where: { id: 'verify-user' } });
    await db.siteSettings.updateMany({ where: { id: 'singleton' }, data: { bookingEnabled: false } });
    await db.backgroundJobState.deleteMany({ where: { name: 'operations-readiness' } });
    }
    await db.$disconnect();
    const globalDb = (await import('../src/app/lib/prisma')).default;
    await globalDb.$disconnect();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Integration check failed'); process.exitCode = 1; });
