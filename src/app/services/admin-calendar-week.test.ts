import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdminCalendarRange, weekDayKeys } from './admin-calendar-range';

test('the board opens on today rather than the month grid', () => {
  // The salon works today's diary; a month grid cost them a click every morning.
  assert.equal(resolveAdminCalendarRange({}).view, 'day');
  assert.equal(resolveAdminCalendarRange({ view: 'nonsense' }).view, 'day');
  assert.equal(resolveAdminCalendarRange({ view: ['week', 'month'] }).view, 'day', 'a duplicated parameter is not a choice');
});

test('every offered period survives the round trip', () => {
  for (const view of ['day', 'week', 'month', 'year'] as const) {
    assert.equal(resolveAdminCalendarRange({ date: '2026-09-16', view }).view, view);
  }
});

test('a week query spans Sunday to Saturday around the selected day', () => {
  // 2026-09-16 is a Wednesday.
  const { range } = resolveAdminCalendarRange({ date: '2026-09-16', view: 'week' });
  // London is on BST in September, so its midnight is 23:00Z the day before.
  assert.equal(range.gte.toISOString(), '2026-09-12T23:00:00.000Z', 'starts at Sunday midnight, London time');
  assert.equal(range.lt.toISOString(), '2026-09-19T23:00:00.000Z', 'ends as the next Sunday begins');
});

test('a week already starting on Sunday is not pushed back a week', () => {
  const { range } = resolveAdminCalendarRange({ date: '2026-09-13', view: 'week' });
  assert.equal(range.gte.toISOString(), '2026-09-12T23:00:00.000Z');
  assert.equal(weekDayKeys('2026-09-13')[0], '2026-09-13');
});

test('a week spanning the end of British Summer Time still covers seven salon days', () => {
  // The clocks go back on Sunday 2026-10-25, making that day 25 hours long.
  const keys = weekDayKeys('2026-10-28');
  assert.deepEqual(keys, ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  const { range } = resolveAdminCalendarRange({ date: '2026-10-28', view: 'week' });
  assert.equal(range.gte.toISOString(), '2026-10-24T23:00:00.000Z', 'the week opens while BST is still running');
  assert.equal(range.lt.toISOString(), '2026-11-01T00:00:00.000Z', 'and closes on GMT');
});

test('a week crossing a month boundary keeps both months', () => {
  assert.deepEqual(
    weekDayKeys('2026-10-01'),
    ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
  );
});

test('the week always has seven consecutive days, whatever day is selected', () => {
  for (const date of ['2026-01-01', '2026-02-28', '2026-12-31', '2027-03-28']) {
    const keys = weekDayKeys(date);
    assert.equal(keys.length, 7);
    assert.ok(keys.includes(date), `${date} must appear in its own week`);
    assert.equal(new Date(`${keys[0]}T12:00:00Z`).getUTCDay(), 0, 'the week starts on Sunday, like the month grid');
    for (let i = 1; i < keys.length; i++) {
      const gap = Date.parse(`${keys[i]}T12:00:00Z`) - Date.parse(`${keys[i - 1]}T12:00:00Z`);
      assert.equal(gap, 86_400_000, 'no day may be skipped or repeated');
    }
  }
});
