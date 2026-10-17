import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSalonDateTime } from './salon-time';
import type { WorkingHours } from './booking-days';
import type { BookedInterval } from './scheduling';
import { checkDiaryChair, diaryChairAllows, maxConcurrent, type ChairContext } from './diary-chair-rule';

// 2026-10-06 is a Tuesday (dayOfWeek 2) in British Summer Time.
const DAY = '2026-10-06';
const at = (time: string) => resolveSalonDateTime(DAY, time).utc;
const red = (from: string, to: string) => ({ start: at(from), end: at(to) });
const hours = (startTime = '10:00', endTime = '19:00'): WorkingHours[] => [{ dayOfWeek: 2, startTime, endTime }];
const booked = (time: string, minutes = 60): BookedInterval => ({ start: at(time), durationMin: minutes });
function ctx(input: { unassigned: { start: Date; end: Date }[]; hours?: Record<string, WorkingHours[]>; busy?: Record<string, BookedInterval[]> }): ChairContext {
  return {
    unassigned: input.unassigned,
    hoursByStylist: new Map(Object.entries(input.hours ?? { lox: hours(), funky: hours() })),
    busyByStylist: new Map(Object.entries(input.busy ?? {})),
  };
}

test('no walk-in in the diary: always allowed', () => {
  assert.equal(diaryChairAllows(null, 'lox', at('15:00'), 60), true);
  assert.equal(diaryChairAllows(ctx({ unassigned: [] }), 'lox', at('15:00'), 60), true);
});

test('one walk-in and another stylist free for all of it: allowed', () => {
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')] }), 'lox', at('15:00'), 60), true);
});

test('the only other stylist is booked over the walk-in: refused, with the numbers and the span', () => {
  const check = checkDiaryChair(ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:30')] } }), 'lox', at('15:00'), 60);
  assert.deepEqual(check, { allowed: false, needed: 1, free: 0, start: at('15:00'), end: at('16:00') });
});

test('conservative: a stylist rostered for only part of the walk-in does not count', () => {
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], hours: { lox: hours(), funky: hours('10:00', '15:30') } }), 'lox', at('15:00'), 60), false);
});

test('a stylist off that day or with no hours does not count, and the booked stylist never counts', () => {
  const offTuesday: WorkingHours[] = [{ dayOfWeek: 3, startTime: '10:00', endTime: '19:00' }];
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], hours: { lox: hours(), funky: offTuesday } }), 'lox', at('15:00'), 60), false);
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], hours: { lox: hours() } }), 'lox', at('15:00'), 60), false);
});

test('two walk-ins at once need two other free stylists', () => {
  const two = [red('15:00', '16:00'), red('15:30', '16:30')];
  assert.equal(diaryChairAllows(ctx({ unassigned: two }), 'lox', at('15:00'), 60), false);
  assert.equal(diaryChairAllows(ctx({ unassigned: two, hours: { lox: hours(), funky: hours(), ivan: hours() } }), 'lox', at('15:00'), 60), true);
});

test('back-to-back walk-ins need one chair, not two', () => {
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '15:30'), red('15:30', '16:00')] }), 'lox', at('15:00'), 60), true);
});

test('only the part of a walk-in inside the booking counts; a booking that only touches it is unaffected', () => {
  // 14:00–15:30 meets the 15:00–16:00 walk-in for 15:00–15:30; Funky is busy only from 15:30.
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:30')] } }), 'lox', at('14:00'), 90), true);
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:00')] } }), 'lox', at('14:00'), 60), true);
});

test('maxConcurrent counts the most walk-ins at one instant (half-open intervals)', () => {
  assert.equal(maxConcurrent([]), 0);
  assert.equal(maxConcurrent([red('10:00', '11:00'), red('10:30', '11:30'), red('11:00', '12:00')]), 2);
  assert.equal(maxConcurrent([red('10:00', '11:00'), red('11:00', '12:00')]), 1);
});

test('a stylist who takes no walk-ins (left out of the context) is never a chair: never counted free, and their own booking uses none', () => {
  // Only Lox and Funky take walk-ins, and both are booked: nobody can take it…
  const walkIn = ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:00')], lox: [booked('15:00')] } });
  assert.equal(diaryChairAllows(walkIn, 'lox', at('15:30'), 30), false);
  // …yet Shania (an assistant) is still bookable: she was never one of the chairs, so her booking takes none.
  assert.equal(diaryChairAllows(walkIn, 'shania', at('15:00'), 60), true);
});
