import test from 'node:test';
import assert from 'node:assert/strict';
import { isArrivalWindowOpen, isLateCancelCandidate, isLateCancelRestorable, lateCancelDueAt, lateCancelWindow } from './late-arrival';

const START = new Date('2099-09-01T10:00:00Z');
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const SINCE = new Date('2099-08-01T00:00:00Z');
const row = (over: Partial<{ status: string; arrivedAt: Date | null; date: Date }> = {}) => ({ status: 'CONFIRMED', arrivedAt: null, date: START, ...over });

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
  assert.equal(isLateCancelCandidate(row(), at(1), at(30)), false, 'started before switch-on');
  assert.equal(isLateCancelCandidate(row(), START, at(30)), false, 'start equal to switch-on is not after it');
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
