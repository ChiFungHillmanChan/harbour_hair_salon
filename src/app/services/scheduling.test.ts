import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, hasConflict, firstFreeStylist } from './scheduling';
import { buildSlotsForWindow } from './scheduling';
import { resolveSalonDateTime } from './salon-time';

const at = (iso: string) => new Date(iso);

test('overlaps — back-to-back appointments do not overlap', () => {
  // 10:00–10:30 vs 10:30–11:00
  assert.equal(overlaps(at('2026-07-01T10:00:00Z'), 30, at('2026-07-01T10:30:00Z'), 30), false);
});

test('overlaps — identical slots overlap', () => {
  assert.equal(overlaps(at('2026-07-01T10:00:00Z'), 30, at('2026-07-01T10:00:00Z'), 30), true);
});

test('overlaps — partial overlap is detected', () => {
  assert.equal(overlaps(at('2026-07-01T10:00:00Z'), 30, at('2026-07-01T10:15:00Z'), 30), true);
});

test('overlaps — containment is detected (either direction)', () => {
  assert.equal(overlaps(at('2026-07-01T10:00:00Z'), 60, at('2026-07-01T10:15:00Z'), 15), true);
  assert.equal(overlaps(at('2026-07-01T10:15:00Z'), 15, at('2026-07-01T10:00:00Z'), 60), true);
});

test('overlaps — adjacency on the left edge does not overlap', () => {
  // 10:00–10:30 vs 09:30–10:00
  assert.equal(overlaps(at('2026-07-01T10:00:00Z'), 30, at('2026-07-01T09:30:00Z'), 30), false);
});

test('hasConflict — no existing appointments → false', () => {
  assert.equal(hasConflict(at('2026-07-01T10:00:00Z'), 30, []), false);
});

test('hasConflict — overlapping existing appointment → true', () => {
  assert.equal(
    hasConflict(at('2026-07-01T10:00:00Z'), 30, [{ start: at('2026-07-01T10:15:00Z'), durationMin: 30 }]),
    true,
  );
});

test('firstFreeStylist — returns the first candidate with no conflict (order preserved)', () => {
  const booked = new Map([
    ['a', [{ start: at('2026-07-01T10:00:00Z'), durationMin: 30 }]],
    ['b', []],
  ]);
  const got = firstFreeStylist(['a', 'b'], at('2026-07-01T10:00:00Z'), 30, booked);
  assert.equal(got, 'b');
});

test('firstFreeStylist — prefers the earliest candidate when several are free', () => {
  const booked = new Map<string, { start: Date; durationMin: number }[]>([['a', []], ['b', []]]);
  assert.equal(firstFreeStylist(['a', 'b'], at('2026-07-01T10:00:00Z'), 30, booked), 'a');
});

test('firstFreeStylist — returns null when every candidate is busy', () => {
  const booked = new Map([
    ['a', [{ start: at('2026-07-01T10:00:00Z'), durationMin: 30 }]],
    ['b', [{ start: at('2026-07-01T10:00:00Z'), durationMin: 60 }]],
  ]);
  assert.equal(firstFreeStylist(['a', 'b'], at('2026-07-01T10:00:00Z'), 30, booked), null);
});

test('buildSlotsForWindow — hides the slot a booking actually occupies (BST, host-TZ independent)', () => {
  const dateStr = '2026-07-01'; // BST: salon local is UTC+1
  const now = new Date('2026-06-01T00:00:00Z'); // well before the day, nothing hidden as "past"
  // A 60-min booking at 10:00 salon-local, stored the way createBooking stores it.
  const booked = [{ start: resolveSalonDateTime(dateStr, '10:00').utc, durationMin: 60 }];
  const times = buildSlotsForWindow(dateStr, { startTime: '09:00', endTime: '17:00' }, booked, 30, now).map((s) => s.time);
  assert.ok(!times.includes('10:00'), '10:00 is booked and must not be offered');
  assert.ok(!times.includes('10:30'), '10:30 overlaps the booking and must not be offered');
  assert.ok(times.includes('09:00'), '09:00 is free and must be offered');
  assert.ok(times.includes('11:00'), '11:00 is free and must be offered');
});

test('buildSlotsForWindow — hides slots at or before now', () => {
  const dateStr = '2026-07-01';
  const now = resolveSalonDateTime(dateStr, '11:00').utc; // it is currently 11:00 salon-local
  const times = buildSlotsForWindow(dateStr, { startTime: '09:00', endTime: '13:00' }, [], 30, now).map((s) => s.time);
  assert.ok(!times.includes('09:00'), 'past slot hidden');
  assert.ok(!times.includes('11:00'), 'slot equal to now is hidden');
  assert.ok(times.includes('11:30'), 'future slot offered');
});

test('buildSlotsForWindow — does not offer a slot whose service runs past closing', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const times = buildSlotsForWindow('2026-07-01', { startTime: '09:00', endTime: '10:00' }, [], 45, now).map((s) => s.time);
  assert.ok(times.includes('09:00'), '09:00 + 45min = 09:45 <= 10:00, offered');
  assert.ok(!times.includes('09:30'), '09:30 + 45min = 10:15 > 10:00, not offered');
});

test('buildSlotsForWindow — a service that finishes exactly at closing is still offered (loop bound is <=)', () => {
  // 09:00 + 60min = 10:00 == endMins. The slot-loop guard is
  // `mins + serviceDuration <= endMins`; a `<`-mutant would drop this only slot
  // and leave the grid empty, so this pins the closing-boundary equality.
  const now = new Date('2026-06-01T00:00:00Z');
  const times = buildSlotsForWindow('2026-07-10', { startTime: '09:00', endTime: '10:00' }, [], 60, now).map((s) => s.time);
  assert.deepEqual(times, ['09:00'], '09:00 + 60min = 10:00 exactly fills the window and must be the sole offered slot');
});
