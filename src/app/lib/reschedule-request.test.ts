import test from 'node:test';
import assert from 'node:assert/strict';
import { isRescheduleRequestExpired, rescheduleRequestView } from './reschedule-request';

const now = new Date('2099-09-01T12:00:00Z');

test('a request lapses once its requested time is less than 24 hours away', () => {
  assert.equal(isRescheduleRequestExpired(new Date('2099-09-02T12:00:00Z'), now), false, 'exactly 24 h is still open');
  assert.equal(isRescheduleRequestExpired(new Date('2099-09-02T11:59:00Z'), now), true);
  assert.equal(isRescheduleRequestExpired('2099-08-31T12:00:00.000Z', now), true, 'a past time is expired');
});

test('the view model distinguishes no request, an open request and an expired one', () => {
  assert.deepEqual(rescheduleRequestView({ rescheduleRequestedDate: null, rescheduleRequestedAt: null }, now), { state: 'none' });
  assert.deepEqual(
    rescheduleRequestView({ rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: new Date('2099-09-01T11:00:00Z') }, now),
    { state: 'open', requestedDate: '2099-09-10T09:00:00.000Z', requestedAt: '2099-09-01T11:00:00.000Z' },
  );
  assert.deepEqual(
    rescheduleRequestView({ rescheduleRequestedDate: '2099-09-02T09:00:00.000Z', rescheduleRequestedAt: '2099-08-30T10:00:00.000Z' }, now),
    { state: 'expired', requestedDate: '2099-09-02T09:00:00.000Z', requestedAt: '2099-08-30T10:00:00.000Z' },
  );
});

test('half a request (one field set) is treated as no request', () => {
  assert.deepEqual(rescheduleRequestView({ rescheduleRequestedDate: new Date('2099-09-10T09:00:00Z'), rescheduleRequestedAt: null }, now), { state: 'none' });
});
