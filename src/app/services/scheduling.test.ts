import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, hasConflict, firstFreeStylist } from './scheduling';

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
