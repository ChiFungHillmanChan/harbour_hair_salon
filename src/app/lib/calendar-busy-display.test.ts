import test from 'node:test';
import assert from 'node:assert/strict';
import { isWholeDayBlock, salonWorkingWindow } from './calendar-busy-display';

test('a Pause that overshoots the stylist’s hours covers the working day', () => {
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1230 }, { startTime: '10:15', endTime: '19:00' }), true);
});

test('a lunch block does not', () => {
  assert.equal(isWholeDayBlock({ startMin: 780, endMin: 840 }, { startTime: '10:00', endTime: '19:00' }), false);
});

test('a block that stops before closing does not', () => {
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1080 }, { startTime: '10:00', endTime: '19:00' }), false);
});

test('with no working window only a midnight-to-midnight block counts', () => {
  assert.equal(isWholeDayBlock({ startMin: 0, endMin: 1440 }, null), true);
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1230 }, null), false);
});

test('the salon window is the earliest start and latest finish of anyone rostered', () => {
  assert.deepEqual(salonWorkingWindow([{ startTime: '10:15', endTime: '19:00' }, null, { startTime: '10:00', endTime: '19:30' }, undefined]), { startTime: '10:00', endTime: '19:30' });
  assert.equal(salonWorkingWindow([null, undefined]), null);
});
