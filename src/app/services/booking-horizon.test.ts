import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingCoverageEndsAt, isWithinBookingHorizon } from './booking-horizon';
import { CALENDAR_FRESHNESS_MINUTES } from './treatwell-sync-coverage';
import { CALENDAR_WINDOW_DAYS } from './calendar-ical';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2026-09-11T10:00:00Z');

test('the entire appointment must fit inside imported coverage minus the accepted feed age', () => {
  // Derived, not hardcoded: the horizon is the imported window less the oldest
  // feed the readiness check still accepts, so widening either constant moves
  // this boundary rather than breaking the test on a stale literal.
  const lastEnd = new Date(now.getTime() + CALENDAR_WINDOW_DAYS * 86_400_000 - CALENDAR_FRESHNESS_MINUTES * 60_000);
  assert.equal(bookingCoverageEndsAt(now).getTime(), lastEnd.getTime());
  const lastStart = new Date(lastEnd.getTime() - 60 * 60_000);
  assert.equal(isWithinBookingHorizon(lastStart, 60, now), true);
  assert.equal(isWithinBookingHorizon(new Date(lastStart.getTime() + 1000), 60, now), false);
  assert.equal(isWithinBookingHorizon(new Date('2027-01-09T10:00:00Z'), 60, now), false);
});

test('invalid duration and past or invalid times cannot enter the calendar window', () => {
  for (const duration of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isWithinBookingHorizon(new Date('2026-09-12T10:00:00Z'), duration, now), false);
  }
  assert.equal(isWithinBookingHorizon(now, 60, now), false);
  assert.equal(isWithinBookingHorizon(new Date('invalid'), 60, now), false);
});

test('public named and Anyone slots hide dates beyond coverage before querying availability', async () => {
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': {},
    '@/app/lib/booking-maintenance': {},
    './offers-service': {},
    './notification-outbox-service': {},
  });
  const date = new Date(Date.now() + 120 * 86_400_000);
  assert.deepEqual(await service.getAvailableSlots('stylist', date, 60), []);
  assert.deepEqual(await service.getAvailableSlotsUnion(date, 60), []);
  await assert.rejects(service.assertAppointmentSlotAvailable({} as never, {
    id: 'appointment', stylistId: 'stylist', durationAtBooking: 60, service: { duration: 30 },
  }, date), /available online booking dates/);
});
