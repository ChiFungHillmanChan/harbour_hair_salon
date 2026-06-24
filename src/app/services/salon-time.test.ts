import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSalonDateTime,
  isWithinAvailability,
  isValidSalonTime,
  isValidSalonDate,
  salonDayWindow,
  salonDateKey,
  salonMinutesOfDay,
} from './salon-time';

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

test('isWithinAvailability — a time inside the window is allowed', () => {
  assert.equal(isWithinAvailability(660, '10:00', '19:30'), true); // 11:00, not the boundary
});

test('isWithinAvailability — start boundary is inclusive', () => {
  assert.equal(isWithinAvailability(600, '10:00', '19:30'), true); // 10:00 == start
});

test('isWithinAvailability — before opening is rejected', () => {
  assert.equal(isWithinAvailability(599, '10:00', '19:30'), false);
});

test('isWithinAvailability — at/after closing is rejected', () => {
  assert.equal(isWithinAvailability(19 * 60 + 30, '10:00', '19:30'), false);
});

test('isWithinAvailability — inverted and zero-width windows admit nothing', () => {
  assert.equal(isWithinAvailability(600, '19:00', '10:00'), false);
  assert.equal(isWithinAvailability(600, '10:00', '10:00'), false);
});

test('resolveSalonDateTime — malformed time yields an invalid instant (callers must guard)', () => {
  const r = resolveSalonDateTime('2026-07-01', 'abc');
  assert.equal(Number.isNaN(r.utc.getTime()), true);
  assert.equal(Number.isNaN(r.timeMinutes), true);
});

test('isValidSalonTime accepts HH:mm and rejects malformed', () => {
  for (const ok of ['10:00', '00:00', '23:59', '09:30']) assert.equal(isValidSalonTime(ok), true);
  for (const bad of ['', 'abc', '99:99', '24:00', '9:00', '10:0', '10:60']) assert.equal(isValidSalonTime(bad), false);
});

test('isValidSalonDate accepts YYYY-MM-DD and rejects malformed', () => {
  for (const ok of ['2026-07-01', '2000-01-01']) assert.equal(isValidSalonDate(ok), true);
  for (const bad of ['', 'abc', '2026-7-1', '07/01/2026', '2026-07-01T10:00']) assert.equal(isValidSalonDate(bad), false);
});

test('salonDayWindow — BST date maps to the London calendar day in UTC', () => {
  const w = salonDayWindow(new Date('2026-07-01T12:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-06-30T23:00:00.000Z'); // 00:00 BST
  assert.equal(w.end.toISOString(), '2026-07-01T22:59:59.999Z'); // 23:59:59.999 BST
});

test('salonDayWindow — GMT date maps to the same UTC calendar day', () => {
  const w = salonDayWindow(new Date('2026-01-15T12:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-01-15T00:00:00.000Z');
  assert.equal(w.end.toISOString(), '2026-01-15T23:59:59.999Z');
});

test('salonDayWindow — late-evening BST instant stays on the same salon day', () => {
  const w = salonDayWindow(new Date('2026-07-01T22:30:00Z')); // 23:30 London
  assert.equal(w.start.toISOString(), '2026-06-30T23:00:00.000Z');
});

test('salonDayWindow — UTC-midnight date input resolves to that calendar day', () => {
  // The wizard sends new Date('YYYY-MM-DD') = UTC midnight; window must cover that day.
  const w = salonDayWindow(new Date('2026-07-01T00:00:00.000Z'));
  assert.equal(w.start.toISOString(), '2026-06-30T23:00:00.000Z');
  assert.equal(w.end.toISOString(), '2026-07-01T22:59:59.999Z');
});

test('salonDateKey — late-evening BST instant maps to that London day', () => {
  assert.equal(salonDateKey(new Date('2026-07-01T22:30:00Z')), '2026-07-01'); // 23:30 London
});

test('salonDateKey — GMT instant', () => {
  assert.equal(salonDateKey(new Date('2026-01-15T09:30:00Z')), '2026-01-15');
});

test('salonMinutesOfDay — BST instant 09:00 UTC is 10:00 salon (600 min)', () => {
  // 2026-07-01 09:00 UTC = 10:00 BST (UTC+1)
  assert.equal(salonMinutesOfDay(new Date('2026-07-01T09:00:00Z')), 600);
});

test('salonMinutesOfDay — GMT instant 09:30 UTC is 09:30 salon (570 min)', () => {
  // 2026-01-15 09:30 UTC = 09:30 GMT (UTC+0)
  assert.equal(salonMinutesOfDay(new Date('2026-01-15T09:30:00Z')), 570);
});
