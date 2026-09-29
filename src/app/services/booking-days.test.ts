import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingDays, type WorkingHours } from './booking-days';
import { resolveSalonDateTime } from './salon-time';
import type { BookedInterval } from './scheduling';

const NOW = new Date('2026-10-01T00:00:00Z');
const always = () => true;
const at = (date: string, time: string) => resolveSalonDateTime(date, time).utc;
const block = (fromDate: string, fromTime: string, toDate: string, toTime: string): BookedInterval => {
  const start = at(fromDate, fromTime);
  return { start, durationMin: Math.round((at(toDate, toTime).getTime() - start.getTime()) / 60_000) };
};
// 2026-10-06 is a Tuesday (dayOfWeek 2); 2026-10-05 a Monday (1).
const weekdays = (days: number[], startTime = '10:15', endTime = '19:00'): WorkingHours[] =>
  days.map((dayOfWeek) => ({ dayOfWeek, startTime, endTime }));

function days(dates: string[], hours: Record<string, WorkingHours[]>, busy: Record<string, BookedInterval[]> = {}, duration = 60, now = NOW, bookable: (start: Date, duration: number) => boolean = always) {
  return buildBookingDays({
    dates, duration, now, bookable,
    hoursByStylist: new Map(Object.entries(hours)),
    busyByStylist: new Map(Object.entries(busy)),
  });
}

test('a whole-day Fresha block that overshoots the hours makes the day Unavailable, keeping the rostered hours', () => {
  const [day] = days(['2026-10-06'], { funky: weekdays([2]) }, { funky: [block('2026-10-06', '10:00', '2026-10-06', '20:30')] });
  assert.equal(day.status, 'UNAVAILABLE');
  assert.deepEqual(day.hours, { start: '10:15', end: '19:00' });
  assert.deepEqual(day.slots, []);
});

test('a weekly day off is Unavailable with no hours', () => {
  const [day] = days(['2026-10-06'], { funky: weekdays([1, 3]) });
  assert.deepEqual(day, { date: '2026-10-06', status: 'UNAVAILABLE', hours: null, slots: [] });
});

test('a partial block leaves the day open and greys out only the clashing times', () => {
  const [day] = days(['2026-10-05'], { ivan: weekdays([1], '10:00', '13:00') }, { ivan: [block('2026-10-05', '11:00', '2026-10-05', '12:00')] }, 30);
  assert.equal(day.status, 'OPEN');
  assert.deepEqual(day.slots, [
    { time: '10:00', available: true }, { time: '10:30', available: true },
    { time: '11:00', available: false }, { time: '11:30', available: false },
    { time: '12:00', available: true }, { time: '12:30', available: true },
  ]);
});

test('a fully booked day is Unavailable too (one label for every reason)', () => {
  const [day] = days(['2026-10-05'], { lox: weekdays([1], '10:00', '12:00') }, { lox: [block('2026-10-05', '10:00', '2026-10-05', '12:00')] });
  assert.equal(day.status, 'UNAVAILABLE');
});

test('Anyone: one stylist paused and another free keeps the day open with the free times', () => {
  const [day] = days(['2026-10-06'],
    { funky: weekdays([2], '10:00', '12:00'), lox: weekdays([2], '10:00', '12:00') },
    { funky: [block('2026-10-06', '10:00', '2026-10-06', '20:30')] });
  assert.equal(day.status, 'OPEN');
  assert.ok(day.slots.every((slot) => slot.available));
  assert.deepEqual(day.slots.map((slot) => slot.time), ['10:00', '10:30', '11:00']);
});

test('Anyone: a time is only unavailable when every rostered stylist is taken', () => {
  const [day] = days(['2026-10-05'],
    { a: weekdays([1], '10:00', '11:00'), b: weekdays([1], '10:00', '11:00') },
    { a: [block('2026-10-05', '10:00', '2026-10-05', '11:00')], b: [block('2026-10-05', '10:30', '2026-10-05', '11:00')] }, 30);
  assert.deepEqual(day.slots, [{ time: '10:00', available: true }, { time: '10:30', available: false }]);
});

test('Anyone: hours span the earliest start and latest finish of everyone rostered', () => {
  const [day] = days(['2026-10-05'], { a: weekdays([1], '10:00', '18:00'), b: weekdays([1], '11:00', '19:30') });
  assert.deepEqual(day.hours, { start: '10:00', end: '19:30' });
});

test('a multi-day holiday block makes every covered day Unavailable', () => {
  const holiday = block('2026-10-05', '00:00', '2026-10-10', '00:00'); // Mon–Fri all-day
  const result = days(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10'], { ivan: weekdays([1, 3, 5, 6]) }, { ivan: [holiday] });
  assert.deepEqual(result.map((day) => day.status), ['UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE', 'OPEN']);
});

test('DST changeover day (25 Oct 2026, BST→GMT): the Pause still covers the day and times stay on the London clock', () => {
  const sunday = '2026-10-25';
  const paused = days([sunday], { funky: weekdays([0]) }, { funky: [block(sunday, '10:00', sunday, '20:30')] });
  assert.equal(paused[0].status, 'UNAVAILABLE');
  const open = days([sunday], { funky: weekdays([0], '10:00', '11:00') }, {}, 30);
  assert.deepEqual(open[0].slots.map((slot) => slot.time), ['10:00', '10:30']);
});

test('a day whose times have all passed is Unavailable', () => {
  const now = at('2026-10-05', '18:45');
  const [day] = days(['2026-10-05'], { lox: weekdays([1], '10:00', '19:00') }, {}, 30, now);
  assert.equal(day.status, 'UNAVAILABLE');
});

test('times the booking horizon refuses are left out, not greyed', () => {
  const [day] = days(['2026-10-05'], { lox: weekdays([1], '10:00', '11:00') }, {}, 30, NOW, (start) => start < at('2026-10-05', '10:30'));
  assert.deepEqual(day.slots, [{ time: '10:00', available: true }]);
});
