import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_DURATION_MINUTES,
  SNAP_MINUTES,
  applyMove,
  applyResizeBottom,
  applyResizeTop,
  minutesToOffset,
  offsetToMinutes,
  snapToStep,
} from './calendar-geometry';

// Bounds used by most tests: a 09:00–18:00 salon day, in minutes since midnight.
const DAY = { startMin: 9 * 60, endMin: 18 * 60 };

test('minutesToOffset measures from the grid origin, not from midnight', () => {
  // 10:00 on a grid that starts at 09:00, at 1px per minute, is 60px down.
  assert.equal(minutesToOffset(10 * 60, DAY.startMin, 1), 60);
  assert.equal(minutesToOffset(DAY.startMin, DAY.startMin, 1), 0);
});

test('offsetToMinutes is the exact inverse of minutesToOffset', () => {
  for (const pxPerMinute of [0.5, 1, 1.5, 64 / 60]) {
    for (const minutes of [540, 585, 720, 1080]) {
      const px = minutesToOffset(minutes, DAY.startMin, pxPerMinute);
      assert.equal(
        offsetToMinutes(px, DAY.startMin, pxPerMinute),
        minutes,
        `round-trip failed at ${minutes}min @ ${pxPerMinute}px/min`,
      );
    }
  }
});

test('snapToStep rounds to the nearest step', () => {
  assert.equal(snapToStep(7), 0);
  assert.equal(snapToStep(8), 15);
  assert.equal(snapToStep(22), 15);
  assert.equal(snapToStep(23), 30);
  assert.equal(snapToStep(30), 30, 'an exact multiple is left alone');
});

test('snapToStep rounds half-steps up, consistently in both directions', () => {
  // Regression guard: Math.round(-7.5) is -7, so a naive implementation snaps
  // negative half-steps the opposite way from positive ones and a block drifts
  // depending on which way you drag it.
  assert.equal(snapToStep(7.5), 15);
  assert.equal(snapToStep(-7.5), 0);
  assert.equal(snapToStep(-22.5), -15);
});

test('snapToStep honours a custom step', () => {
  assert.equal(snapToStep(7, 5), 5);
  assert.equal(snapToStep(7, 30), 0);
});

test('SNAP_MINUTES and MIN_DURATION_MINUTES are both 15', () => {
  assert.equal(SNAP_MINUTES, 15);
  assert.equal(MIN_DURATION_MINUTES, 15);
});

test('applyMove shifts the block and snaps the new start to the grid', () => {
  const moved = applyMove({ startMin: 600, durationMin: 60 }, 22, DAY);
  assert.deepEqual(moved, { startMin: 615, durationMin: 60 });
});

test('applyMove never changes the duration', () => {
  const moved = applyMove({ startMin: 600, durationMin: 180 }, -37, DAY);
  assert.equal(moved.durationMin, 180, 'moving a 3h colour must keep it 3h');
  assert.equal(moved.startMin, 570);
});

test('applyMove clamps at the end of the day without shrinking the block', () => {
  // A 60min block dragged far past 18:00 must come to rest ending exactly at
  // 18:00 — not hang off the grid, and not be silently shortened.
  const moved = applyMove({ startMin: 17 * 60, durationMin: 60 }, 600, DAY);
  assert.deepEqual(moved, { startMin: 17 * 60, durationMin: 60 });
});

test('applyMove clamps at the start of the day', () => {
  const moved = applyMove({ startMin: 10 * 60, durationMin: 60 }, -600, DAY);
  assert.deepEqual(moved, { startMin: DAY.startMin, durationMin: 60 });
});

test('applyResizeTop moves the start while the end stays put', () => {
  // Dragging the top edge of a 10:00–11:00 block up by 30 minutes gives
  // 09:30–11:00: start moves back, end is untouched, duration grows.
  const resized = applyResizeTop({ startMin: 600, durationMin: 60 }, -30, DAY);
  assert.deepEqual(resized, { startMin: 570, durationMin: 90 });
  assert.equal(resized.startMin + resized.durationMin, 660, 'end instant must not move');
});

test('applyResizeTop cannot shrink a block below the minimum duration', () => {
  const resized = applyResizeTop({ startMin: 600, durationMin: 60 }, 600, DAY);
  assert.equal(resized.durationMin, MIN_DURATION_MINUTES);
  assert.equal(resized.startMin, 660 - MIN_DURATION_MINUTES, 'start stops just short of the end');
});

test('applyResizeTop cannot drag the start above the top of the grid', () => {
  const resized = applyResizeTop({ startMin: 10 * 60, durationMin: 60 }, -600, DAY);
  assert.equal(resized.startMin, DAY.startMin);
  assert.equal(resized.durationMin, 660 - DAY.startMin);
});

test('applyResizeBottom changes only the duration', () => {
  const resized = applyResizeBottom({ startMin: 600, durationMin: 60 }, 30, DAY);
  assert.deepEqual(resized, { startMin: 600, durationMin: 90 });
});

test('applyResizeBottom cannot shrink a block below the minimum duration', () => {
  const resized = applyResizeBottom({ startMin: 600, durationMin: 60 }, -600, DAY);
  assert.deepEqual(resized, { startMin: 600, durationMin: MIN_DURATION_MINUTES });
});

test('applyResizeBottom cannot drag the end past the bottom of the grid', () => {
  const resized = applyResizeBottom({ startMin: 17 * 60, durationMin: 30 }, 600, DAY);
  assert.equal(resized.startMin + resized.durationMin, DAY.endMin);
});

test('a block that exactly fills the grid cannot be moved at all', () => {
  const block = { startMin: DAY.startMin, durationMin: DAY.endMin - DAY.startMin };
  assert.deepEqual(applyMove(block, 60, DAY), block);
  assert.deepEqual(applyMove(block, -60, DAY), block);
});

test('bounds are expected to already contain the block, and the grid widens to ensure it', () => {
  // An admin may confirm an appointment that runs past closing. The grid widens
  // its own bounds to include such a block (see ScheduleDayGrid), so the clamp
  // here never has to cope with a block starting outside its bounds — it stays
  // a simple clamp rather than growing a special case for a state the caller
  // prevents.
  const lateDay = { startMin: 9 * 60, endMin: 20 * 60 };
  const moved = applyMove({ startMin: 19 * 60, durationMin: 60 }, 15, lateDay);
  assert.deepEqual(moved, { startMin: 19 * 60, durationMin: 60 }, 'clamped to end exactly at the widened bound');
});
