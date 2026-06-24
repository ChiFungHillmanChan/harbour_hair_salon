import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentWorkedMinutes, totalWorkedHours, splitRegularOvertime, totalWorkedMinutes, applyBreakDeduction } from './timesheet-calc';

const seg = (inH: number, outH: number, brk = 0) => ({
  clockIn: new Date(`2026-06-01T${String(inH).padStart(2, '0')}:00:00Z`),
  clockOut: new Date(`2026-06-01T${String(outH).padStart(2, '0')}:00:00Z`),
  breakMinutes: brk,
});

test('segmentWorkedMinutes subtracts break minutes', () => {
  assert.equal(segmentWorkedMinutes(seg(9, 17, 30)), 8 * 60 - 30); // 450
});

test('segmentWorkedMinutes never returns negative', () => {
  assert.equal(segmentWorkedMinutes(seg(9, 9, 30)), 0);
});

test('totalWorkedHours sums segments in hours', () => {
  assert.equal(totalWorkedHours([seg(9, 13), seg(14, 18)]), 8); // 4 + 4
});

test('splitRegularOvertime returns all-regular when disabled', () => {
  assert.deepEqual(splitRegularOvertime(50, { enabled: false, thresholdHours: 40 }), {
    regularHours: 50,
    overtimeHours: 0,
  });
});

test('splitRegularOvertime splits at threshold when enabled', () => {
  assert.deepEqual(splitRegularOvertime(50, { enabled: true, thresholdHours: 40 }), {
    regularHours: 40,
    overtimeHours: 10,
  });
});

test('splitRegularOvertime — under threshold yields no overtime', () => {
  assert.deepEqual(splitRegularOvertime(30, { enabled: true, thresholdHours: 40 }), {
    regularHours: 30,
    overtimeHours: 0,
  });
});

test('totalWorkedMinutes sums segment minutes', () => {
  assert.equal(totalWorkedMinutes([seg(9, 13), seg(14, 18)]), 8 * 60);
});

test('applyBreakDeduction subtracts perDay break × days, floored at 0', () => {
  assert.equal(applyBreakDeduction(480, 2, 30), 420);
  assert.equal(applyBreakDeduction(20, 5, 30), 0);
  assert.equal(applyBreakDeduction(480, 3, 0), 480);
  assert.equal(applyBreakDeduction(480, 2, -10), 480); // negative perDay treated as 0
});
