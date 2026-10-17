import test from 'node:test';
import assert from 'node:assert/strict';
import { diaryForDay, diaryLanes, diaryRange, parseDiaryStylistIds, type CalendarDiaryEntry } from './calendar-diary-display';

const entry = (id: string, kind: CalendarDiaryEntry['kind'], start: string, end: string, allDay = false): CalendarDiaryEntry =>
  ({ id, kind, stylistIds: [], title: id, colorId: null, start, end, allDay, htmlLink: null });

test('the London day: notes go to the strip, everything else to columns, clipped like busy time', () => {
  const day = diaryForDay([
    entry('walkin', 'UNASSIGNED', '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z'),
    entry('note', 'NOTE', '2026-10-23T09:00:00Z', '2026-10-23T09:30:00Z'),
    entry('away', 'LEAVE', '2026-10-22T23:00:00Z', '2026-10-23T23:00:00Z', true),
    entry('tomorrow', 'STYLIST', '2026-10-24T09:00:00Z', '2026-10-24T10:00:00Z'),
  ], '2026-10-23');
  assert.deepEqual(day.placed.map((e) => [e.id, e.startMin, e.endMin]), [['walkin', 840, 900], ['away', 0, 1440]]);
  assert.deepEqual(day.notes.map((e) => e.id), ['note']);
});

test('lanes put overlapping entries side by side', () => {
  const { lane, laneCount } = diaryLanes([{ id: 'a', startMin: 600, endMin: 660 }, { id: 'b', startMin: 630, endMin: 690 }, { id: 'c', startMin: 660, endMin: 720 }]);
  assert.equal(laneCount, 2);
  assert.deepEqual([lane.get('a'), lane.get('b'), lane.get('c')], [0, 1, 0]);
});

test('range text and stored stylist ids', () => {
  assert.equal(diaryRange({ startMin: 840, endMin: 900 }), '14:00–15:00');
  assert.deepEqual(parseDiaryStylistIds('["lox","funky"]'), ['lox', 'funky']);
  assert.deepEqual(parseDiaryStylistIds('not json'), []);
  assert.deepEqual(parseDiaryStylistIds('[1,"lox"]'), ['lox']);
});
