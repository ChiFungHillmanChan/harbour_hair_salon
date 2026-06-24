import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShift } from './shift-flags';

// Shift: 09:00–17:00 (start=540, end=1020), grace=5 min

test('late beyond grace is flagged', () => {
  // Clocked in at 09:10 (550 min) — 10 min late, grace 5 → flagged
  const r = evaluateShift({ shiftStartMin: 540, shiftEndMin: 1020, firstInMin: 550, lastOutMin: 1020, graceMin: 5 });
  assert.equal(r.late, true);
  assert.equal(r.lateByMin, 10);
  assert.equal(r.earlyLeave, false);
  assert.equal(r.earlyByMin, 0);
});

test('within grace is not flagged as late', () => {
  // Clocked in at 09:04 (544 min) — 4 min late, grace 5 → not flagged
  const r = evaluateShift({ shiftStartMin: 540, shiftEndMin: 1020, firstInMin: 544, lastOutMin: 1020, graceMin: 5 });
  assert.equal(r.late, false);
  assert.equal(r.lateByMin, 0);
});

test('early-leave beyond grace is flagged', () => {
  // Clocked out at 16:48 (1008 min) — 12 min early, grace 5 → flagged
  const r = evaluateShift({ shiftStartMin: 540, shiftEndMin: 1020, firstInMin: 540, lastOutMin: 1008, graceMin: 5 });
  assert.equal(r.earlyLeave, true);
  assert.equal(r.earlyByMin, 12);
  assert.equal(r.late, false);
  assert.equal(r.lateByMin, 0);
});

test('exactly at grace boundary is not flagged (strictly greater-than)', () => {
  // Late by exactly graceMin (5) → not flagged; early by exactly graceMin (5) → not flagged
  const r = evaluateShift({ shiftStartMin: 540, shiftEndMin: 1020, firstInMin: 545, lastOutMin: 1015, graceMin: 5 });
  assert.equal(r.late, false);
  assert.equal(r.lateByMin, 0);
  assert.equal(r.earlyLeave, false);
  assert.equal(r.earlyByMin, 0);
});

test('on-time both ends — no flags', () => {
  const r = evaluateShift({ shiftStartMin: 540, shiftEndMin: 1020, firstInMin: 540, lastOutMin: 1020, graceMin: 5 });
  assert.equal(r.late, false);
  assert.equal(r.lateByMin, 0);
  assert.equal(r.earlyLeave, false);
  assert.equal(r.earlyByMin, 0);
});
