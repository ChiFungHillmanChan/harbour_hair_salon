import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture, FIXTURE_STYLISTS as STYLISTS } from '../../test/booking-fixture';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

/**
 * The response to a booking request can be lost (a dropped connection, a
 * second tap on Confirm) after the request was saved. The customer then sends
 * the very same request again. It must come back as the request already made:
 * never a second appointment, and for "Anyone" never the same time again with
 * the next free stylist.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const TUESDAY = '2026-10-06';
const at = (time: string) => resolveSalonDateTime(TUESDAY, time).utc;
const request = (time = '11:00', userId = 'user-1') => ({ serviceId: 'service-1', date: at(time), userId });

test('an "Anyone" retry returns the request already made instead of booking the next free stylist', async () => {
  const f = fixture();
  const first = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  const again = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  assert.equal(f.rows.length, 1, 'one appointment, not one per attempt');
  assert.equal(again.id, first.id);
  assert.equal(again.stylistId, 'funky', 'still the stylist the first attempt was given');
  assert.equal(first.repeat, false);
  assert.equal(again.repeat, true);
  assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT'], 'no second receipt and no second salon alert');
});

test('a named-stylist retry returns the request already made instead of refusing its own slot', async () => {
  const f = fixture();
  const first = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  const again = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  assert.equal(again.id, first.id);
  assert.equal(again.repeat, true);
  assert.equal(f.rows.length, 1);
  assert.equal(f.notices.length, 2);
});

test('the same request is a repeat whichever stylist the retry names', async () => {
  const f = fixture();
  const first = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  const anyone = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  assert.equal(anyone.id, first.id);
  assert.equal(anyone.stylistId, 'lox');
  assert.equal(f.rows.length, 1);
});

test('a different time is a new request and still books', async () => {
  const f = fixture();
  await f.service.createBookingForFirstAvailable({ ...request('11:00'), candidateStylistIds: STYLISTS });
  const later = await f.service.createBookingForFirstAvailable({ ...request('14:00'), candidateStylistIds: STYLISTS });
  assert.equal(later.repeat, false);
  assert.equal(f.rows.length, 2);
  assert.deepEqual(f.rows.map((row) => row.date.getTime()), [at('11:00').getTime(), at('14:00').getTime()]);
  assert.equal(f.notices.length, 4);
});

test('another customer at the same time is not a repeat', async () => {
  const f = fixture();
  await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  const other = await f.service.createBookingForFirstAvailable({ ...request('11:00', 'user-2'), candidateStylistIds: STYLISTS });
  assert.equal(other.repeat, false);
  assert.equal(other.stylistId, 'lox', 'Funky is taken, so the other customer gets Lox');
  assert.equal(f.rows.length, 2);
});

test('a cancelled request does not count: the same time can be requested again', async () => {
  const f = fixture();
  await f.service.createBooking({ ...request(), stylistId: 'funky' });
  f.rows[0].status = 'CANCELLED';
  const again = await f.service.createBooking({ ...request(), stylistId: 'funky' });
  assert.equal(again.repeat, false);
  assert.equal(f.rows.length, 2);
});

for (const stylistId of [ANY_STYLIST_ID, 'lox']) {
  test(`submitBooking: a repeated ${stylistId === ANY_STYLIST_ID ? 'Anyone' : 'named-stylist'} request succeeds without a new booking, notice or feed refresh`, async () => {
    const f = fixture();
    const input = { stylistId, serviceId: 'service-1', date: TUESDAY, time: '11:00', expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 } };
    assert.deepEqual(await f.actions.submitBooking(input), { success: true });
    assert.deepEqual(await f.actions.submitBooking(input), { success: true });
    assert.equal(f.rows.length, 1);
    assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT']);
    assert.equal(f.effects.feedInvalidations, 1, 'only the request that booked refreshes the busy feed');
    assert.equal(f.effects.dispatches, 1, 'nothing new to deliver for the repeat');
  });
}
