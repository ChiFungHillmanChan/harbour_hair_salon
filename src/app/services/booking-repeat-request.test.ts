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
 * the next free stylist. A request naming a DIFFERENT stylist is not the same
 * request: one account booking two people at once is deliberate.
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

test('an "Anyone" retry finds the request whichever stylist it was made with', async () => {
  const f = fixture();
  const first = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  const anyone = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  assert.equal(anyone.id, first.id);
  assert.equal(anyone.repeat, true);
  assert.equal(anyone.stylistId, 'lox');
  assert.equal(f.rows.length, 1);
});

test('a second booking naming a different stylist at the same time is a new booking, not a repeat', async () => {
  const f = fixture();
  const first = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  const second = await f.service.createBooking({ ...request(), stylistId: 'funky' });
  assert.equal(second.repeat, false);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(f.rows.map((row) => row.stylistId), ['lox', 'funky']);
  assert.deepEqual(f.notices, [
    'appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT', 'appointment-2/REQUEST_RECEIVED', 'appointment-2/SALON_ALERT',
  ], 'each booking gets its own receipt and salon alert');
});

test('after an "Anyone" request, naming the stylist it was given is a repeat; naming another is a new booking', async () => {
  const f = fixture();
  const anyone = await f.service.createBookingForFirstAvailable({ ...request(), candidateStylistIds: STYLISTS });
  assert.equal(anyone.stylistId, 'funky');
  const same = await f.service.createBooking({ ...request(), stylistId: 'funky' });
  assert.equal(same.repeat, true);
  assert.equal(same.id, anyone.id);
  const other = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  assert.equal(other.repeat, false);
  assert.equal(f.rows.length, 2);
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
  test(`submitBooking: a repeated ${stylistId === ANY_STYLIST_ID ? 'Anyone' : 'named-stylist'} request books and queues nothing new, but refreshes the feed and delivers again`, async () => {
    const f = fixture();
    const input = { stylistId, serviceId: 'service-1', date: TUESDAY, time: '11:00', expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 } };
    assert.deepEqual(await f.actions.submitBooking(input), { success: true });
    assert.deepEqual(await f.actions.submitBooking(input), { success: true, alreadyRequested: true }, 'the wizard says the request already exists');
    assert.equal(f.rows.length, 1);
    assert.deepEqual(f.notices, ['appointment-1/REQUEST_RECEIVED', 'appointment-1/SALON_ALERT'], 'no second receipt and no second salon alert');
    // Both are idempotent: a second refresh costs one feed rebuild, and the
    // dispatch finds the first attempt's emails already sent.
    assert.equal(f.effects.feedInvalidations, 2, 'the repeat refreshes the busy feed too');
    assert.deepEqual(f.effects.dispatchedFor, ['appointment-1', 'appointment-1'], 'and delivers whatever is still queued for that booking');
  });
}

// The first attempt's transaction can commit and its answer still be lost (the
// connection drops on COMMIT): its post-commit steps never ran. The retry is
// the only request left to run them.
test('submitBooking: a retry after a committed-but-lost first attempt refreshes the busy feed and sends its queued emails', async () => {
  const f = fixture();
  const committed = await f.service.createBooking({ ...request(), stylistId: 'lox' });
  assert.equal(f.effects.feedInvalidations + f.effects.dispatches, 0, 'the lost attempt ran none of its post-commit steps');
  const input = { stylistId: 'lox', serviceId: 'service-1', date: TUESDAY, time: '11:00', expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 } };
  assert.deepEqual(await f.actions.submitBooking(input), { success: true, alreadyRequested: true });
  assert.equal(f.rows.length, 1);
  assert.equal(f.effects.feedInvalidations, 1);
  assert.deepEqual(f.effects.dispatchedFor, [committed.id]);
});

test('submitBooking: a second booking naming a different stylist is made, and not flagged as already requested', async () => {
  const f = fixture();
  const input = (stylistId: string) => ({ stylistId, serviceId: 'service-1', date: TUESDAY, time: '11:00', expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 } });
  assert.deepEqual(await f.actions.submitBooking(input('lox')), { success: true });
  assert.deepEqual(await f.actions.submitBooking(input('funky')), { success: true });
  assert.deepEqual(f.rows.map((row) => row.stylistId), ['lox', 'funky']);
  assert.equal(f.effects.feedInvalidations, 2);
  assert.equal(f.effects.dispatches, 2);
});
