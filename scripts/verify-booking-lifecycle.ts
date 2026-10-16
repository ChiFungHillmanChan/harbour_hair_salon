/**
 * Real PostgreSQL lifecycle/calendar checks against an EMPTY disposable database.
 * Run: SALON_TEST_DATABASE_URL=postgresql://...@localhost:.../salon_test \
 *   node --conditions=react-server --import tsx scripts/verify-booking-lifecycle.ts
 *
 * Booking, readiness, notifications, calendar parsing and transactions are real.
 * Session identity, Next cache APIs, provider diagnostics, inbound feed transport,
 * email rendering/delivery and Square are synthetic. No live provider is contacted.
 * This does not prove that Fresha has subscribed to/polled the website feed.
 */
import assert from 'node:assert/strict';
import { PrismaClient, type Prisma } from '@prisma/client';
import { loadServerModule } from '../src/test/load-server-module';
import { resolveSalonDateTime, salonDateKey } from '../src/app/services/salon-time';
import { CALENDAR_FRESHNESS_MINUTES } from '../src/app/services/treatwell-sync-coverage';
import type { AppointmentEmailKind, PreparedEmail } from '../src/app/services/email-service';
import { depositForQuote } from '../src/app/services/deposit-quote';
import { SquareGatewayError } from '../src/app/services/square-gateway';
import { createPaymentReconciliation } from '../src/app/services/payment-reconciliation';
import { collectPaymentAttention, pageWindows } from '../src/app/services/payment-attention';
import { refundableRemainderPence, settleRefundOutsideWebsite } from '../src/app/services/payment-refunds';
import { OPERATIONS_MESSAGES } from '../src/app/services/operations-messages';
import { CONFIG as SQUARE_S4_CONFIG, fakeSquare, paymentEvent, refundEvent, sign } from '../src/test/payments-fixture';

type RaceMode = 'withdraw-commits-first' | 'approve-writes-first';
type RaceSide = 'approve' | 'withdraw';

/** Resolve after `ms`, so a broken interleaving fails loudly instead of hanging. */
const settleWithin = (promise: Promise<unknown>, ms: number) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Wraps a PrismaClient so the reschedule race can force two real, overlapping
 * Serializable transactions. Only each side's FIRST write to the armed
 * appointment is gated; retries run freely. A transaction is the APPROVAL if
 * its first call on that appointment is `findUnique` (decideRescheduleRequest
 * re-reads inside its transaction) and the WITHDRAW if it is `updateMany`
 * (withdrawRescheduleRequest reads before its transaction).
 */
function createRaceController(db: PrismaClient) {
  let armed: { id: string; mode: RaceMode } | null = null;
  let failures: RaceSide[] = [];
  let gated = new Set<RaceSide>();
  let approveRead = deferred(), approveWrote = deferred(), withdrawIssued = deferred(), withdrawSettled = deferred();

  /** The approval's first write: wait for the withdraw to commit, or write and then stay uncommitted while it queues. */
  async function approveWrite(write: () => Promise<unknown>, mode: RaceMode) {
    if (mode === 'withdraw-commits-first') {
      await settleWithin(withdrawSettled.promise, 4_000);
      return write();
    }
    const result = await write();
    approveWrote.resolve();
    await settleWithin(withdrawIssued.promise, 4_000);
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the withdraw's UPDATE reach the row lock
    return result;
  }

  /** The withdraw's first write: only after the approval has read (or written) the row. */
  async function withdrawWrite(write: () => Promise<unknown>, mode: RaceMode) {
    await settleWithin(mode === 'withdraw-commits-first' ? approveRead.promise : approveWrote.promise, 4_000);
    withdrawIssued.resolve();
    return write();
  }

  const raceDb = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop !== '$transaction') return typeof value === 'function' ? value.bind(target) : value;
      return async (fn: (tx: unknown) => Promise<unknown>, options?: Parameters<PrismaClient['$transaction']>[1]) => {
        let side: RaceSide | undefined;
        try {
          return await target.$transaction(async (tx) => {
            const appointment = new Proxy(tx.appointment, {
              get(delegate, method) {
                const original = Reflect.get(delegate, method) as unknown;
                if (typeof original !== 'function') return original;
                const call = (original as (args: unknown) => Promise<unknown>).bind(delegate);
                if (method !== 'findUnique' && method !== 'updateMany') return call;
                return async (args: { where?: { id?: string } }) => {
                  const run = armed;
                  if (!run || args?.where?.id !== run.id) return call(args);
                  side ??= method === 'findUnique' ? 'approve' : 'withdraw';
                  if (method === 'findUnique') {
                    const row = await call(args);
                    approveRead.resolve();
                    return row;
                  }
                  if (gated.has(side)) return call(args);
                  gated.add(side);
                  return side === 'approve' ? approveWrite(() => call(args), run.mode) : withdrawWrite(() => call(args), run.mode);
                };
              },
            });
            return fn(new Proxy(tx, {
              get(client, key) {
                if (key === 'appointment') return appointment;
                const member = Reflect.get(client, key);
                return typeof member === 'function' ? member.bind(client) : member;
              },
            }));
          }, options);
        } catch (error) {
          if (armed && side && (error as { code?: string }).code === 'P2034') failures.push(side);
          throw error;
        } finally {
          if (side === 'withdraw') withdrawSettled.resolve();
        }
      };
    },
  });

  return {
    db: raceDb,
    arm(id: string, mode: RaceMode) {
      armed = { id, mode };
      failures = [];
      gated = new Set();
      approveRead = deferred(); approveWrote = deferred(); withdrawIssued = deferred(); withdrawSettled = deferred();
    },
    disarm() {
      armed = null;
      return { serializationFailures: [...failures] };
    },
  };
}

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
      // Managing a booking online needs a proved address (security review 2026-10-16).
      { id: ids.customer, name: 'PRIVATE_WEBSITE_CUSTOMER', email: 'customer@example.invalid', emailVerifiedAt: new Date() },
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
      // The cron flavour (invalidateStylistIcalFeedFromCron), used by the lapse step.
      revalidateTag: (tag: string) => { invalidatedTags.push(tag); },
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
      // A server action always runs inside a request: the client address it reads (deposit decline budget).
      'next/headers': { headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.50' }) },
    };
    // The lifecycle makes more real requests for one booking than the production
    // per-appointment/per-customer caps allow (and Redis is intentionally absent);
    // those caps have their own tests, so lift just these two limiters here.
    const realRateLimit = await import('../src/app/lib/rate-limit');
    const unlimited = { check: async () => true };
    const customerActions = loadServerModule<typeof import('../src/app/actions/booking')>('src/app/actions/booking.ts', {
      ...actionDependencies,
      '@/app/lib/rate-limit': { ...realRateLimit, rescheduleLimiter: unlimited, appointmentRescheduleLimiter: unlimited, cancelLimiter: unlimited },
    });
    // The loader replaces direct imports only. Keep admin.ts's category helper
    // real while also adapting its session/navigation imports outside Next.
    const adminServices = loadServerModule<typeof import('../src/app/actions/admin-services')>('src/app/actions/admin-services.ts', {
      ...actionDependencies,
      'next/navigation': { redirect: (destination: string): never => { throw new Error(`Unexpected redirect to ${destination}`); } },
    });
    const adminActions = loadServerModule<typeof import('../src/app/actions/admin')>('src/app/actions/admin.ts', {
      ...actionDependencies, '@/app/actions/admin-services': adminServices,
    });
    // The race below needs two actions in flight at once, so these instances read
    // a FIXED session instead of the shared mutable `session` variable, and run
    // their transactions through `race`, which can hold one transaction open
    // while the other commits (see createRaceController).
    const race = createRaceController(db);
    const raceBooking = loadServerModule<typeof import('../src/app/services/booking-service')>('src/app/services/booking-service.ts', {
      '@/app/lib/prisma': race.db, '@/app/lib/booking-maintenance': maintenance,
      './notification-outbox-service': notifications, './offers-service': offers,
    });
    const fixedCustomer = loadServerModule<typeof import('../src/app/actions/booking')>('src/app/actions/booking.ts', {
      ...actionDependencies, '@/app/services/booking-service': raceBooking,
      '@/app/lib/session': { verifySession: async () => ({ userId: ids.customer, role: 'USER' }) },
      '@/app/lib/rate-limit': { ...realRateLimit, rescheduleLimiter: unlimited, appointmentRescheduleLimiter: unlimited, cancelLimiter: unlimited },
    });
    const fixedAdmin = loadServerModule<typeof import('../src/app/actions/admin')>('src/app/actions/admin.ts', {
      ...actionDependencies, '@/app/services/booking-service': raceBooking,
      '@/app/lib/session': { verifySession: async () => ({ userId: ids.admin, role: 'ADMIN' }) },
      '@/app/actions/admin-services': adminServices,
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

    // The same customer's request twice at once (a lost answer, a second tap) is
    // one request: both calls return the booking it made.
    const attempts = await Promise.allSettled([create(bookingDay, '10:00'), create(bookingDay, '10:00')]);
    assert.ok(attempts.every(result => result.status === 'fulfilled'), attempts.map(result => result.status === 'rejected' ? String(result.reason) : 'fulfilled').join('; '));
    assert.equal(new Set(attempts.map(result => result.status === 'fulfilled' ? result.value.id : null)).size, 1, 'A repeated request returns the booking already made');
    assert.equal(await db.appointment.count(), 1, 'Concurrent requests must reserve the slot only once');
    // Two different customers racing for one free slot: only one can have it.
    const rivals = await Promise.allSettled([ids.other, ids.admin].map(userId =>
      booking.createBooking({ userId, stylistId: ids.stylist, serviceId: ids.service, date: instant(day(19), '10:00') })));
    assert.equal(rivals.filter(result => result.status === 'fulfilled').length, 1, 'Concurrent requests from different customers must reserve the slot only once');
    for (const rival of rivals) if (rival.status === 'rejected') assert.match(String(rival.reason), /no longer available/);
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
    assertActionError(await customerActions.requestReschedule(appointment.id, bookingDay, '14:00'), /Only confirmed/);
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
    assertActionError(await customerActions.requestReschedule(appointment.id, bookingDay, '14:00'), /not found/);
    session = { userId: ids.customer, role: 'USER' };
    assertActionError(await customerActions.requestReschedule(appointment.id, bookingDay, '11:00'), /no longer available/);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).date.getTime(), appointment.date.getTime());
    const invalidationsBeforeMove = invalidatedTags.length;
    await assertActionSuccess(await customerActions.requestReschedule(appointment.id, bookingDay, '14:00'));
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).date.getTime(), appointment.date.getTime(), 'A request leaves the booking at its original time');
    session = { userId: ids.admin, role: 'ADMIN' };
    const open = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await assertActionSuccess(await adminActions.decideRescheduleRequest(appointment.id, 'APPROVE', open.rescheduleRequestedAt!.toISOString()));
    session = { userId: ids.customer, role: 'USER' };
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
    // Request → withdraw.
    await assertActionSuccess(await customerActions.requestReschedule(appointment.id, day(16), '10:00'));
    await assertActionSuccess(await customerActions.withdrawRescheduleRequest(appointment.id));
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).rescheduleRequestedAt, null);

    // Request → a Fresha import now covers the requested time → approval refused → decline keeps the original.
    const before = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await assertActionSuccess(await customerActions.requestReschedule(appointment.id, day(16), '11:00'));
    const requested = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await syncCalendarFeeds({ db, connectionId: channel.id, fetchFeed: async () => icalFeed([sourceEvent, { uid: 'fresha-takes-it', start: instant(day(16), '11:00'), end: instant(day(16), '12:00') }]) });
    session = { userId: ids.admin, role: 'ADMIN' };
    assertActionError(await adminActions.decideRescheduleRequest(appointment.id, 'APPROVE', requested.rescheduleRequestedAt!.toISOString()), /no longer free/);
    await assertActionSuccess(await adminActions.decideRescheduleRequest(appointment.id, 'DECLINE', requested.rescheduleRequestedAt!.toISOString()));
    session = { userId: ids.customer, role: 'USER' };
    const declined = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(declined.date.getTime(), before.date.getTime());
    assert.equal(declined.rescheduleRequestedAt, null);
    assert.ok(await db.notificationDelivery.count({ where: { appointmentId: appointment.id, kind: 'RESCHEDULE_DECLINED' } }) >= 1, 'Declining queues a RESCHEDULE_DECLINED notice');

    // Approve racing withdraw with BOTH transactions open at once. Left to
    // timing, the approval's calendar refresh made the withdraw commit before the
    // approval's transaction even began, so the two never overlapped. The race
    // controller forces each interleaving instead, and the run then proves the
    // overlap was real: PostgreSQL must reject the loser's first attempt with a
    // serialization failure (P2034), which the retry turns into "has changed".
    //  - 'withdraw-commits-first': the approval has read the open request, then
    //    waits while the withdraw commits; its own write must then fail.
    //  - 'approve-writes-first': the approval has written (uncommitted) when the
    //    withdraw's write arrives and blocks; the approval commits and the
    //    withdraw must fail.
    const raceWins = { approve: 0, withdraw: 0 };
    const raceModes = ['withdraw-commits-first', 'approve-writes-first', 'withdraw-commits-first', 'approve-writes-first'] as const;
    for (const [round, mode] of raceModes.entries()) {
      const target = day(21 + round * 7);
      const preRace = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      const rescheduleNotices = () => db.notificationDelivery.count({ where: { appointmentId: appointment.id, kind: 'RESCHEDULE' } });
      const noticesBefore = await rescheduleNotices();
      const asked = await fixedCustomer.requestReschedule(appointment.id, target, '10:00');
      await assertActionSuccess(asked);
      const racing = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      const requestedAt = racing.rescheduleRequestedAt!;
      race.arm(appointment.id, mode);
      const [approve, withdraw] = await Promise.all([
        fixedAdmin.decideRescheduleRequest(appointment.id, 'APPROVE', requestedAt.toISOString()),
        fixedCustomer.withdrawRescheduleRequest(appointment.id),
      ]);
      const observed = race.disarm();
      while (afterResponse.length) await afterResponse.shift()!();
      const expectedWinner = mode === 'withdraw-commits-first' ? 'withdraw' : 'approve';
      const expectedLoser = expectedWinner === 'withdraw' ? 'approve' : 'withdraw';
      assert.deepEqual(observed.serializationFailures, [expectedLoser], `${mode}: the database must reject exactly the loser's first attempt (${JSON.stringify(observed)})`);
      assert.equal([approve, withdraw].filter((outcome) => outcome.success).length, 1, JSON.stringify({ mode, approve, withdraw }));
      assert.equal((expectedWinner === 'approve' ? approve : withdraw).success, true, `${mode}: ${JSON.stringify({ approve, withdraw })}`);
      const loser = approve.success ? withdraw : approve;
      assert.match((loser as { error?: string }).error ?? '', /has changed|refresh/i, JSON.stringify(loser));
      assert.doesNotMatch((loser as { error?: string }).error ?? '', /not found/i);
      const after = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      assert.equal(after.rescheduleRequestedAt, null);
      assert.equal(after.rescheduleRequestedDate, null);
      if (approve.success) {
        raceWins.approve += 1;
        assert.equal(after.date.getTime(), instant(target, '10:00').getTime());
        assert.equal(await rescheduleNotices(), noticesBefore + 1);
      } else {
        raceWins.withdraw += 1;
        assert.equal(after.date.getTime(), preRace.date.getTime());
        assert.equal(await rescheduleNotices(), noticesBefore, 'A withdrawn request must not send a moved notice');
      }
    }
    assert.deepEqual(raceWins, { approve: 2, withdraw: 2 });
    console.log(`race wins (both transactions open at once, P2034 on the loser every round): ${JSON.stringify(raceWins)}`);

    // Deterministic, non-concurrent: approval has fully committed, so a late withdraw must lose.
    {
      const target = day(49); // after the race rounds (days 21–42)
      const rescheduleNotices = () => db.notificationDelivery.count({ where: { appointmentId: appointment.id, kind: 'RESCHEDULE' } });
      const noticesBefore = await rescheduleNotices();
      await assertActionSuccess(await fixedCustomer.requestReschedule(appointment.id, target, '10:00'));
      const open = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      const approved = await fixedAdmin.decideRescheduleRequest(appointment.id, 'APPROVE', open.rescheduleRequestedAt!.toISOString());
      await assertActionSuccess(approved);
      const late = await fixedCustomer.withdrawRescheduleRequest(appointment.id);
      while (afterResponse.length) await afterResponse.shift()!();
      assert.equal(late.success, false, JSON.stringify(late));
      assert.match((late as { error?: string }).error ?? '', /has changed|refresh/i, JSON.stringify(late));
      assert.doesNotMatch((late as { error?: string }).error ?? '', /not found/i);
      const after = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      assert.equal(after.date.getTime(), instant(target, '10:00').getTime());
      assert.equal(after.rescheduleRequestedAt, null);
      assert.equal(after.rescheduleRequestedDate, null);
      assert.equal(await rescheduleNotices(), noticesBefore + 1);
    }

    console.log('PASS: real create → admin confirm → customer reschedule request → staff approval; duplicate/ownership/status guards, idempotent confirmation, audit and notification writes, frozen price/duration, and moved outbound ICS.');

    const closeAppointment = await db.appointment.create({ data: { id: 'lifecycle-within-24h', userId: ids.customer, stylistId: ids.stylist, serviceId: ids.service,
      date: new Date(Date.now() + 12 * 3600_000), status: 'CONFIRMED', durationAtBooking: 60, priceAtBooking: 100 } });
    assertActionError(await customerActions.cancelAppointment(closeAppointment.id), /Cannot cancel within 24 hours/);
    assertActionError(await customerActions.requestReschedule(closeAppointment.id, day(15), '10:00'), /Cannot reschedule within 24 hours/);
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: closeAppointment.id } })).status, 'CONFIRMED');
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: closeAppointment.id } }), 0);
    const closePending = await db.appointment.create({ data: { id: 'lifecycle-pending-within-24h', userId: ids.customer, stylistId: ids.stylist, serviceId: ids.service,
      date: new Date(Date.now() + 13 * 3600_000), status: 'PENDING', durationAtBooking: 60, priceAtBooking: 100 } });
    await assertActionSuccess(await customerActions.cancelAppointment(closePending.id));
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: closePending.id } })).status, 'CANCELLED', 'Unconfirmed requests may be withdrawn within 24 hours');
    console.log('PASS: confirmed cancellation/rescheduling are refused within 24 hours; pending withdrawal remains permitted.');

    // Card deposits (phase S2): a customer's request authorizes a Square hold
    // that the real Serializable booking transaction ties to the appointment;
    // the same submission or the same request never takes a second hold, and a
    // booking that cannot be made releases its own. Square itself is a fake.
    {
      const squareCalls = { authorize: [] as { referenceId: string; amountPence: number }[], cancel: [] as { referenceId: string }[], cancelByKey: [] as string[] };
      let beforeApproval: (() => Promise<void>) | null = null;
      let decline = false;
      const fakeSquare = {
        authorize: async (input: { amountPence: number; referenceId: string }) => {
          squareCalls.authorize.push(input);
          await beforeApproval?.();
          if (decline) throw new SquareGatewayError('provider_error', 402);
          return {
            id: `synthetic-payment-${input.referenceId}`, status: 'APPROVED' as const, amount_money: { amount: input.amountPence, currency: 'GBP' as const },
            location_id: 'synthetic-location', source_type: 'CARD' as const, reference_id: input.referenceId,
            delay_action: 'CANCEL' as const, delayed_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          };
        },
        cancel: async (input: { paymentId: string; amountPence: number; referenceId: string }) => {
          squareCalls.cancel.push(input);
          return { id: input.paymentId, status: 'CANCELED' as const, amount_money: { amount: input.amountPence, currency: 'GBP' as const }, location_id: 'synthetic-location', source_type: 'CARD' as const, reference_id: input.referenceId };
        },
        cancelByIdempotencyKey: async (key: string) => { squareCalls.cancelByKey.push(key); },
      };
      const depositCustomer = loadServerModule<typeof import('../src/app/actions/booking')>('src/app/actions/booking.ts', {
        ...actionDependencies,
        '@/app/lib/session': { verifySession: async () => ({ userId: ids.other, role: 'USER' }) },
        '@/app/lib/rate-limit': { ...realRateLimit, bookingLimiter: unlimited, bookingDailyLimiter: unlimited },
        '@/app/services/square-gateway': { createSquareGateway: () => fakeSquare },
        '@/app/lib/online-booking-lock': {
          usableSquareConfig: () => ({ environment: 'sandbox', accessToken: 'synthetic-never-sent', applicationId: 'sandbox-sq0idb-synthetic', locationId: 'synthetic-location', webhookSignatureKey: 'synthetic', webhookNotificationUrl: 'https://example.invalid/api/webhooks/square' }),
        },
      });
      await db.user.update({ where: { id: ids.other }, data: { emailVerifiedAt: new Date() } });
      await db.siteSettings.update({ where: { id: 'singleton' }, data: { depositsEnabled: true, depositPercent: 20, depositMinimumServicePence: 0 } });
      const priced = await db.service.findUniqueOrThrow({ where: { id: ids.service } });
      const amountPence = Math.round(Number(priced.price) * 100);
      const depositPence = depositForQuote({ quoteAmountPence: amountPence, settings: { depositsEnabled: true, depositPercent: 20, depositMinimumServicePence: 0 }, overridePence: null }).depositPence;
      assert.ok(depositPence > 0);
      const depositDay = day(23);
      const submitDeposit = (time: string, attemptKey: string) => depositCustomer.submitBooking({
        stylistId: ids.stylist, serviceId: ids.service, date: depositDay, time, attemptKey, paymentToken: `cnon:synthetic-${attemptKey}`,
        expectedQuote: { serviceId: ids.service, priceVersion: priced.priceVersion, amountPence }, expectedDepositPence: depositPence,
      });
      const attempt = (attemptKey: string) => db.paymentAttempt.findUnique({ where: { userId_attemptKey: { userId: ids.other, attemptKey } } });
      const requestAt = (time: string) => db.appointment.findMany({ where: { userId: ids.other, date: instant(depositDay, time), status: { in: ['PENDING', 'CONFIRMED'] } } });

      // Authorized, and linked to the new request in the booking transaction.
      const first = '0f8fad5b-d9cb-469f-a165-70867728950e';
      await assertActionSuccess(await submitDeposit('10:00', first));
      const [booked] = await requestAt('10:00');
      const held = await attempt(first);
      assert.equal(held?.status, 'AUTHORIZED');
      assert.equal(held?.appointmentId, booked.id);
      assert.equal(held?.amountPence, depositPence);
      assert.equal(held?.idempotencyKey, `dep_${first.replace(/-/g, '')}`);
      // Delivered after the response (its stored payload is then scrubbed): the email was built with the hold.
      const receipt = deliveries.find((delivery) => delivery.eventKey === `appointment/${booked.id}/0/REQUEST_RECEIVED`);
      assert.ok(receipt, 'the request receipt was sent');
      assert.deepEqual(JSON.parse(receipt.payload).appointment.deposit, { amountPence: depositPence, status: 'AUTHORIZED' }, 'the receipt mentions the hold');
      // The same submission again: its outcome, never a second authorization —
      // already requested, with the hold that same submission placed.
      assert.deepEqual(await submitDeposit('10:00', first), { success: true, alreadyRequested: true, depositHeldPence: depositPence });
      assert.equal(squareCalls.authorize.length, 1);

      // The same request twice at once with two card tokens: one booking, one hold kept.
      const copies = ['7c9e6679-7425-40de-944b-e07fc1f90ae7', '16fd2706-8baf-433b-82eb-8c7fada847da'];
      const answers = await Promise.all(copies.map((key) => submitDeposit('11:00', key)));
      for (const answer of answers) await assertActionSuccess(answer);
      assert.deepEqual(answers.map((answer) => answer.success && answer.alreadyRequested === true).sort(), [false, true], `one new request, one repeat: ${JSON.stringify(answers)}`);
      const repeated = await requestAt('11:00');
      assert.equal(repeated.length, 1, 'one appointment for the request');
      const copyAttempts = (await Promise.all(copies.map(attempt))).filter((row) => row !== null);
      assert.deepEqual(copyAttempts.filter((row) => row.appointmentId === repeated[0].id).map((row) => row.status), ['AUTHORIZED'], 'exactly one hold is tied to it');
      const released = copyAttempts.filter((row) => row.appointmentId === null);
      assert.ok(released.every((row) => row.status === 'VOIDED' && row.voidedAt !== null), JSON.stringify(released));
      assert.equal(squareCalls.cancel.length, released.length, 'every second hold was released');

      // The time is taken between the pre-check and the transaction: nothing is booked and the hold is released.
      const lost = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
      beforeApproval = async () => {
        beforeApproval = null;
        await db.appointment.create({ data: { userId: ids.admin, stylistId: ids.stylist, serviceId: ids.service, date: instant(depositDay, '13:00'), status: 'PENDING', durationAtBooking: 60, priceAtBooking: 100 } });
      };
      const taken = await submitDeposit('13:00', lost);
      assert.equal(taken.success, false);
      assert.equal(!taken.success && taken.code, 'SLOT_UNAVAILABLE', JSON.stringify(taken));
      assert.deepEqual(await requestAt('13:00'), []);
      const lostAttempt = await attempt(lost);
      assert.equal(lostAttempt?.status, 'VOIDED');
      assert.equal(lostAttempt?.appointmentId, null);
      assert.equal(squareCalls.cancel.at(-1)?.referenceId, lostAttempt?.id);

      // A declined card books nothing.
      const declined = '9b2c7f1e-3a4d-4e5f-8a6b-7c8d9e0f1a2b';
      decline = true;
      const refused = await submitDeposit('15:00', declined);
      decline = false;
      assert.equal(!refused.success && refused.code, 'CARD_DECLINED', JSON.stringify(refused));
      assert.equal((await attempt(declined))?.status, 'FAILED');
      assert.deepEqual(await requestAt('15:00'), []);
      assert.deepEqual(squareCalls.cancelByKey, [], 'no unknown outcome here');

      await db.siteSettings.update({ where: { id: 'singleton' }, data: { depositsEnabled: false } });
      while (afterResponse.length) await afterResponse.shift()!();
      console.log(`PASS: card deposits — authorized hold linked in the booking transaction, replayed submission and concurrent repeat take one hold (second hold ${released.length ? 'authorized, then released' : 'never taken'}), a slot lost after authorization releases it, a declined card books nothing. Square was a fake.`);
    }

    // Card deposits, phase S3: staff confirming a request TAKE its deposit
    // (capture), declining or lapsing it RELEASE the hold, cancelling a
    // confirmed booking REFUNDS it — or staff keep it. Real Serializable
    // transactions, Prisma queries (the lapse step's relation filters
    // included) and outbox; Square is a fake that behaves like Square: a hold
    // stays APPROVED until it is captured (COMPLETED) or cancelled, and a
    // capture needs the payment's current version token.
    {
      type S3Payment = { status: 'APPROVED' | 'COMPLETED' | 'CANCELED'; amount: number; referenceId: string; version: number };
      const squareS3 = new Map<string, S3Payment>();
      const s3Calls = { getPayment: [] as string[], capture: [] as string[], cancel: [] as string[], refund: [] as { idempotencyKey: string; amountPence: number }[] };
      let afterCapture: (() => Promise<void>) | null = null;
      let holdSquare: Promise<unknown> | null = null;
      const asPayment = (id: string) => {
        const state = squareS3.get(id);
        if (!state) throw new SquareGatewayError('provider_error', 404);
        return {
          id, status: state.status, amount_money: { amount: state.amount, currency: 'GBP' as const }, location_id: 'synthetic-location', source_type: 'CARD' as const,
          reference_id: state.referenceId, version_token: `v${state.version}`, delay_action: 'CANCEL' as const, delayed_until: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        };
      };
      const fakeSquareS3 = {
        getPayment: async (id: string) => {
          s3Calls.getPayment.push(id);
          await holdSquare;
          return asPayment(id);
        },
        capture: async (input: { paymentId: string; versionToken: string }) => {
          s3Calls.capture.push(input.paymentId);
          const state = squareS3.get(input.paymentId);
          if (!state || state.status !== 'APPROVED' || input.versionToken !== `v${state.version}`) throw new SquareGatewayError('provider_error', 400);
          state.status = 'COMPLETED';
          state.version++;
          const hook = afterCapture;
          afterCapture = null;
          await hook?.();
          return asPayment(input.paymentId);
        },
        cancel: async (input: { paymentId: string }) => {
          s3Calls.cancel.push(input.paymentId);
          const state = squareS3.get(input.paymentId);
          if (!state || state.status !== 'APPROVED') throw new SquareGatewayError('provider_error', 400);
          state.status = 'CANCELED';
          state.version++;
          return asPayment(input.paymentId);
        },
        refund: async (input: { paymentId: string; amountPence: number; idempotencyKey: string }) => {
          s3Calls.refund.push({ idempotencyKey: input.idempotencyKey, amountPence: input.amountPence });
          return {
            id: `synthetic-refund-${input.idempotencyKey}`, payment_id: input.paymentId, location_id: 'synthetic-location', status: 'PENDING' as const,
            amount_money: { amount: input.amountPence, currency: 'GBP' as const },
          };
        },
      };
      const syntheticConfig = {
        environment: 'sandbox' as const, accessToken: 'synthetic-never-sent', applicationId: 'sandbox-sq0idb-synthetic', locationId: 'synthetic-location',
        webhookSignatureKey: 'synthetic', webhookNotificationUrl: 'https://example.invalid/api/webhooks/square',
      };
      const depositLifecycle = loadServerModule<typeof import('../src/app/services/deposit-lifecycle')>('src/app/services/deposit-lifecycle.ts', {
        '@/app/lib/online-booking-lock': { usableSquareConfig: () => syntheticConfig },
        './square-gateway': { createSquareGateway: () => fakeSquareS3 },
      });
      let beforeApprovalTransaction: (() => Promise<void>) | null = null;
      const depositAdmin = loadServerModule<typeof import('../src/app/actions/admin')>('src/app/actions/admin.ts', {
        ...actionDependencies, '@/app/actions/admin-services': adminServices,
        '@/app/services/deposit-lifecycle': depositLifecycle,
        '@/app/lib/session': { verifySession: async () => ({ userId: ids.admin, role: 'ADMIN' }) },
        // The feeds were imported moments ago; this hook lets two approvals overlap.
        '@/app/services/calendar-sync-service': { refreshCalendarFeedsBeforeApproval: async () => { await beforeApprovalTransaction?.(); return []; } },
      });
      const depositOwner = loadServerModule<typeof import('../src/app/actions/booking')>('src/app/actions/booking.ts', {
        ...actionDependencies, '@/app/services/deposit-lifecycle': depositLifecycle,
        '@/app/lib/session': { verifySession: async () => ({ userId: ids.other, role: 'USER' }) },
        '@/app/lib/rate-limit': { ...realRateLimit, rescheduleLimiter: unlimited, appointmentRescheduleLimiter: unlimited, cancelLimiter: unlimited },
      });
      const lapse = loadServerModule<typeof import('../src/app/services/pending-request-lapse')>('src/app/services/pending-request-lapse.ts', {
        '@/app/lib/prisma': db, './booking-service': booking, './notification-outbox-service': notifications,
        './stylist-ical-cache': icalCache, './deposit-lifecycle': depositLifecycle,
      });
      let s3Sequence = 0;
      /** The other customer's request (or booking) holding a £20 deposit, as S2 leaves it; Square knows the payment. */
      const withDeposit = async (date: Date, options: { status?: string; attempt?: string; delayedUntil?: Date; announced?: boolean } = {}) => {
        const n = ++s3Sequence;
        const appointment = await db.appointment.create({ data: {
          userId: ids.other, stylistId: ids.stylist, serviceId: ids.service, date, status: options.status ?? 'PENDING',
          durationAtBooking: 60, priceAtBooking: 100, notificationLocale: 'en-GB',
        } });
        const paymentId = `synthetic-s3-payment-${n}`;
        const attempt = await db.paymentAttempt.create({ data: {
          userId: ids.other, attemptKey: `s3-attempt-${n}`, idempotencyKey: `dep_s3_${n}`, appointmentId: appointment.id, status: options.attempt ?? 'AUTHORIZED',
          environment: 'sandbox', locationId: 'synthetic-location', amountPence: 2000, quoteAmountPence: 10000, policyJson: '{}', requestJson: '{}',
          squarePaymentId: paymentId, delayedUntil: options.delayedUntil ?? new Date(Date.now() + 5 * 86_400_000), authorizedAt: new Date(),
          ...(options.attempt === 'CAPTURED' ? { capturedAt: new Date() } : {}),
        } });
        squareS3.set(paymentId, { status: options.attempt === 'CAPTURED' ? 'COMPLETED' : 'APPROVED', amount: 2000, referenceId: attempt.id, version: 1 });
        if (options.announced) {
          await db.notificationDelivery.create({ data: { eventKey: `appointment/${appointment.id}/0/REQUEST_RECEIVED`, appointmentId: appointment.id, kind: 'REQUEST_RECEIVED', payloadJson: '{}', status: 'SENT' } });
        }
        return { appointment, attempt, paymentId };
      };
      const attemptOf = (id: string) => db.paymentAttempt.findUniqueOrThrow({ where: { id } });
      const statusOf = async (id: string) => (await db.appointment.findUniqueOrThrow({ where: { id } })).status;
      /** What the synthetic transport was asked to send for this booking's notice (its snapshot and options). */
      const sentNotice = (appointmentId: string, version: number, kind: string) => {
        const sent = deliveries.find((delivery) => delivery.eventKey === `appointment/${appointmentId}/${version}/${kind}`);
        assert.ok(sent, `${kind} was sent for ${appointmentId}`);
        return JSON.parse(sent.payload) as { appointment: { deposit: unknown }; options: Record<string, unknown> };
      };
      const day51 = day(51);
      const day52 = day(52);

      // Confirming takes the deposit: CONFIRMED and CAPTURED in one transaction; the confirmation says so.
      const first = await withDeposit(instant(day51, '10:00'));
      await assertActionSuccess(await depositAdmin.updateAppointmentStatus(first.appointment.id, 'CONFIRMED'));
      assert.equal(await statusOf(first.appointment.id), 'CONFIRMED');
      const captured = await attemptOf(first.attempt.id);
      assert.equal(captured.status, 'CAPTURED');
      assert.ok(captured.capturedAt instanceof Date);
      assert.equal(captured.lastError, null);
      assert.deepEqual(s3Calls.capture, [first.paymentId]);
      assert.equal(squareS3.get(first.paymentId)?.status, 'COMPLETED');
      assert.deepEqual(sentNotice(first.appointment.id, 1, 'CONFIRMATION').appointment.deposit, { amountPence: 2000, status: 'CAPTURED' });
      await assertActionSuccess(await depositAdmin.updateAppointmentStatus(first.appointment.id, 'CONFIRMED'));
      assert.equal(s3Calls.capture.length, 1, 'confirming again takes nothing');

      // Two staff confirming at once: both pass the check before the transaction, both
      // claiming transactions are real and overlap; the winner waits at Square until
      // the other has its answer. One capture, one confirmation.
      const raced = await withDeposit(instant(day51, '12:00'));
      let arrivals = 0;
      let bothChecked!: () => void;
      const checked = new Promise<void>((resolve) => { bothChecked = resolve; });
      beforeApprovalTransaction = async () => { if (++arrivals === 2) bothChecked(); await checked; };
      const racing = [1, 2].map(() => depositAdmin.updateAppointmentStatus(raced.appointment.id, 'CONFIRMED'));
      holdSquare = Promise.race(racing);
      const outcomes = await Promise.all(racing);
      beforeApprovalTransaction = null;
      holdSquare = null;
      while (afterResponse.length) await afterResponse.shift()!();
      assert.equal(outcomes.filter((outcome) => outcome.success).length, 1, JSON.stringify(outcomes));
      assert.match((outcomes.find((outcome) => !outcome.success) as { error?: string }).error ?? '', /being processed/, JSON.stringify(outcomes));
      assert.equal(s3Calls.capture.filter((id) => id === raced.paymentId).length, 1, 'the deposit is taken once');
      assert.equal((await attemptOf(raced.attempt.id)).status, 'CAPTURED');
      assert.equal(await statusOf(raced.appointment.id), 'CONFIRMED');
      assert.equal(await db.notificationDelivery.count({ where: { appointmentId: raced.appointment.id, kind: 'CONFIRMATION' } }), 1);

      // The time is taken between the capture and the confirming transaction: the request is
      // cancelled and the deposit refunded in full, in that same transaction (Square after it).
      const lost = await withDeposit(instant(day51, '14:00'));
      afterCapture = async () => {
        await db.appointment.create({ data: { userId: ids.admin, stylistId: ids.stylist, serviceId: ids.service, date: instant(day51, '14:00'), status: 'CONFIRMED', durationAtBooking: 60, priceAtBooking: 100 } });
      };
      const lostAnswer = await depositAdmin.updateAppointmentStatus(lost.appointment.id, 'CONFIRMED');
      while (afterResponse.length) await afterResponse.shift()!();
      assert.equal(lostAnswer.success, false);
      assert.match((lostAnswer as { error?: string }).error ?? '', /£20\.00 deposit is being refunded/);
      assert.equal(await statusOf(lost.appointment.id), 'CANCELLED');
      assert.equal((await attemptOf(lost.attempt.id)).status, 'CAPTURED');
      const slotRefund = await db.paymentRefund.findFirstOrThrow({ where: { attemptId: lost.attempt.id } });
      assert.deepEqual([slotRefund.reason, slotRefund.amountPence, slotRefund.status, slotRefund.requestedById], ['SLOT_LOST', 2000, 'PENDING', null]);
      assert.equal(slotRefund.squareRefundId, `synthetic-refund-${slotRefund.idempotencyKey}`);
      assert.deepEqual(s3Calls.refund.at(-1), { idempotencyKey: slotRefund.idempotencyKey, amountPence: 2000 });
      const lostNotice = sentNotice(lost.appointment.id, 1, 'CANCELLATION');
      assert.deepEqual([lostNotice.options.depositOutcome, lostNotice.options.wasConfirmed], ['REFUNDING', false]);

      // Declining a request releases its hold once the decline has committed.
      const declined = await withDeposit(instant(day51, '16:00'));
      await assertActionSuccess(await depositAdmin.updateAppointmentStatus(declined.appointment.id, 'CANCELLED'));
      assert.equal((await attemptOf(declined.attempt.id)).status, 'VOIDED');
      assert.equal(s3Calls.cancel.at(-1), declined.paymentId);
      assert.equal(sentNotice(declined.appointment.id, 1, 'CANCELLATION').options.depositOutcome, 'RELEASED');
      assert.equal(await db.paymentRefund.count({ where: { attemptId: declined.attempt.id } }), 0);

      // A customer cancelling a confirmed booking online (24 hours or more ahead) gets it all back.
      const paid = await withDeposit(instant(day52, '10:00'), { status: 'CONFIRMED', attempt: 'CAPTURED' });
      await assertActionSuccess(await depositOwner.cancelAppointment(paid.appointment.id));
      const customerRefund = await db.paymentRefund.findFirstOrThrow({ where: { attemptId: paid.attempt.id } });
      assert.deepEqual([customerRefund.reason, customerRefund.amountPence, customerRefund.status, customerRefund.requestedById], ['CUSTOMER_CANCELLED', 2000, 'PENDING', null]);
      assert.equal(sentNotice(paid.appointment.id, 1, 'CANCELLATION').options.depositOutcome, 'REFUNDING');
      assertActionError(await depositOwner.cancelAppointment(paid.appointment.id), /Only pending or confirmed/);
      assert.equal(await db.paymentRefund.count({ where: { attemptId: paid.attempt.id } }), 1, 'never refunded twice');

      // Staff cancelling a confirmed booking refund it by default, or keep it — recorded in the audit.
      const staffRefunded = await withDeposit(instant(day52, '12:00'), { status: 'CONFIRMED', attempt: 'CAPTURED' });
      await assertActionSuccess(await depositAdmin.updateAppointmentStatus(staffRefunded.appointment.id, 'CANCELLED'));
      const staffRefund = await db.paymentRefund.findFirstOrThrow({ where: { attemptId: staffRefunded.attempt.id } });
      assert.deepEqual([staffRefund.reason, staffRefund.requestedById, staffRefund.status], ['STAFF_CANCELLED', ids.admin, 'PENDING']);
      const kept = await withDeposit(instant(day52, '14:00'), { status: 'CONFIRMED', attempt: 'CAPTURED' });
      await assertActionSuccess(await depositAdmin.updateAppointmentStatus(kept.appointment.id, 'CANCELLED', { refundDeposit: false }));
      assert.equal(await db.paymentRefund.count({ where: { attemptId: kept.attempt.id } }), 0);
      // Recorded on the deposit, so the attention list (real relation filters) never reports it as unexplained.
      assert.equal((await attemptOf(kept.attempt.id)).status, 'KEPT');
      const keptAttention = await collectPaymentAttention(db, new Date(), pageWindows(new Date()));
      assert.ok(!keptAttention.attempts.some((row) => row.id === kept.attempt.id), 'a deliberate keep needs nobody');
      const keptAudit = await db.auditEvent.findFirstOrThrow({ where: { targetId: kept.appointment.id, action: 'APPOINTMENT.STATUS' } });
      assert.deepEqual(JSON.parse(keptAudit.metadataJson), { from: 'CONFIRMED', to: 'CANCELLED', deposit: 'KEPT', depositPence: 2000 });
      assert.equal(sentNotice(kept.appointment.id, 1, 'CANCELLATION').options.depositOutcome, 'KEPT');

      // The late-arrival rule (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md),
      // through its real relation filters and Serializable transactions. Off by default:
      // nothing happens until the settings switch (`lateAutoCancelSince`) is set. A CONFIRMED
      // booking 20 minutes past its start with no arrival is cancelled, its taken deposit KEPT
      // (no Square call), the LATE_CANCELLED email held back 30 minutes; a restore (the action's
      // own database effect, below) puts booking and deposit back and a staff "Arrived" that
      // commits first beats the cron.
      {
        const lateCancel = loadServerModule<typeof import('../src/app/services/late-arrival-cancel')>('src/app/services/late-arrival-cancel.ts', {
          '@/app/lib/prisma': db, './booking-service': booking, './notification-outbox-service': notifications,
          './stylist-ical-cache': icalCache, './deposit-lifecycle': depositLifecycle,
        });
        const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
        const lateStart = minutesAgo(20);
        const lateBooking = await withDeposit(lateStart, { status: 'CONFIRMED', attempt: 'CAPTURED' });
        const raceStart = minutesAgo(25);
        const arrivalRace = await withDeposit(raceStart, { status: 'CONFIRMED', attempt: 'CAPTURED' });
        const refundsBefore = s3Calls.refund.length;
        const cancelsBefore = s3Calls.cancel.length;

        // Switched off (the shipped state): nothing is touched.
        assert.deepEqual(await lateCancel.cancelLateArrivals(new Date()), { enabled: false, cancelled: 0, skipped: 0, failed: 0 });
        assert.equal(await statusOf(lateBooking.appointment.id), 'CONFIRMED');

        // Switched on a minute before this section's earliest start (the raced booking, 25
        // minutes ago), and nothing here starts earlier: both bookings were made and start after
        // the switch-on, while any older row — made before it — can never qualify (the rule
        // needs createdAt and date after the switch-on). The strict counts below rely on it.
        const switchedOn = new Date(raceStart.getTime() - 60_000);
        await db.siteSettings.update({ where: { id: 'singleton' }, data: { lateAutoCancelSince: switchedOn } });
        assert.equal(await db.appointment.count({ where: {
          status: 'CONFIRMED', arrivedAt: null, date: { gt: switchedOn, lte: new Date() }, createdAt: { gt: switchedOn },
          id: { notIn: [lateBooking.appointment.id, arrivalRace.appointment.id] },
        } }), 0, 'no other booking can be due in this section');
        // The race first: a staff "Arrived" write is open (uncommitted) when the cron reads the
        // booking as late; the cron's conditional write queues behind it and loses.
        const arrivalSaved = deferred();
        const arrivalWritten = deferred();
        const staffArrival = db.$transaction(async (tx) => {
          const marked = await tx.appointment.updateMany({ where: { id: arrivalRace.appointment.id, status: 'CONFIRMED', arrivedAt: null }, data: { arrivedAt: new Date() } });
          assert.equal(marked.count, 1);
          arrivalWritten.resolve();
          await arrivalSaved.promise;
        }, { isolationLevel: 'Serializable' });
        await arrivalWritten.promise;
        const racingCron = lateCancel.cancelLateArrivals(new Date(), { limit: 1 });
        await new Promise((resolve) => setTimeout(resolve, 500)); // let the cron's UPDATE reach the row lock
        arrivalSaved.resolve();
        await staffArrival;
        // The earliest due booking is the raced one: it started 5 minutes before the other, and
        // nothing else is due (asserted above), so `limit: 1` picks it.
        assert.deepEqual(await racingCron, { enabled: true, cancelled: 0, skipped: 1, failed: 0 }, 'a committed arrival beats the cron');
        const kept = await db.appointment.findUniqueOrThrow({ where: { id: arrivalRace.appointment.id } });
        assert.equal(kept.status, 'CONFIRMED');
        assert.ok(kept.arrivedAt instanceof Date);
        assert.equal(kept.lateCancelledAt, null);
        assert.equal((await attemptOf(arrivalRace.attempt.id)).status, 'CAPTURED');
        assert.equal(await db.notificationDelivery.count({ where: { appointmentId: arrivalRace.appointment.id, kind: 'LATE_CANCELLED' } }), 0);

        // The cron: the unarrived booking closes; the arrived one stays.
        const before = Date.now();
        assert.deepEqual(await lateCancel.cancelLateArrivals(new Date()), { enabled: true, cancelled: 1, skipped: 0, failed: 0 });
        const cancelled = await db.appointment.findUniqueOrThrow({ where: { id: lateBooking.appointment.id } });
        assert.equal(cancelled.status, 'CANCELLED');
        assert.ok(cancelled.lateCancelledAt instanceof Date);
        assert.equal(cancelled.notificationVersion, 1);
        assert.equal((await attemptOf(lateBooking.attempt.id)).status, 'KEPT', 'a no-show keeps its deposit');
        assert.equal(await db.paymentRefund.count({ where: { attemptId: lateBooking.attempt.id } }), 0);
        assert.equal(s3Calls.refund.length, refundsBefore, 'no refund is asked of Square');
        assert.equal(s3Calls.cancel.length, cancelsBefore, 'nothing is released at Square either');
        assert.equal(await statusOf(arrivalRace.appointment.id), 'CONFIRMED');
        const lateNotices = await db.notificationDelivery.findMany({ where: { appointmentId: lateBooking.appointment.id, kind: 'LATE_CANCELLED' } });
        assert.equal(lateNotices.length, 1);
        assert.equal(lateNotices[0].status, 'PENDING');
        const waitedMinutes = (lateNotices[0].nextAttemptAt.getTime() - before) / 60_000;
        assert.ok(waitedMinutes > 29 && waitedMinutes < 31, `the email waits 30 minutes (${waitedMinutes})`);
        assert.equal(JSON.parse(lateNotices[0].payloadJson).options.depositOutcome, 'KEPT');
        assert.ok(lateNotices[0].eventKey.endsWith('/1/LATE_CANCELLED'), 'keyed by the cancellation\'s version, which a restore moves on');
        const lateAudit = await db.auditEvent.findFirstOrThrow({ where: { targetId: lateBooking.appointment.id, action: 'APPOINTMENT.LATE_AUTO_CANCELLED' } });
        assert.equal(JSON.parse(lateAudit.metadataJson).deposit, 'KEPT');
        assert.deepEqual(await lateCancel.cancelLateArrivals(new Date()), { enabled: true, cancelled: 0, skipped: 0, failed: 0 }, 're-running is a no-op');

        // Restore (restoreLateCancellation's database effect, within 24 hours): booking and
        // deposit move together in one Serializable transaction — CONFIRMED and CAPTURED.
        const restored = await db.$transaction(async (tx) => {
          const booked = await tx.appointment.updateMany({
            where: { id: lateBooking.appointment.id, status: 'CANCELLED', lateCancelledAt: cancelled.lateCancelledAt },
            data: { status: 'CONFIRMED', lateCancelledAt: null, arrivedAt: new Date(), notificationVersion: { increment: 1 } },
          });
          const back = await tx.paymentAttempt.updateMany({ where: { id: lateBooking.attempt.id, status: 'KEPT' }, data: { status: 'CAPTURED' } });
          return [booked.count, back.count];
        }, { isolationLevel: 'Serializable' });
        assert.deepEqual(restored, [1, 1]);
        const back = await db.appointment.findUniqueOrThrow({ where: { id: lateBooking.appointment.id } });
        assert.deepEqual([back.status, back.lateCancelledAt, back.notificationVersion], ['CONFIRMED', null, 2]);
        assert.ok(back.arrivedAt instanceof Date);
        assert.equal((await attemptOf(lateBooking.attempt.id)).status, 'CAPTURED');
        // Restored and arrived: the rule never cancels it again (the held-back email, keyed by version 1, is stale at version 2).
        assert.deepEqual(await lateCancel.cancelLateArrivals(new Date()), { enabled: true, cancelled: 0, skipped: 0, failed: 0 });
        assert.equal(await statusOf(lateBooking.appointment.id), 'CONFIRMED');
        await db.siteSettings.update({ where: { id: 'singleton' }, data: { lateAutoCancelSince: null } });
        console.log('PASS: late-arrival rule — off does nothing; a staff arrival that commits first beats the cron (skipped); an unarrived CONFIRMED booking 20 minutes late is cancelled with its taken deposit KEPT (no Square call), one LATE_CANCELLED email held back 30 minutes, audited; restore puts CONFIRMED + CAPTURED back in one transaction. Square was a fake.');
      }

      // The lapse step, through its real relation filters: a request whose hold ran out
      // closes before its time (EXPIRED, nothing asked of Square); an ended one releases
      // its live hold; one mid-capture is left to staff; one without a deposit lapses as ever.
      const expiring = await withDeposit(instant(day(53), '10:00'), { delayedUntil: new Date(Date.now() - 60_000), announced: true });
      const ended = await withDeposit(new Date(Date.now() - 3 * 3_600_000), { announced: true });
      const midCapture = await withDeposit(new Date(Date.now() - 4 * 3_600_000), { attempt: 'CAPTURE_UNKNOWN' });
      const plain = await db.appointment.create({ data: { userId: ids.other, stylistId: ids.stylist, serviceId: ids.service, date: new Date(Date.now() - 5 * 3_600_000), status: 'PENDING', durationAtBooking: 60, priceAtBooking: 100 } });
      const futureHeld = await withDeposit(instant(day(54), '10:00'));
      const cancelsBefore = s3Calls.cancel.length;
      const lapsed = await lapse.lapseStartedPendingRequests(new Date());
      assert.deepEqual(lapsed, { lapsed: 3, failed: 0 });
      assert.deepEqual(await Promise.all([expiring, ended, midCapture, futureHeld].map((row) => statusOf(row.appointment.id))), ['CANCELLED', 'CANCELLED', 'PENDING', 'PENDING']);
      assert.equal(await statusOf(plain.id), 'CANCELLED');
      assert.deepEqual(await Promise.all([expiring, ended, midCapture, futureHeld].map(async (row) => (await attemptOf(row.attempt.id)).status)), ['EXPIRED', 'VOIDED', 'CAPTURE_UNKNOWN', 'AUTHORIZED']);
      assert.deepEqual(s3Calls.cancel.slice(cancelsBefore), [ended.paymentId], 'only the live hold of an ended request is released');
      const expiredNotice = await db.notificationDelivery.findFirstOrThrow({ where: { appointmentId: expiring.appointment.id, kind: 'REQUEST_LAPSED' } });
      assert.deepEqual(
        (({ depositOutcome, holdExpired }) => ({ depositOutcome, holdExpired }))(JSON.parse(expiredNotice.payloadJson).options),
        { depositOutcome: 'RELEASED', holdExpired: true },
      );
      const endedNotice = await db.notificationDelivery.findFirstOrThrow({ where: { appointmentId: ended.appointment.id, kind: 'REQUEST_LAPSED' } });
      assert.equal(JSON.parse(endedNotice.payloadJson).options.holdExpired, undefined);
      assert.deepEqual(await lapse.lapseStartedPendingRequests(new Date()), { lapsed: 0, failed: 0 }, 're-running is a no-op');

      // Once its appointment ended at least 12 hours ago, the DAILY run (housekeeping,
      // `takenDeposits`) closes a request whose deposit was taken but never confirmed like a
      // staff decline: a full REQUEST_LAPSED refund (the row in the lapse's own transaction,
      // Square after it). One whose capture nobody saw finish is settled with Square first,
      // once quiet for 2 minutes; the notifications run never touches either (review I-E),
      // and the fresh one above (4 hours ago) is still left alone.
      const lapsedTaken = await withDeposit(new Date(Date.now() - 14 * 3_600_000), { attempt: 'CAPTURED', announced: true });
      const lapsedUnclear = await withDeposit(new Date(Date.now() - 15 * 3_600_000), { attempt: 'CAPTURE_UNKNOWN', announced: true });
      await db.paymentAttempt.update({ where: { id: lapsedUnclear.attempt.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
      squareS3.get(lapsedUnclear.paymentId)!.status = 'COMPLETED';
      const lapseRefundsBefore = s3Calls.refund.length;
      assert.deepEqual(await lapse.lapseStartedPendingRequests(new Date()), { lapsed: 0, failed: 0 }, 'the notifications run leaves taken deposits to staff');
      assert.deepEqual(await Promise.all([lapsedTaken, lapsedUnclear].map((row) => statusOf(row.appointment.id))), ['PENDING', 'PENDING']);
      assert.equal(s3Calls.refund.length, lapseRefundsBefore);
      assert.deepEqual(await lapse.lapseStartedPendingRequests(new Date(), { takenDeposits: true }), { lapsed: 2, failed: 0 });
      for (const row of [lapsedTaken, lapsedUnclear]) {
        assert.equal(await statusOf(row.appointment.id), 'CANCELLED');
        assert.equal((await attemptOf(row.attempt.id)).status, 'CAPTURED');
        const lapseRefund = await db.paymentRefund.findFirstOrThrow({ where: { attemptId: row.attempt.id } });
        assert.deepEqual([lapseRefund.reason, lapseRefund.amountPence, lapseRefund.status, lapseRefund.requestedById], ['REQUEST_LAPSED', 2000, 'PENDING', null]);
        const lapseNotice = await db.notificationDelivery.findFirstOrThrow({ where: { appointmentId: row.appointment.id, kind: 'REQUEST_LAPSED' } });
        assert.equal(JSON.parse(lapseNotice.payloadJson).options.depositOutcome, 'REFUNDING');
      }
      assert.equal(s3Calls.refund.length - lapseRefundsBefore, 2, 'each refunded once, after its lapse committed');
      assert.deepEqual([await statusOf(midCapture.appointment.id), (await attemptOf(midCapture.attempt.id)).status], ['PENDING', 'CAPTURE_UNKNOWN'], 'a capture still settling waits');
      assert.deepEqual(await lapse.lapseStartedPendingRequests(new Date(), { takenDeposits: true }), { lapsed: 0, failed: 0 });
      assert.equal(s3Calls.refund.length - lapseRefundsBefore, 2, 'never refunded twice');
      while (afterResponse.length) await afterResponse.shift()!();
      console.log(`PASS: card deposits S3 — approval captures once (a real two-transaction race refused the second with "being processed"), a time lost after capture cancels with a SLOT_LOST refund, decline releases the hold, customer and staff cancellations refund (or staff keep it, audited), and the lapse step expires run-out holds, releases ended ones and leaves a capture in flight alone. Square was a fake.`);
    }

    // Card deposits, phase S4: the Square webhook route and reconciliation over
    // real PostgreSQL — the event store's real unique key (a repeated delivery
    // is applied once), forward-only conditional writes (timestamps compared at
    // PostgreSQL's precision), the relation filters reconciliation and the
    // attention lists use, a late-capture refund in a real transaction, and the
    // lapse step closing a request whose hold Square let go. The signature
    // check is real; Square is a fake that behaves like Square
    // (src/test/payments-fixture.ts). Its own Square location keeps S2/S3's
    // synthetic deposits out of reconciliation's reach.
    {
      const config = SQUARE_S4_CONFIG;
      const square = fakeSquare();
      const reconciliation = createPaymentReconciliation({ db, config, gatewayFor: () => square.gateway as never });
      const followUps: (() => Promise<void>)[] = [];
      const webhook = loadServerModule<typeof import('../src/app/api/webhooks/square/route')>('src/app/api/webhooks/square/route.ts', {
        'next/server': { after: (callback: () => Promise<void>) => { followUps.push(callback); } },
        '@/app/lib/online-booking-lock': { usableSquareConfig: () => config },
        '@/app/lib/prisma': db,
        '@/app/services/payment-reconciliation': { reconcileSquareEvent: (eventId: string) => reconciliation.reconcileEventById(eventId) },
      });
      const deliver = async (body: string) => {
        const response = await webhook.POST(new Request(config.webhookNotificationUrl, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-square-hmacsha256-signature': sign(body) }, body,
        }));
        assert.equal(response.status, 200, `Square must be answered 200: ${body.slice(0, 80)}`);
        while (followUps.length) await followUps.shift()!();
      };
      const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);
      let s4Sequence = 0;
      /** One of the other customer's bookings (status null: none) and its £20 deposit, as S2/S3 leave them. */
      const deposit = async (status: string | null, values: Partial<Prisma.PaymentAttemptUncheckedCreateInput> = {}, date?: Date) => {
        const n = ++s4Sequence;
        const appointment = status === null ? null : await db.appointment.create({ data: {
          userId: ids.other, stylistId: ids.stylist, serviceId: ids.service, date: date ?? instant(day(60 + n), '10:00'), status,
          durationAtBooking: 60, priceAtBooking: 100, notificationLocale: 'en-GB',
        } });
        const attempt = await db.paymentAttempt.create({ data: {
          userId: ids.other, attemptKey: `s4-attempt-${n}`, idempotencyKey: `dep_s4_${n}`, appointmentId: appointment?.id ?? null, status: 'AUTHORIZED',
          environment: config.environment, locationId: config.locationId, amountPence: 2000, quoteAmountPence: 10000, policyJson: '{}', requestJson: '{}',
          squarePaymentId: `s4-payment-${n}`, delayedUntil: new Date(Date.now() + 5 * 86_400_000), authorizedAt: past(120),
          createdAt: past(120), updatedAt: past(60), ...values,
        } });
        return { appointment, attempt, paymentId: `s4-payment-${n}` };
      };
      const attemptOf = (id: string) => db.paymentAttempt.findUniqueOrThrow({ where: { id } });

      // A capture nobody saw finish, notified twice: applied once (the second
      // delivery meets PostgreSQL's unique key), the booking untouched; an
      // older APPROVED notice afterwards changes nothing.
      const unclear = await deposit('PENDING', { status: 'CAPTURE_UNKNOWN', lastError: OPERATIONS_MESSAGES.PAYMENT_CAPTURE_UNKNOWN });
      const completed = paymentEvent('s4-evt-capture', 'payment.updated', { id: unclear.paymentId, status: 'COMPLETED', referenceId: unclear.attempt.id });
      await deliver(completed);
      const capturedAt = (await attemptOf(unclear.attempt.id)).updatedAt;
      await deliver(completed);
      assert.equal(await db.squareWebhookEvent.count({ where: { eventId: 's4-evt-capture' } }), 1);
      const taken = await attemptOf(unclear.attempt.id);
      assert.deepEqual([taken.status, taken.lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);
      assert.equal(taken.updatedAt.getTime(), capturedAt.getTime(), 'the duplicate wrote nothing');
      assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: unclear.appointment!.id } })).status, 'PENDING', 'a webhook never changes a booking');
      await deliver(paymentEvent('s4-evt-old', 'payment.created', { id: unclear.paymentId, status: 'APPROVED', referenceId: unclear.attempt.id }));
      assert.equal((await attemptOf(unclear.attempt.id)).status, 'CAPTURED');

      // A declined request whose release failed: Square's APPROVED notice makes
      // the site release it — after the answer, on a fresh read.
      const declined = await deposit('CANCELLED', { lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED });
      square.hold(declined.paymentId, declined.attempt.id);
      await deliver(paymentEvent('s4-evt-release', 'payment.updated', { id: declined.paymentId, status: 'APPROVED', referenceId: declined.attempt.id }));
      assert.deepEqual(square.calls.order, [`getPayment:${declined.paymentId}`, `cancel:${declined.paymentId}`]);
      assert.equal((await attemptOf(declined.attempt.id)).status, 'VOIDED');
      assert.ok((await db.squareWebhookEvent.findUniqueOrThrow({ where: { eventId: 's4-evt-release' } })).processedAt);

      // A payment no deposit knows: recorded, open, answered 200.
      await deliver(paymentEvent('s4-evt-stranger', 'payment.created', { id: 's4-stranger', status: 'APPROVED', referenceId: 's4-nobody' }));
      assert.equal((await db.squareWebhookEvent.findUniqueOrThrow({ where: { eventId: 's4-evt-stranger' } })).processedAt, null);

      // A refund whose answer was lost is found by its payment and amount, then
      // moves forward only.
      const refunded = await deposit('CANCELLED', { status: 'CAPTURED', capturedAt: past(100) });
      const lostRefund = await db.paymentRefund.create({ data: { attemptId: refunded.attempt.id, idempotencyKey: 'rfd_s4_lost', amountPence: 2000, status: 'UNKNOWN', reason: 'STAFF_CANCELLED' } });
      await deliver(refundEvent('s4-evt-refund-1', 'refund.created', { id: 's4-refund-1', status: 'PENDING', paymentId: refunded.paymentId }));
      assert.deepEqual(await db.paymentRefund.findUniqueOrThrow({ where: { id: lostRefund.id }, select: { status: true, squareRefundId: true } }), { status: 'PENDING', squareRefundId: 's4-refund-1' });
      await deliver(refundEvent('s4-evt-refund-2', 'refund.updated', { id: 's4-refund-1', status: 'COMPLETED', paymentId: refunded.paymentId }));
      await deliver(refundEvent('s4-evt-refund-3', 'refund.updated', { id: 's4-refund-1', status: 'PENDING', paymentId: refunded.paymentId }));
      assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { id: lostRefund.id } })).status, 'COMPLETED');

      // The daily run, through its real queries.
      const orphan = await deposit(null);
      square.hold(orphan.paymentId, orphan.attempt.id);
      const late = await deposit('CANCELLED', { lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED });
      square.hold(late.paymentId, late.attempt.id, 'COMPLETED');
      const unknown = await deposit(null, { status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN, createdAt: past(24 * 60), updatedAt: past(24 * 60) });
      const open = await deposit('PENDING');
      const pending = await deposit('CANCELLED', { status: 'CAPTURED', capturedAt: past(200) });
      square.knownRefund('rfd_s4_pending', pending.paymentId, 'COMPLETED');
      const pendingRefund = await db.paymentRefund.create({ data: {
        attemptId: pending.attempt.id, idempotencyKey: 'rfd_s4_pending', squareRefundId: 'sq-refund-rfd_s4_pending', amountPence: 2000,
        status: 'PENDING', reason: 'STAFF_CANCELLED', createdAt: past(180), updatedAt: past(180),
      } });
      const summary = await reconciliation.reconcileAll();
      assert.equal(summary.failed, 0, JSON.stringify(summary));
      assert.deepEqual([(await attemptOf(orphan.attempt.id)).status, (await attemptOf(orphan.attempt.id)).lastError], ['VOIDED', OPERATIONS_MESSAGES.PAYMENT_ORPHAN_RELEASED]);
      const lateRow = await attemptOf(late.attempt.id);
      assert.deepEqual([lateRow.status, lateRow.lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_LATE_CAPTURE_REFUNDED]);
      const lateRefund = await db.paymentRefund.findFirstOrThrow({ where: { attemptId: late.attempt.id } });
      assert.deepEqual([lateRefund.reason, lateRefund.amountPence, lateRefund.status], ['LATE_CAPTURE', 2000, 'PENDING']);
      assert.equal(await db.auditEvent.count({ where: { action: 'PAYMENT.LATE_CAPTURE_REFUND', targetId: late.attempt.id } }), 1);
      assert.deepEqual([(await attemptOf(unknown.attempt.id)).status, (await attemptOf(unknown.attempt.id)).lastError], ['UNKNOWN', OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING]);
      assert.ok(square.calls.cancelByKey.includes(unknown.attempt.idempotencyKey), 'cancelled by its key');
      assert.equal((await attemptOf(open.attempt.id)).status, 'AUTHORIZED', 'a hold its request needs is left alone');
      assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { id: pendingRefund.id } })).status, 'COMPLETED');
      // Run again: nothing more is refunded or released.
      const refundsBefore = square.calls.refund.length;
      assert.equal((await reconciliation.reconcileAll()).failed, 0);
      assert.equal(square.calls.refund.length, refundsBefore);
      assert.equal(await db.paymentRefund.count({ where: { attemptId: late.attempt.id } }), 1);

      // What still needs a person, through the real relation filters.
      const attention = await collectPaymentAttention(db, new Date(), pageWindows(new Date()));
      const problemOf = (id: string) => attention.attempts.find((row) => row.id === id)?.problem;
      assert.equal(problemOf(unclear.attempt.id), 'TAKEN_NOT_CONFIRMED');
      assert.equal(problemOf(unknown.attempt.id), undefined, 'being cancelled by key every day: handled');
      assert.equal(problemOf(open.attempt.id), undefined);
      assert.ok(attention.refunds.some((row) => row.id === lateRefund.id && row.problem === 'LATE_CAPTURE'));
      assert.ok(!attention.notifications.some((row) => row.eventId === 's4-evt-stranger'), 'an unmatched notice is listed once it is an hour old');

      // Review fixes over real PostgreSQL (timestamps compared at its precision).
      // W-B: an in-salon refund at this location — its payment none of ours — is settled at once.
      await deliver(refundEvent('s4-evt-counter', 'refund.created', { id: 's4-counter-refund', status: 'PENDING', paymentId: 's4-counter-sale' }));
      assert.ok((await db.squareWebhookEvent.findUniqueOrThrow({ where: { eventId: 's4-evt-counter' } })).processedAt, 'not ours: settled, never listed');
      // W-C: a retry Square refuses is dated on its row (the batch rotates); 7 days after the
      // refund was requested the daily run hands it to staff (UNRESOLVED), who settle it
      // outside the website (audited, still counted, never sent again).
      const given = await deposit('CANCELLED', { status: 'CAPTURED', capturedAt: past(8 * 24 * 60) });
      const givenRefund = await db.paymentRefund.create({ data: {
        attemptId: given.attempt.id, idempotencyKey: 'rfd_s4_given', amountPence: 2000, status: 'UNKNOWN', reason: 'STAFF_CANCELLED', createdAt: past(8 * 24 * 60), updatedAt: past(60),
      } });
      const refused = await deposit('CANCELLED', { status: 'CAPTURED', capturedAt: past(2 * 24 * 60) });
      const refusedRefund = await db.paymentRefund.create({ data: {
        attemptId: refused.attempt.id, idempotencyKey: 'rfd_s4_refused', amountPence: 2000, status: 'UNKNOWN', reason: 'STAFF_CANCELLED', createdAt: past(2 * 24 * 60), updatedAt: past(60),
      } });
      const refundScript = square.script.refund;
      square.script.refund = async () => { throw new SquareGatewayError('provider_error', 401); };
      const retriedBefore = square.calls.refund.length;
      assert.equal((await reconciliation.reconcileAll()).failed, 0);
      square.script.refund = refundScript;
      assert.deepEqual(square.calls.refund.slice(retriedBefore).map((call) => call.idempotencyKey), ['rfd_s4_refused'], 'the given-up one is not asked');
      const refusedAfter = await db.paymentRefund.findUniqueOrThrow({ where: { id: refusedRefund.id } });
      assert.equal(refusedAfter.status, 'UNKNOWN');
      assert.ok(refusedAfter.updatedAt.getTime() > past(5).getTime(), 'the try is dated on its row');
      assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { id: givenRefund.id } })).status, 'UNRESOLVED');
      const unresolvedAttention = await collectPaymentAttention(db, new Date(), pageWindows(new Date()));
      assert.ok(unresolvedAttention.refunds.some((row) => row.id === givenRefund.id && row.problem === 'UNRESOLVED'));
      assert.deepEqual(
        await settleRefundOutsideWebsite(db, { appointmentId: given.appointment!.id, refundId: givenRefund.id, adminId: ids.admin, now: new Date() }),
        { kind: 'SETTLED', amountPence: 2000 },
      );
      assert.equal((await db.paymentRefund.findUniqueOrThrow({ where: { id: givenRefund.id } })).status, 'SETTLED_EXTERNALLY');
      assert.equal(await db.auditEvent.count({ where: { action: 'PAYMENT.REFUND_SETTLED_OUTSIDE', targetId: givenRefund.id } }), 1);
      assert.equal(await refundableRemainderPence(db, given.attempt.id), 0, 'never refundable twice');
      // I-D: Square shows a hold this site still records taken, on an open request: recorded taken and flagged.
      const takenOpen = await deposit('PENDING');
      square.hold(takenOpen.paymentId, takenOpen.attempt.id, 'COMPLETED');
      await deliver(paymentEvent('s4-evt-taken-open', 'payment.updated', { id: takenOpen.paymentId, status: 'COMPLETED', referenceId: takenOpen.attempt.id }));
      const takenOpenRow = await attemptOf(takenOpen.attempt.id);
      assert.deepEqual([takenOpenRow.status, takenOpenRow.lastError], ['CAPTURED', OPERATIONS_MESSAGES.PAYMENT_CAPTURED_NOT_CONFIRMED]);
      assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: takenOpen.appointment!.id } })).status, 'PENDING', 'the booking is staff\'s to confirm or decline');

      // A request whose hold Square let go (EXPIRED, as the webhook records it)
      // closes before its time, through the lapse step's real relation filter.
      const lapse = loadServerModule<typeof import('../src/app/services/pending-request-lapse')>('src/app/services/pending-request-lapse.ts', {
        '@/app/lib/prisma': db, './booking-service': booking, './notification-outbox-service': notifications, './stylist-ical-cache': icalCache,
      });
      const gone = await deposit('PENDING', { status: 'EXPIRED', lastError: OPERATIONS_MESSAGES.PAYMENT_HOLD_CANCELLED });
      // …and one whose hold this site released already (VOIDED: a booking whose answer was lost).
      const releasedEarly = await deposit('PENDING', { status: 'VOIDED', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASED_NOT_BOOKED });
      const lapsed = await lapse.lapseStartedPendingRequests(new Date());
      assert.ok(lapsed.lapsed >= 2 && lapsed.failed === 0, JSON.stringify(lapsed));
      assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: gone.appointment!.id } })).status, 'CANCELLED');
      assert.equal((await attemptOf(gone.attempt.id)).status, 'EXPIRED');
      assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: releasedEarly.appointment!.id } })).status, 'CANCELLED');
      assert.equal((await attemptOf(releasedEarly.attempt.id)).status, 'VOIDED');
      assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: open.appointment!.id } })).status, 'PENDING');
      while (afterResponse.length) await afterResponse.shift()!();
      console.log('PASS: card deposits S4 — a repeated Square notification is applied once (PostgreSQL unique key), an older one never regresses a capture, a hold no booking wants is released after the answer on a fresh read, a refund that lost its answer is found and moves forward only; the daily reconciliation releases orphans, refunds a late capture in full once, keeps cancelling an unconfirmed authorization by key and follows a pending refund; the attention list and the lapse step read the real relation filters. Square was a fake.');
    }

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
    assert.equal((await checkCalendarBookingReadiness(db)).ready, true, 'One failed import must not close booking while the last success is fresh');
    // Three missed imports later the last success is stale, and booking must close.
    await db.calendarConnection.update({ where: { id: channel.id }, data: { lastSuccessAt: new Date(Date.now() - (CALENDAR_FRESHNESS_MINUTES + 1) * 60_000) } });
    assert.equal((await checkCalendarBookingReadiness(db)).ready, false);
    assert.equal(await slotAvailable(bookingDay, '11:00'), false);
    await assert.rejects(create(day(17), '10:00'), /Online booking is closed/);
    assertActionError(await customerActions.requestReschedule(appointment.id, bookingDay, '16:00'), /Online booking is closed/);
    const versionBeforeCancel = (await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).notificationVersion;
    const invalidationsBeforeCancel = invalidatedTags.length;
    await assertActionSuccess(await customerActions.cancelAppointment(appointment.id));
    const cancelled = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.notificationVersion, versionBeforeCancel + 1);
    assert.ok(invalidatedTags.slice(invalidationsBeforeCancel).includes('stylist-ical-feed'));
    assert.ok(!(await readFeed()).includes(uid), 'Cancellation removes the website reservation from outbound ICS even while new bookings are closed');
    assertActionError(await customerActions.cancelAppointment(appointment.id), /Only pending or confirmed/);
    assert.equal(await slotAvailable(bookingDay, '14:00'), true);
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: appointment.id, kind: 'CANCELLATION' } }), 1);
    // Every sent notice (the original five plus the reschedule-request scenarios') has its payload scrubbed.
    const sentCount = await db.notificationDelivery.count({ where: { appointmentId: appointment.id, status: 'SENT' } });
    assert.ok(sentCount >= 5);
    const sentKinds = new Set((await db.notificationDelivery.findMany({ where: { appointmentId: appointment.id, status: 'SENT' }, select: { kind: true } })).map(row => row.kind));
    for (const kind of ['RESCHEDULE_REQUEST_RECEIVED', 'SALON_RESCHEDULE_ALERT', 'RESCHEDULE_DECLINED']) assert.ok(sentKinds.has(kind), `${kind} was sent`);
    assert.equal(await db.notificationDelivery.count({ where: { appointmentId: appointment.id, status: 'SENT', payloadJson: '{}' } }), sentCount);
    console.log('PASS: approval rechecks newly imported Fresha conflicts; failed import preserves blocks, keeps booking open while fresh and closes it once stale; cancellation remains available and removes its outbound event.');

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
        // The system's own audits (no actor: lapses, late-capture refunds) and the Square notifications.
        await db.auditEvent.deleteMany({ where: { actorUserId: null, action: { in: ['APPOINTMENT.LAPSED', 'PAYMENT.LATE_CAPTURE_REFUND'] } } });
        await db.squareWebhookEvent.deleteMany({ where: { eventId: { startsWith: 's4-' } } });
        await db.paymentRefund.deleteMany({ where: { attempt: { userId: { in: userIds } } } });
        await db.paymentAttempt.deleteMany({ where: { userId: { in: userIds } } });
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
