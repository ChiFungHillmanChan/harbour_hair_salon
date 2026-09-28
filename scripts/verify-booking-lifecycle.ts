/**
 * Real PostgreSQL lifecycle/calendar checks against an EMPTY disposable database.
 * Run: SALON_TEST_DATABASE_URL=postgresql://...@localhost:.../salon_test \
 *   node --conditions=react-server --import tsx scripts/verify-booking-lifecycle.ts
 *
 * Booking, readiness, notifications, calendar parsing and transactions are real.
 * Session identity, Next cache APIs, provider diagnostics, inbound feed transport,
 * and email rendering/delivery are synthetic. No live provider is contacted.
 * This does not prove that Fresha has subscribed to/polled the website feed.
 */
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { loadServerModule } from '../src/test/load-server-module';
import { resolveSalonDateTime, salonDateKey } from '../src/app/services/salon-time';
import type { AppointmentEmailKind, PreparedEmail } from '../src/app/services/email-service';

async function main() {
  const connection = process.env.SALON_TEST_DATABASE_URL;
  if (!connection) throw new Error('Set SALON_TEST_DATABASE_URL to an empty, migrated localhost salon_test PostgreSQL database.');
  const url = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/salon_test' || url.searchParams.has('host')) {
    throw new Error('Only a disposable localhost PostgreSQL database named salon_test is allowed.');
  }
  Object.assign(process.env, {
    POSTGRES_URL: connection, POSTGRES_URL_NON_POOLING: connection, DATABASE_URL: connection,
    NOTIFICATIONS_ENABLED: 'true', CALENDAR_SYNC_ENABLED: 'true', TREATWELL_API_ENABLED: 'false',
    EMAIL_FROM: 'Synthetic Salon <bookings@example.invalid>', EMAIL_REPLY_TO: 'salon@example.invalid',
    SALON_NOTIFY_EMAIL: 'salon@example.invalid', RESEND_API_KEY: 'synthetic-never-sent',
    CRON_SECRET: 'synthetic-lifecycle-only', KV_REST_API_URL: 'https://synthetic.upstash.io',
    KV_REST_API_TOKEN: 'synthetic-never-sent', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  });
  // Defense in depth: an accidentally unmocked fetch must fail before network I/O.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected network request in isolated lifecycle verification'); };
  const db = new PrismaClient({ datasources: { db: { url: connection } } });
  const ids = { customer: 'lifecycle-customer', other: 'lifecycle-other', admin: 'lifecycle-admin', stylist: 'lifecycle-stylist', service: 'lifecycle-service' };
  const userIds = [ids.customer, ids.other, ids.admin];
  const token = 'synthetic-lifecycle-feed-token';
  const day = (days: number) => salonDateKey(new Date(Date.now() + days * 86_400_000));
  const bookingDay = day(14);
  const instant = (date: string, time: string) => resolveSalonDateTime(date, time).utc;
  const icalDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const icalFeed = (events: { uid: string; start: Date; end: Date }[]) => [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic lifecycle check//EN',
    ...events.flatMap(event => ['BEGIN:VEVENT', `UID:${event.uid}`, `DTSTART:${icalDate(event.start)}`,
      `DTEND:${icalDate(event.end)}`, 'SUMMARY:PRIVATE_FRESHA_CUSTOMER', 'END:VEVENT']),
    'END:VCALENDAR', '',
  ].join('\r\n');
  const sourceEvent = { uid: 'synthetic-fresha-booking', start: instant(bookingDay, '11:00'), end: instant(bookingDay, '12:00') };
  let fixturesStarted = false;
  let previousSettings: Awaited<ReturnType<typeof db.siteSettings.findUnique>> = null;
  let previousDiagnostics: Awaited<ReturnType<typeof db.backgroundJobState.findUnique>> = null;
  try {
    const existing = await Promise.all([
      db.user.count(), db.stylist.count(), db.service.count(), db.appointment.count(),
      db.calendarConnection.count(), db.externalBusyBlock.count(), db.offer.count(), db.discountCode.count(),
    ]);
    assert.ok(existing.every(count => count === 0), 'Use an empty disposable database; existing business data must not be touched.');
    previousSettings = await db.siteSettings.findUnique({ where: { id: 'singleton' } });
    previousDiagnostics = await db.backgroundJobState.findUnique({ where: { name: 'operations-readiness' } });
    fixturesStarted = true;
    await db.siteSettings.upsert({ where: { id: 'singleton' }, create: { bookingEnabled: true }, update: { bookingEnabled: true } });
    await db.user.createMany({ data: [
      { id: ids.customer, name: 'PRIVATE_WEBSITE_CUSTOMER', email: 'customer@example.invalid' },
      { id: ids.other, name: 'Synthetic other customer', email: 'other@example.invalid' },
      { id: ids.admin, name: 'Synthetic administrator', email: 'admin@example.invalid', role: 'ADMIN' },
    ] });
    await db.stylist.create({ data: { id: ids.stylist, name: 'Synthetic Stylist', role: 'Stylist', icalToken: token,
      availabilities: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '18:00', isOff: false })) } } });
    await db.service.create({ data: { id: ids.service, name: 'Synthetic Cut', category: 'Cut', price: 100, duration: 60 } });
    const channel = await db.calendarConnection.create({ data: { stylistId: ids.stylist, provider: 'FRESHA', receivesBookings: true,
      inboundEnabled: true, inboundUrl: 'https://calendar.example.com/synthetic.ics' } });

    // Every query and transaction uses the local database; only framework APIs
    // are replaced because these functions run outside a Next request context.
    const invalidatedTags: string[] = [];
    const revalidatedPaths: string[] = [];
    const afterResponse: (() => unknown | Promise<unknown>)[] = [];
    const nextCache = {
      unstable_cache: <T extends (...args: never[]) => unknown>(read: T) => read,
      revalidatePath: (path: string) => { revalidatedPaths.push(path); },
      updateTag: (tag: string) => { invalidatedTags.push(tag); },
    };
    const maintenance = loadServerModule<typeof import('../src/app/lib/booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
      '@/app/lib/prisma': db, 'next/cache': nextCache,
    });
    const deliveries: { eventKey: string; kind: string; payload: string }[] = [];
    const notifications = loadServerModule<typeof import('../src/app/services/notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
      '@/app/lib/prisma': db,
      './email-service': {
        prepareAppointmentEmail: async (kind: AppointmentEmailKind, appointment: unknown, options: unknown): Promise<PreparedEmail> => ({
          from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: kind, html: JSON.stringify({ appointment, options }),
        }),
        sendPreparedEmail: async (email: PreparedEmail, eventKey: string) => { deliveries.push({ eventKey, kind: email.subject, payload: email.html }); },
      },
    });
    const offers = loadServerModule<typeof import('../src/app/services/offers-service')>('src/app/services/offers-service.ts', {
      '@/app/lib/prisma': db, 'next/cache': nextCache,
    });
    const booking = loadServerModule<typeof import('../src/app/services/booking-service')>('src/app/services/booking-service.ts', {
      '@/app/lib/prisma': db, '@/app/lib/booking-maintenance': maintenance,
      './notification-outbox-service': notifications, './offers-service': offers,
    });
    const icalCache = loadServerModule<typeof import('../src/app/services/stylist-ical-cache')>('src/app/services/stylist-ical-cache.ts', { 'next/cache': nextCache });
    let session = { userId: ids.customer, role: 'USER' };
    const actionDependencies = {
      '@/app/lib/prisma': db,
      '@/app/lib/session': { verifySession: async () => session },
      '@/app/services/booking-service': booking,
      '@/app/services/notification-outbox-service': notifications,
      '@/app/services/stylist-ical-cache': icalCache,
      '@/app/lib/booking-maintenance': maintenance,
      'next/cache': nextCache,
      'next/server': { after: (callback: () => unknown | Promise<unknown>) => { afterResponse.push(callback); } },
    };
    const customerActions = loadServerModule<typeof import('../src/app/actions/booking')>('src/app/actions/booking.ts', actionDependencies);
    // The loader replaces direct imports only. Keep admin.ts's category helper
    // real while also adapting its session/navigation imports outside Next.
    const adminServices = loadServerModule<typeof import('../src/app/actions/admin-services')>('src/app/actions/admin-services.ts', {
      ...actionDependencies,
      'next/navigation': { redirect: (destination: string): never => { throw new Error(`Unexpected redirect to ${destination}`); } },
    });
    const adminActions = loadServerModule<typeof import('../src/app/actions/admin')>('src/app/actions/admin.ts', {
      ...actionDependencies, '@/app/actions/admin-services': adminServices,
    });
    const { syncCalendarFeeds } = await import('../src/app/services/calendar-sync-service');
    const { checkCalendarBookingReadiness } = await import('../src/app/services/integration-readiness');
    const { runOperationsDiagnostics } = await import('../src/app/services/operations-readiness');
    const checks = await runOperationsDiagnostics({ db, fetchImpl: async input => {
      const address = String(input);
      if (address === 'https://api.resend.com/domains?limit=100') return Response.json({ data: [{ name: 'example.invalid', status: 'verified', capabilities: { sending: 'enabled' } }], has_more: false });
      assert.equal(address, 'https://synthetic.upstash.io/ping');
      return Response.json({ result: 'PONG' });
    } });
    assert.ok(checks.every(check => check.status === 'pass'), JSON.stringify(checks));
    const sync = async (text: string) => {
      const result = await syncCalendarFeeds({ db, connectionId: channel.id, fetchFeed: async () => text });
      assert.equal(result.length, 1);
      assert.equal(result[0].ok, true, JSON.stringify(result));
      assert.equal(result[0].skipped, undefined);
      return result[0];
    };
    const readFeed = async () => {
      const result = await icalCache.buildCachedStylistIcalFeed(ids.stylist, token);
      assert.equal(result.status, 200);
      assert.ok('body' in result);
      assert.ok(!result.body.includes('PRIVATE_') && !result.body.includes('@example.invalid'), 'Busy feed must not reveal customer details');
      assert.ok(!result.body.includes(sourceEvent.uid), 'Imported events must not echo back to Fresha');
      return result.body;
    };
    const slotAvailable = async (date: string, time: string) => (await booking.getAvailableSlots(ids.stylist, date, 60)).some(slot => slot.time === time && slot.available);
    const create = (date: string, time: string) => booking.createBooking({ userId: ids.customer, stylistId: ids.stylist, serviceId: ids.service, date: instant(date, time) });
    const assertActionSuccess = async (result: { success?: boolean; error?: string }) => {
      assert.equal(result.success, true, JSON.stringify(result));
      // Simulate Next's post-response phase; database queueing already committed.
      while (afterResponse.length) await afterResponse.shift()!();
    };
    const assertActionError = (result: { success?: boolean; error?: string }, pattern: RegExp) => {
      assert.equal(result.success, false, JSON.stringify(result));
      assert.match(result.error ?? '', pattern);
    };

    await sync(icalFeed([sourceEvent]));
    assert.equal((await checkCalendarBookingReadiness(db)).ready, false, 'Inbound success alone cannot attest to outbound subscription');
    await db.calendarConnection.update({ where: { id: channel.id }, data: { outboundConfirmedAt: new Date() } });
    assert.equal((await checkCalendarBookingReadiness(db)).ready, true);
    assert.equal(await maintenance.isBookingEnabled(), true);
    assert.equal((await icalCache.buildCachedStylistIcalFeed(ids.stylist, 'wrong-token')).status, 404);
    assert.ok(!(await readFeed()).includes('BEGIN:VEVENT'), 'Fresha blocks alone must not appear in the outbound feed');
    for (const time of ['10:30', '11:00', '11:30']) {
      assert.equal(await slotAvailable(bookingDay, time), false, `${time} overlaps the imported busy interval`);
    }
    for (const time of ['10:00', '12:00']) assert.equal(await slotAvailable(bookingDay, time), true, 'Adjacent appointments may touch without overlapping');
    await assert.rejects(create(bookingDay, '11:00'), /no longer available/);
    assert.equal(await db.appointment.count(), 0);
    assert.equal(await db.notificationDelivery.count(), 0);
    console.log('PASS: imported Fresha ICS blocks every overlapping slot and transactional booking, preserves adjacent slots, and is absent from the private outbound feed.');

    const attempts = await Promise.allSettled([create(bookingDay, '10:00'), create(bookingDay, '10:00')]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent requests must reserve the slot only once');
    for (const attempt of attempts) if (attempt.status === 'rejected') assert.match(String(attempt.reason), /no longer available/);
    const appointment = await db.appointment.findFirstOrThrow({ where: { userId: ids.customer } });
    assert.equal(appointment.status, 'PENDING');
    assert.equal(appointment.durationAtBooking, 60);
    assert.equal(Number(appointment.priceAtBooking), 100);
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: appointment.id } }), 2);
    await notifications.dispatchAppointmentNotifications(appointment.id);
    assert.deepEqual(deliveries.map(delivery => delivery.kind).sort(), ['REQUEST_RECEIVED', 'SALON_ALERT']);
    const uid = `UID:${appointment.id}@harbourhair.co.uk`;
    assert.ok((await readFeed()).includes(uid), 'A pending website request must already block the outbound calendar');
    assert.equal(await slotAvailable(bookingDay, '10:00'), false);
    assertActionError(await customerActions.rescheduleAppointment(appointment.id, bookingDay, '14:00'), /Only confirmed/);
    assertActionError(await adminActions.updateAppointmentStatus(appointment.id, 'CONFIRMED'), /Not authorised/);
    session = { userId: ids.other, role: 'USER' };
    assertActionError(await customerActions.cancelAppointment(appointment.id), /not found/);
    session = { userId: ids.admin, role: 'ADMIN' };
    await assertActionSuccess(await adminActions.updateAppointmentStatus(appointment.id, 'CONFIRMED'));
    const confirmed = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.notificationVersion, 1);
    assert.equal(await db.auditEvent.count({ where: { targetId: appointment.id, action: 'APPOINTMENT.STATUS' } }), 1);
    await assertActionSuccess(await adminActions.updateAppointmentStatus(appointment.id, 'CONFIRMED'));
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: appointment.id, kind: 'CONFIRMATION' } }), 1, 'Repeated confirmation must not enqueue another notification');
    assert.equal(deliveries.filter(delivery => delivery.kind === 'CONFIRMATION').length, 1);

    // Live catalogue changes cannot shorten an existing reservation or its emails.
    await db.service.update({ where: { id: ids.service }, data: { price: 999, duration: 30 } });
    session = { userId: ids.other, role: 'USER' };
    assertActionError(await customerActions.rescheduleAppointment(appointment.id, bookingDay, '14:00'), /not found/);
    session = { userId: ids.customer, role: 'USER' };
    assertActionError(await customerActions.rescheduleAppointment(appointment.id, bookingDay, '11:00'), /no longer available/);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).date.getTime(), appointment.date.getTime());
    const invalidationsBeforeMove = invalidatedTags.length;
    await assertActionSuccess(await customerActions.rescheduleAppointment(appointment.id, bookingDay, '14:00'));
    const moved = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(moved.notificationVersion, 2);
    assert.equal(moved.durationAtBooking, 60);
    assert.equal(Number(moved.priceAtBooking), 100);
    assert.equal(moved.date.getTime(), instant(bookingDay, '14:00').getTime());
    assert.ok(invalidatedTags.slice(invalidationsBeforeMove).includes('stylist-ical-feed'));
    const movedFeed = await readFeed();
    assert.ok(movedFeed.includes(uid));
    assert.ok(movedFeed.includes(`DTSTART:${icalDate(instant(bookingDay, '14:00'))}`));
    assert.ok(movedFeed.includes(`DTEND:${icalDate(instant(bookingDay, '15:00'))}`));
    assert.ok(!movedFeed.includes(`DTSTART:${icalDate(appointment.date)}`));
    assert.equal(await slotAvailable(bookingDay, '10:00'), true);
    assert.equal(await slotAvailable(bookingDay, '14:00'), false);
    assert.equal(await slotAvailable(bookingDay, '14:30'), false, 'Frozen duration still occupies the chair after a catalogue duration change');
    const movedEmail = deliveries.find(delivery => delivery.kind === 'RESCHEDULE');
    assert.ok(movedEmail);
    const movedPayload = JSON.parse(movedEmail.payload);
    assert.equal(movedPayload.options.oldDate, appointment.date.toISOString());
    assert.deepEqual(movedPayload.appointment.price, { known: true, amountPence: 10000, priceType: 'STANDARD', vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED' }, 'The moved notice carries the frozen quote, not the new catalogue price');
    assert.equal(movedPayload.appointment.service.duration, 60);
    console.log('PASS: real create → admin confirm → customer reschedule; duplicate/ownership/status guards, idempotent confirmation, audit and notification writes, frozen price/duration, and moved outbound ICS.');

    const closeAppointment = await db.appointment.create({ data: { id: 'lifecycle-within-24h', userId: ids.customer, stylistId: ids.stylist, serviceId: ids.service,
      date: new Date(Date.now() + 12 * 3600_000), status: 'CONFIRMED', durationAtBooking: 60, priceAtBooking: 100 } });
    assertActionError(await customerActions.cancelAppointment(closeAppointment.id), /Cannot cancel within 24 hours/);
    assertActionError(await customerActions.rescheduleAppointment(closeAppointment.id, day(15), '10:00'), /Cannot reschedule within 24 hours/);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: closeAppointment.id } })).status, 'CONFIRMED');
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: closeAppointment.id } }), 0);
    const closePending = await db.appointment.create({ data: { id: 'lifecycle-pending-within-24h', userId: ids.customer, stylistId: ids.stylist, serviceId: ids.service,
      date: new Date(Date.now() + 13 * 3600_000), status: 'PENDING', durationAtBooking: 60, priceAtBooking: 100 } });
    await assertActionSuccess(await customerActions.cancelAppointment(closePending.id));
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: closePending.id } })).status, 'CANCELLED', 'Unconfirmed requests may be withdrawn within 24 hours');
    console.log('PASS: confirmed cancellation/rescheduling are refused within 24 hours; pending withdrawal remains permitted.');

    // Fresha may acquire a slot after the website request but before approval.
    const lateDay = day(16);
    const pending = await create(lateDay, '10:00');
    await notifications.dispatchAppointmentNotifications(pending.id);
    const lateBusy = { uid: 'synthetic-late-fresha-booking', start: instant(lateDay, '10:00'), end: instant(lateDay, '11:00') };
    await sync(icalFeed([sourceEvent, lateBusy]));
    session = { userId: ids.admin, role: 'ADMIN' };
    assertActionError(await adminActions.updateAppointmentStatus(pending.id, 'CONFIRMED'), /no longer available/);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: pending.id } })).status, 'PENDING');
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: pending.id, kind: 'CONFIRMATION' } }), 0);
    session = { userId: ids.customer, role: 'USER' };
    await assertActionSuccess(await customerActions.cancelAppointment(pending.id));

    const beforeFailure = await db.externalBusyBlock.findMany({ orderBy: { externalUid: 'asc' } });
    const failed = await syncCalendarFeeds({ db, connectionId: channel.id, fetchFeed: async () => { throw new Error('Synthetic disconnected feed'); } });
    assert.equal(failed[0].ok, false);
    assert.deepEqual(await db.externalBusyBlock.findMany({ orderBy: { externalUid: 'asc' } }), beforeFailure, 'Failed imports must preserve the exact last-known busy rows');
    assert.equal((await checkCalendarBookingReadiness(db)).ready, false);
    assert.equal(await slotAvailable(bookingDay, '11:00'), false);
    await assert.rejects(create(day(17), '10:00'), /Online booking is closed/);
    assertActionError(await customerActions.rescheduleAppointment(appointment.id, bookingDay, '16:00'), /Online booking is closed/);
    const invalidationsBeforeCancel = invalidatedTags.length;
    await assertActionSuccess(await customerActions.cancelAppointment(appointment.id));
    const cancelled = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.notificationVersion, 3);
    assert.ok(invalidatedTags.slice(invalidationsBeforeCancel).includes('stylist-ical-feed'));
    assert.ok(!(await readFeed()).includes(uid), 'Cancellation removes the website reservation from outbound ICS even while new bookings are closed');
    assertActionError(await customerActions.cancelAppointment(appointment.id), /Only pending or confirmed/);
    assert.equal(await slotAvailable(bookingDay, '14:00'), true);
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: appointment.id, kind: 'CANCELLATION' } }), 1);
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: appointment.id, status: 'SENT', payloadJson: '{}' } }), 5);
    console.log('PASS: approval rechecks newly imported Fresha conflicts; failed import preserves blocks and closes new bookings; cancellation remains available and removes its outbound event.');

    // Reconciliation also frees old times when the provider moves/removes events.
    const movedSource = { ...sourceEvent, start: instant(bookingDay, '12:00'), end: instant(bookingDay, '13:00') };
    await sync(icalFeed([movedSource]));
    assert.equal(await db.externalBusyBlock.count(), 1);
    assert.equal(await slotAvailable(bookingDay, '11:00'), true);
    assert.equal(await slotAvailable(bookingDay, '12:00'), false);
    assert.equal((await checkCalendarBookingReadiness(db)).ready, true);
    await sync(icalFeed([]));
    assert.equal(await db.externalBusyBlock.count(), 0);
    assert.equal(await slotAvailable(bookingDay, '12:00'), true);
    // Pages exist once per language under the internal [locale] segment; both are refreshed.
    for (const path of ['/book', '/appointments', '/admin']) {
      for (const segment of ['/en-gb', '/zh-hk']) assert.ok(revalidatedPaths.includes(`${segment}${path}`), `${segment}${path} must be revalidated`);
    }
    assert.equal(new Set(deliveries.map(delivery => delivery.eventKey)).size, deliveries.length, 'Each notification event is delivered to the synthetic transport once');
    console.log('PASS: successful Fresha move/removal reconciles and frees old slots; all synthetic notification events have unique idempotency keys. No external calls or messages were made.');
  } finally {
    try {
      if (fixturesStarted) {
        await db.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
        await db.notificationDelivery.deleteMany({ where: { appointment: { userId: { in: userIds } } } });
        await db.appointment.deleteMany({ where: { userId: { in: userIds } } });
        await db.calendarConnection.deleteMany({ where: { stylistId: ids.stylist } });
        await db.externalBusyBlock.deleteMany({ where: { stylistId: ids.stylist } });
        await db.availability.deleteMany({ where: { stylistId: ids.stylist } });
        await db.stylist.deleteMany({ where: { id: ids.stylist } });
        await db.service.deleteMany({ where: { id: ids.service } });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
        if (previousSettings) await db.siteSettings.update({ where: { id: 'singleton' }, data: previousSettings });
        else await db.siteSettings.deleteMany({ where: { id: 'singleton' } });
        if (previousDiagnostics) await db.backgroundJobState.update({ where: { name: 'operations-readiness' }, data: previousDiagnostics });
        else await db.backgroundJobState.deleteMany({ where: { name: 'operations-readiness' } });
      }
    } finally {
      await db.$disconnect();
      const globalDb = (await import('../src/app/lib/prisma')).default;
      await globalDb.$disconnect();
      globalThis.fetch = originalFetch;
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
