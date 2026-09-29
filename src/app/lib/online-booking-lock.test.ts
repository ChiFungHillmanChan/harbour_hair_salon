import test from 'node:test';
import assert from 'node:assert/strict';
import { isOnlineBookingLockedForPayments, SQUARE_DEPOSITS_WIRED } from './online-booking-lock';

test('production is locked while Square deposits are not wired; other environments stay testable', () => {
  assert.equal(SQUARE_DEPOSITS_WIRED, false, 'flip only in the change that takes the deposit in submitBooking');
  assert.equal(isOnlineBookingLockedForPayments({ VERCEL_ENV: 'production' }), true);
  assert.equal(isOnlineBookingLockedForPayments({ VERCEL_ENV: 'preview' }), false);
  assert.equal(isOnlineBookingLockedForPayments({}), false);
});
