import test from 'node:test';
import assert from 'node:assert/strict';
import { isRescheduleRequestExpired, isRescheduleRequestMoot, rescheduleRequestView } from './reschedule-request';

const now = new Date('2099-09-01T12:00:00Z');
/** A booking whose original time is still well ahead of `now`. */
const ahead = new Date('2099-09-14T12:00:00Z');

test('a request lapses once its requested time is less than 24 hours away', () => {
  assert.equal(isRescheduleRequestExpired(new Date('2099-09-02T12:00:00Z'), now), false, 'exactly 24 h is still open');
  assert.equal(isRescheduleRequestExpired(new Date('2099-09-02T11:59:00Z'), now), true);
  assert.equal(isRescheduleRequestExpired('2099-08-31T12:00:00.000Z', now), true, 'a past time is expired');
});

test('the view model distinguishes no request, an open request and an expired one', () => {
  assert.deepEqual(rescheduleRequestView({ date: ahead, rescheduleRequestedDate: null, rescheduleRequestedAt: null }, now), { state: 'none' });
  assert.deepEqual(
    rescheduleRequestView({ date: ahead, rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T11:00:00Z') }, now),
    { state: 'open', requestedDate: '2099-09-10T09:00:00.000Z', requestedAt: '2099-09-01T11:00:00.000Z' },
  );
  assert.deepEqual(
    rescheduleRequestView({ date: ahead, rescheduleRequestedDate: '2099-09-02T09:00:00.000Z', rescheduleRequestedAt: '2099-08-30T10:00:00.000Z' }, now),
    { state: 'expired', requestedDate: '2099-09-02T09:00:00.000Z', requestedAt: '2099-08-30T10:00:00.000Z' },
  );
});

test('half a request (one field set) is treated as no request', () => {
  assert.deepEqual(rescheduleRequestView({ date: ahead, rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: null }, now), { state: 'none' });
});

// Staff could otherwise "move" a visit that already happened: the customer would
// get a "moved" email and a chair would be held for a booking that is over.
test('a request is moot once the booking\'s original time has passed, whatever the requested time', () => {
  const requested = { rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z') };
  assert.equal(isRescheduleRequestMoot({ date: ahead, ...requested }, now), false, 'original ahead and requested time over 24 h away: still open');
  assert.equal(isRescheduleRequestMoot({ date: new Date('2099-09-01T11:00:00Z'), ...requested }, now), true, 'original already passed');
  assert.equal(isRescheduleRequestMoot({ date: '2099-09-01T12:00:00.000Z', ...requested }, now), true, 'original starting right now');
  assert.equal(isRescheduleRequestMoot({ date: ahead, rescheduleRequestedDate: '2099-09-02T09:00:00.000Z' }, now), true, 'requested time under 24 h away');
});

test('the view shows a request on a booking whose original time has passed as expired', () => {
  assert.deepEqual(
    rescheduleRequestView({ date: new Date('2099-08-31T12:00:00Z'), rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-08-30T10:00:00Z') }, now),
    { state: 'expired', requestedDate: '2099-09-10T09:00:00.000Z', requestedAt: '2099-08-30T10:00:00.000Z' },
  );
});
