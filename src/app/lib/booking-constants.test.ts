import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_BOOKING_NOTICE_MINUTES, isReminderDueAfterConfirmation, meetsMinimumNotice } from './booking-constants';
import { resolveSalonDateTime } from '../services/salon-time';

test('a reminder is due 12 hours after the confirmation, and at once when no confirmation is known', () => {
  const confirmed = new Date('2026-11-10T10:00:00Z');
  assert.equal(isReminderDueAfterConfirmation(confirmed, new Date('2026-11-10T21:59:59Z')), false);
  assert.equal(isReminderDueAfterConfirmation(confirmed, new Date('2026-11-10T22:00:00Z')), true);
  assert.equal(isReminderDueAfterConfirmation(null, confirmed), true);
});

test('online requests need two hours of notice by default', () => {
  assert.equal(MIN_BOOKING_NOTICE_MINUTES, 120);
});

test('exactly the notice period is enough; a minute less is not', () => {
  const now = new Date('2026-10-13T09:00:00Z');
  assert.equal(meetsMinimumNotice(new Date('2026-10-13T11:00:00Z'), now), true);
  assert.equal(meetsMinimumNotice(new Date('2026-10-13T10:59:00Z'), now), false);
  assert.equal(meetsMinimumNotice(new Date('2026-10-13T08:00:00Z'), now), false, 'a time already gone is never enough notice');
  assert.equal(meetsMinimumNotice(new Date('2026-10-13T09:30:00Z'), now, 30), true, 'the period can be passed in');
});

test('notice is measured in real time while the clocks go back (25 Oct 2026)', () => {
  // 00:30Z is 01:30 BST. At 01:00Z the clocks go back to 01:00 GMT.
  const now = new Date('2026-10-25T00:30:00Z');
  // 02:30 GMT is 120 real minutes away, though the wall clock moves only 60.
  assert.equal(meetsMinimumNotice(resolveSalonDateTime('2026-10-25', '02:30').utc, now), true);
  // 02:00 GMT is 90 real minutes away, though the wall clock moves only 30.
  assert.equal(meetsMinimumNotice(resolveSalonDateTime('2026-10-25', '02:00').utc, now), false);
});

test('notice is measured in real time while the clocks go forward (28 Mar 2027)', () => {
  // 00:30Z is 00:30 GMT. At 01:00Z the clocks go forward to 02:00 BST.
  const now = new Date('2027-03-28T00:30:00Z');
  // 03:30 BST (02:30Z) is 120 real minutes away, though the wall clock moves 180.
  assert.equal(meetsMinimumNotice(resolveSalonDateTime('2027-03-28', '03:30').utc, now), true);
  // 03:00 BST (02:00Z) is only 90 real minutes away, though the wall clock moves 150.
  assert.equal(meetsMinimumNotice(resolveSalonDateTime('2027-03-28', '03:00').utc, now), false);
});
