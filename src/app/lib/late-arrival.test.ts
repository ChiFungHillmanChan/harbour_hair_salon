import test from 'node:test';
import assert from 'node:assert/strict';
import { isArrivalWindowOpen, isLateCancelCandidate, isLateCancelRestorable, lateCancelDueAt, lateCancelWindow, lateCancelReaches } from './late-arrival';

const START = new Date('2099-09-01T10:00:00Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const SINCE = new Date('2099-08-01T00:00:00Z');
type Candidate = { status: string; arrivedAt: Date | null; date: Date; createdAt: Date; rescheduleRequestedAt: Date | null };
/** Booked a week after the switch-on, under the new terms. */
const row = (over: Partial<Candidate> = {}): Candidate => ({
  status: 'CONFIRMED', arrivedAt: null, date: START, createdAt: new Date('2099-08-08T00:00:00Z'), rescheduleRequestedAt: null, ...over,
});

test('due 15 minutes after the start', () => {
  assert.equal(lateCancelDueAt(START).toISOString(), at(15).toISOString());
});

test('candidate only from minute 15 to minute 120, CONFIRMED, not arrived, after switch-on', () => {
  assert.equal(isLateCancelCandidate(row(), SINCE, at(14)), false);
  assert.equal(isLateCancelCandidate(row(), SINCE, at(15)), true);
  assert.equal(isLateCancelCandidate(row(), SINCE, at(120)), true);
  assert.equal(isLateCancelCandidate(row(), SINCE, at(121)), false);
  assert.equal(isLateCancelCandidate(row({ status: 'PENDING' }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row({ status: 'COMPLETED' }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row({ arrivedAt: at(5) }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row(), null, at(30)), false, 'switched off');
  // Made after the switch-on (a time staff entered afterwards), so only the start rules these out.
  assert.equal(isLateCancelCandidate(row({ createdAt: at(2) }), at(1), at(30)), false, 'started before switch-on');
  assert.equal(isLateCancelCandidate(row({ createdAt: at(2) }), START, at(30)), false, 'start equal to switch-on is not after it');
});

// The customer asked to move it (late-arrival final review I3): they did
// contact the salon, so staff answer the request; the rule never cancels it.
test('a booking with an open reschedule request is never a candidate', () => {
  assert.equal(isLateCancelCandidate(row({ rescheduleRequestedAt: at(-24 * 60) }), SINCE, at(30)), false);
  assert.equal(lateCancelReaches(row({ rescheduleRequestedAt: at(-24 * 60) }), SINCE), false);
});

// Made before the switch-on, under the old terms (final review M9): never cancelled, even when it starts after.
test('a booking made before (or at) the switch-on is never a candidate', () => {
  assert.equal(isLateCancelCandidate(row({ createdAt: new Date('2099-07-31T23:59:00Z') }), SINCE, at(30)), false);
  assert.equal(isLateCancelCandidate(row({ createdAt: SINCE }), SINCE, at(30)), false, 'made at the switch-on instant is not after it');
  assert.equal(isLateCancelCandidate(row({ createdAt: new Date(SINCE.getTime() + 1) }), SINCE, at(30)), true);
  // ISO strings (the arrivals panel) read the same way.
  assert.equal(isLateCancelCandidate({ ...row(), date: START.toISOString(), createdAt: '2099-07-31T00:00:00.000Z' } as never, SINCE, at(30)), false);
});

test('lateCancelReaches: whether the rule will ever reach a booking, whatever the time now', () => {
  assert.equal(lateCancelReaches(row(), SINCE), true);
  assert.equal(lateCancelReaches(row(), null), false, 'switched off');
  assert.equal(lateCancelReaches(row({ arrivedAt: at(-5) }), SINCE), false);
  assert.equal(lateCancelReaches(row({ status: 'PENDING' }), SINCE), false);
  assert.equal(lateCancelReaches(row(), START), false, 'starts at the switch-on');
  assert.equal(lateCancelReaches(row({ createdAt: new Date('2099-07-01T00:00:00Z') }), SINCE), false, 'made before the switch-on');
});

test('arrival window: 60 minutes before the start to the later of end and start+120', () => {
  assert.equal(isArrivalWindowOpen(START, 30, at(-61)), false);
  assert.equal(isArrivalWindowOpen(START, 30, at(-60)), true);
  assert.equal(isArrivalWindowOpen(START, 15, at(100)), true, 'short service: lookback keeps it open');
  assert.equal(isArrivalWindowOpen(START, 15, at(121)), false);
  assert.equal(isArrivalWindowOpen(START, 180, at(170)), true, 'long service: open until its end');
  assert.equal(isArrivalWindowOpen(START, 180, at(181)), false);
});

test('restorable for 24 hours after the automatic cancellation', () => {
  assert.equal(isLateCancelRestorable(null, at(30)), false);
  assert.equal(isLateCancelRestorable(at(30), at(30 + 24 * 60)), true);
  assert.equal(isLateCancelRestorable(at(30), at(30 + 24 * 60 + 1)), false);
});

test('query window bounds', () => {
  const now = at(30);
  assert.deepEqual(lateCancelWindow(now, SINCE), { gt: SINCE, gte: at(-90), lte: at(15) });
});
