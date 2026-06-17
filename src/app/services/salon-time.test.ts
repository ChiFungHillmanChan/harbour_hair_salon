import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSalonDateTime, isWithinAvailability } from './salon-time';

// These assertions are host-timezone independent: they pin the salon wall-clock
// (Europe/London) to an absolute UTC instant. London is UTC+1 in summer (BST)
// and UTC+0 in winter (GMT).

test('summer (BST) salon wall-clock 10:00 → 09:00 UTC', () => {
  const r = resolveSalonDateTime('2026-07-01', '10:00');
  assert.equal(r.utc.toISOString(), '2026-07-01T09:00:00.000Z');
});

test('winter (GMT) salon wall-clock 09:30 → 09:30 UTC', () => {
  const r = resolveSalonDateTime('2026-01-15', '09:30');
  assert.equal(r.utc.toISOString(), '2026-01-15T09:30:00.000Z');
});

test('accepts a UTC-midnight Date for the calendar date', () => {
  const r = resolveSalonDateTime(new Date('2026-07-01T00:00:00.000Z'), '10:00');
  assert.equal(r.utc.toISOString(), '2026-07-01T09:00:00.000Z');
});

test('exposes salon-local calendar date, weekday and minutes', () => {
  // 2000-01-01 was a Saturday (getUTCDay === 6), winter so 10:00 London = 10:00 UTC.
  const r = resolveSalonDateTime('2000-01-01', '10:00');
  assert.equal(r.dateStr, '2000-01-01');
  assert.equal(r.dayOfWeek, 6);
  assert.equal(r.timeMinutes, 600);
  assert.equal(r.utc.toISOString(), '2000-01-01T10:00:00.000Z');
});

test('isWithinAvailability — inside the window is allowed', () => {
  assert.equal(isWithinAvailability(600, '10:00', '19:30'), true);
});

test('isWithinAvailability — start boundary is inclusive', () => {
  assert.equal(isWithinAvailability(600, '10:00', '19:30'), true);
});

test('isWithinAvailability — before opening is rejected', () => {
  assert.equal(isWithinAvailability(599, '10:00', '19:30'), false);
});

test('isWithinAvailability — at/after closing is rejected', () => {
  assert.equal(isWithinAvailability(19 * 60 + 30, '10:00', '19:30'), false);
});
