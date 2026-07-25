import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeCompare,
  reminderWindowEnd,
  reviewWindow,
  hasSendBudgetLeft,
  SEND_BUDGET_MS,
} from './reminder-window';

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

test('safeCompare — equal code-unit length but different byte length returns false (no throw)', () => {
  // 'é' (U+00E9) is one UTF-16 code unit but two UTF-8 bytes, so 'é' and 'e'
  // have equal String.length yet different Buffer byte lengths. The byte-length
  // guard must return false here; without it timingSafeEqual throws (→ HTTP 500
  // instead of a clean 401 when a caller sends a multibyte/latin-1 header).
  assert.equal(safeCompare('é', 'e'), false);
  assert.equal(safeCompare('Bearer sécret', 'Bearer secret'), false);
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

test('send budget allows work at the start of a run', () => {
  assert.equal(hasSendBudgetLeft(1_000, 1_000), true);
  assert.equal(hasSendBudgetLeft(1_000, 1_000 + 44_999), true);
});

test('send budget stops work once the window is spent', () => {
  // Exactly at the budget is already too late — leave room to return a response.
  assert.equal(hasSendBudgetLeft(1_000, 1_000 + SEND_BUDGET_MS), false);
  assert.equal(hasSendBudgetLeft(1_000, 1_000 + SEND_BUDGET_MS + 5_000), false);
});

test('send budget stays under the route maxDuration of 60s', () => {
  assert.ok(SEND_BUDGET_MS < 60_000, 'must finish before Vercel kills the function');
});

test('send budget honours an explicit override', () => {
  assert.equal(hasSendBudgetLeft(0, 500, 1_000), true);
  assert.equal(hasSendBudgetLeft(0, 1_500, 1_000), false);
});
