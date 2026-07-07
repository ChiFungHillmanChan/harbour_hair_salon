import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCompare, reminderWindowEnd, reviewWindow } from './reminder-window';

test('safeCompare — equal strings match', () => {
  assert.equal(safeCompare('Bearer secret123', 'Bearer secret123'), true);
});

test('safeCompare — different lengths never match (short-circuits before timingSafeEqual)', () => {
  assert.equal(safeCompare('short', 'a-much-longer-string'), false);
});

test('safeCompare — same length, different content does not match', () => {
  assert.equal(safeCompare('Bearer secret123', 'Bearer secret124'), false);
});

test('safeCompare — empty strings match each other', () => {
  assert.equal(safeCompare('', ''), true);
});

test('reminderWindowEnd — exactly 36 hours after `now`', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');
  const end = reminderWindowEnd(now);
  assert.equal(end.toISOString(), '2026-07-03T00:00:00.000Z');
  assert.equal(end.getTime() - now.getTime(), 36 * 60 * 60 * 1000);
});

test('reviewWindow — start is 14 days ago, end is 1 day ago', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const { start, end } = reviewWindow(now);
  assert.equal(start.toISOString(), '2026-07-01T12:00:00.000Z');
  assert.equal(end.toISOString(), '2026-07-14T12:00:00.000Z');
  assert.ok(start.getTime() < end.getTime());
});
