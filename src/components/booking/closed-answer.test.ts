import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBookingClosedAnswer } from './closed-answer';

test('a lookup refused because booking is closed is "closed"', () => {
  assert.equal(isBookingClosedAnswer({ ok: false, reason: 'CLOSED' }), true);
});

test('a request refused because booking is closed is "closed"', () => {
  assert.equal(isBookingClosedAnswer({ success: false, code: 'MAINTENANCE', error: 'Online booking is closed…' } as { success: boolean; code?: string }), true);
});

test('a failed lookup, an empty day and a refused time are not "closed"', () => {
  assert.equal(isBookingClosedAnswer({ ok: false }), false, 'could not load — the page says so, with a retry');
  assert.equal(isBookingClosedAnswer({ ok: true }), false);
  assert.equal(isBookingClosedAnswer({ success: false, code: 'SLOT_UNAVAILABLE' }), false);
  assert.equal(isBookingClosedAnswer({ success: false, code: 'BOOKING_TOO_SOON' }), false);
  assert.equal(isBookingClosedAnswer({ success: true }), false);
});
