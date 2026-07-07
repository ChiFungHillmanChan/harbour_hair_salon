import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSalonDateTime,
  isWithinAvailability,
  fitsWithinAvailability,
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

test('fitsWithinAvailability — start in-hours but service overruns closing is rejected', () => {
  // 09:00-18:00 window. 17:30 start + 240min = 21:30 → past close.
  assert.equal(fitsWithinAvailability(17 * 60 + 30, 240, '09:00', '18:00'), false);
});

test('fitsWithinAvailability — service finishing exactly at close is allowed', () => {
  assert.equal(fitsWithinAvailability(17 * 60, 60, '09:00', '18:00'), true); // 17:00 + 60 = 18:00
});

test('fitsWithinAvailability — start before opening is rejected', () => {
  assert.equal(fitsWithinAvailability(8 * 60, 30, '09:00', '18:00'), false);
});

// --- DST transition days (Europe/London) ---------------------------------
// UK clocks: spring-forward on the last Sunday of March (01:00 GMT → 02:00
// BST, skipping 01:00–01:59:59.999 — those wall-clock times never occur);
// fall-back on the last Sunday of October (02:00 BST → 01:00 GMT, so
// 01:00–01:59:59.999 occurs twice — those wall-clock times are ambiguous).
// `resolveSalonDateTime` doesn't (and can't) special-case these; it hands the
// wall-clock string to `date-fns-tz`'s `fromZonedTime`, which resolves both
// cases by treating the wall-clock digits as a UTC instant, reading the
// Europe/London offset AT THAT UTC instant, and subtracting it. These tests
// pin the concrete (verified) instants that algorithm produces today so a
// library upgrade that silently changes the resolution is caught.

test('resolveSalonDateTime — spring-forward gap (2026-03-29 01:30 does not exist as local time)', () => {
  // 2026-03-29 is the UK spring-forward date. The naive instant 01:30Z already
  // falls after the 01:00Z transition, so the BST (+1) offset is read back and
  // subtracted, landing on 00:30Z — which is itself 00:30 GMT (pre-transition),
  // NOT the "01:30" that was asked for. This is the documented gap behaviour:
  // a nonexistent wall-clock time cannot round-trip.
  const r = resolveSalonDateTime('2026-03-29', '01:30');
  assert.equal(r.utc.toISOString(), '2026-03-29T00:30:00.000Z');
  assert.equal(Number.isNaN(r.utc.getTime()), false); // always a valid instant, never NaN
  assert.equal(r.dateStr, '2026-03-29');
  assert.equal(r.timeMinutes, 90); // wall-clock arithmetic only (1*60+30), independent of DST
  assert.equal(r.dayOfWeek, 0); // Sunday
});

test('resolveSalonDateTime — fall-back ambiguity (2026-10-25 01:30 occurs twice as local time)', () => {
  // 2026-10-25 is the UK fall-back date. The naive instant 01:30Z falls after
  // the 01:00Z transition (BST → GMT), so the GMT (+0) offset is read back and
  // subtracted, landing on 01:30Z exactly — i.e. this resolves to the SECOND
  // (post-transition, GMT) occurrence of the ambiguous 01:30 wall-clock time,
  // not the first (BST) one.
  const r = resolveSalonDateTime('2026-10-25', '01:30');
  assert.equal(r.utc.toISOString(), '2026-10-25T01:30:00.000Z');
  assert.equal(Number.isNaN(r.utc.getTime()), false); // always a valid instant, never NaN
  assert.equal(r.dateStr, '2026-10-25');
  assert.equal(r.timeMinutes, 90);
  assert.equal(r.dayOfWeek, 0); // Sunday
});

test('salonDayWindow — fall-back day (2026-10-25) is ~25h long, not 24h', () => {
  // The salon-local day of the fall-back transition gains the repeated hour,
  // so its UTC span is one hour LONGER than a normal day's ~23:59:59.999.
  const w = salonDayWindow(new Date('2026-10-25T12:00:00Z'));
  assert.equal(w.start.toISOString(), '2026-10-24T23:00:00.000Z'); // 00:00 BST (still +1 before the 01:00Z transition)
  assert.equal(w.end.toISOString(), '2026-10-25T23:59:59.999Z'); // 23:59:59.999 GMT
  const durationMs = w.end.getTime() - w.start.getTime();
  // A normal day's window is 86,399,999ms (23:59:59.999). This one is exactly
  // one hour (3,600,000ms) longer: 89,999,999ms — one millisecond short of a
  // full 25 hours, reflecting the repeated 01:00–01:59:59.999 hour.
  assert.equal(durationMs, 89_999_999);
  assert.ok(durationMs > 24 * 3600_000 && durationMs < 25 * 3600_000);
});
