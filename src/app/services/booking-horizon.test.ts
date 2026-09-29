import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingCoverageEndsAt, isBookableDateWindow, isWithinBookingHorizon } from './booking-horizon';
import { salonDateKey } from './salon-time';
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

const strip = (start: string, length = 14) => Array.from({ length }, (_, i) => {
  const day = new Date(`${start}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + i);
  return day.toISOString().slice(0, 10);
});

test('the wizard date strip is a bookable window, with a day of slack either side', () => {
  assert.equal(isBookableDateWindow(strip('2026-09-11'), now), true);
  // A browser a timezone behind or ahead of London starts a day early or late.
  assert.equal(isBookableDateWindow(strip('2026-09-10'), now), true);
  assert.equal(isBookableDateWindow(strip('2026-09-12'), now), true);
  assert.equal(isBookableDateWindow(['2026-09-09'], now), false);
});

test('whole-history, non-calendar and over-long ranges are refused', () => {
  assert.equal(isBookableDateWindow(['1900-01-01', '9999-12-31'], now), false);
  assert.equal(isBookableDateWindow([], now), false);
  assert.equal(isBookableDateWindow(['2026-02-30'], now), false);
  assert.equal(isBookableDateWindow(['2026-13-01'], now), false);
  assert.equal(isBookableDateWindow([20260912, '2026-09-13'], now), false);
  assert.equal(isBookableDateWindow(strip('2026-09-11', 15), now), false);
  assert.equal(isBookableDateWindow(['2026-09-11', '2026-09-25'], now), false, 'two dates fifteen days apart');
  assert.equal(isBookableDateWindow(['2026-09-11', '2026-09-24'], now), true);
});

test('the window ends a day after the last bookable salon day', () => {
  const lastDay = salonDateKey(bookingCoverageEndsAt(now));
  const [, dayAfter, twoDaysAfter] = strip(lastDay, 3);
  assert.equal(isBookableDateWindow([lastDay], now), true);
  assert.equal(isBookableDateWindow([dayAfter], now), true);
  assert.equal(isBookableDateWindow([twoDaysAfter], now), false);
});

test('the salon day, not the UTC day, anchors the window across GMT and BST', () => {
  // 23:30Z on 31 March 2026 is already 1 April in London (BST), so 30 March
  // is two salon days back and refused, although it is one UTC day back.
  const bstNight = new Date('2026-03-31T23:30:00Z');
  assert.equal(salonDateKey(bstNight), '2026-04-01');
  assert.equal(isBookableDateWindow(['2026-03-31'], bstNight), true);
  assert.equal(isBookableDateWindow(['2026-03-30'], bstNight), false);
  // In winter (GMT) London and UTC agree: 23:30Z on 1 December is 1 December.
  const gmtNight = new Date('2026-12-01T23:30:00Z');
  assert.equal(salonDateKey(gmtNight), '2026-12-01');
  assert.equal(isBookableDateWindow(['2026-11-30'], gmtNight), true);
  assert.equal(isBookableDateWindow(['2026-11-29'], gmtNight), false);
});
