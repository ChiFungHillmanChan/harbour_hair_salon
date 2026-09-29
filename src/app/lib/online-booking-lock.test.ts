import test from 'node:test';
import assert from 'node:assert/strict';
import { isOnlineBookingLockedForPayments, SQUARE_DEPOSITS_WIRED } from './online-booking-lock';

test('every production build is locked while Square deposits are not wired; other runs stay testable', () => {
  assert.equal(SQUARE_DEPOSITS_WIRED, false, 'flip only in the change that takes the deposit in submitBooking');
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production', VERCEL_ENV: 'production' }), true);
  // Fails closed if Vercel ever stops exposing VERCEL_ENV at runtime.
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production' }), true);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }), false);
  assert.equal(isOnlineBookingLockedForPayments({ NODE_ENV: 'development' }), false);
  assert.equal(isOnlineBookingLockedForPayments({}), false);
});
