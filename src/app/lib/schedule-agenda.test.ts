import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleAgenda, filterScheduleForStylist, diaryStylistNames } from './schedule-agenda';
import type { PlacedDiaryEntry } from './calendar-diary-display';
const diary = (id: string, startMin: number, overrides: Partial<PlacedDiaryEntry> = {}): PlacedDiaryEntry => ({ id, startMin, endMin: startMin + 60, kind: 'STYLIST', stylistIds: ['a'], title: 'Customer', colorId: '1', start: '2026-10-17T09:00:00Z', end: '2026-10-17T10:00:00Z', allDay: false, htmlLink: null, ...overrides });

test('agenda puts every source in London time order, retaining same-id entries from different sources', () => {
  const appointments = [{ id: 'same', date: '2026-10-17T10:00:00Z', stylistId: 'a' }];
  const busy = [{ id: 'same', startMin: 600, endMin: 630, stylistId: 'a' }];
  const google = [diary('later', 720), diary('earlier', 540)];
  const result = scheduleAgenda(appointments, busy, google);
  assert.deepEqual(result.timed.map(row => [row.source, row.value.id]), [['google', 'earlier'], ['busy', 'same'], ['website', 'same'], ['google', 'later']]);
  assert.equal(result.timed[2].value, appointments[0]);
  assert.equal(result.timed.length, 4);
});

test('notes and all-day entries are separate without dropping timed leave or no-stylist bookings', () => {
  const google = [diary('note', 600, { kind: 'NOTE' }), diary('all-day', 0, { allDay: true }), diary('leave', 500, { kind: 'LEAVE' }), diary('unassigned', 700, { kind: 'UNASSIGNED', stylistIds: [] })];
  const result = scheduleAgenda([], [], google);
  assert.deepEqual(result.timed.map(row => row.value.id), ['leave', 'unassigned']);
  assert.deepEqual(result.notes.map(row => row.id), ['all-day', 'note']);
});

test('stylist filtering is exact for each source and keeps all entries when cleared', () => {
  const appointments = [{ id: 'one', stylistId: 'a' }, { id: 'two', stylistId: 'b' }];
  const busy = [{ id: 'block', stylistId: 'b' }];
  const google = [diary('shared', 600, { stylistIds: ['a', 'b'] }), diary('none', 500, { stylistIds: [] })];
  assert.deepEqual(filterScheduleForStylist(appointments, busy, google, 'a'), { appointments: [appointments[0]], busy: [], diary: [google[0]] });
  assert.deepEqual(filterScheduleForStylist(appointments, busy, google, ''), { appointments, busy, diary: google });
});

test('diary uses every mapped stylist name, never infers one from a customer title', () => {
  assert.deepEqual(diaryStylistNames(diary('shared', 600, { stylistIds: ['b', 'a', 'retired'] }), [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Bo' }]), ['Bo', 'Alex']);
  assert.deepEqual(diaryStylistNames(diary('none', 500, { title: 'Alex customer', stylistIds: [] }), [{ id: 'a', name: 'Alex' }]), []);
});

test('whole-day imported unavailability stays in the compact all-day section', () => {
  const blocks = [{ id: 'unavailable', startMin: 0, allDay: true }, { id: 'lunch', startMin: 720, allDay: false }];
  const result = scheduleAgenda([], blocks, []);
  assert.deepEqual(result.timed.map(row => row.value.id), ['lunch']);
  assert.deepEqual(result.allDayBusy, [blocks[0]]);
});
