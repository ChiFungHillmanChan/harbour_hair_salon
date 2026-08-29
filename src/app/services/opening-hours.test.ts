import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWeek } from './opening-hours';

/** A full Mon–Sun week, all open 10:00–19:00, as the form submits it. */
function week(overrides: Partial<Record<number, { isOff?: boolean; startTime?: string; endTime?: string }>> = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isOff: false,
    startTime: '10:00',
    endTime: '19:00',
    ...(overrides[dayOfWeek] ?? {}),
  }));
}

test('a full valid week is accepted and returns all seven days', () => {
  const result = validateWeek(week());
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.days.length, 7);
});

test('an end time before the start time is rejected, naming the day', () => {
  const result = validateWeek(week({ 2: { startTime: '18:00', endTime: '09:00' } }));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /Tuesday/);
});

test('an end time equal to the start time is rejected — it sells nothing', () => {
  const result = validateWeek(week({ 5: { startTime: '10:00', endTime: '10:00' } }));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /Friday/);
});

test('a malformed time is rejected', () => {
  const result = validateWeek(week({ 1: { startTime: '25:00' } }));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /Monday/);
});

test('a closed day is accepted whatever its times say', () => {
  // The form keeps the time inputs mounted while a day is switched off, so it
  // can submit stale or empty values for a day nobody will ever be booked on.
  const result = validateWeek(week({ 0: { isOff: true, startTime: '', endTime: '' } }));
  assert.equal(result.ok, true);
});

test('a duplicated day is rejected — it would make the upsert ambiguous', () => {
  const result = validateWeek([...week(), { dayOfWeek: 2, isOff: false, startTime: '10:00', endTime: '19:00' }]);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /Tuesday/);
});

test('a dayOfWeek outside 0-6 is rejected — the booking engine would never read it', () => {
  const days = week();
  days[3] = { ...days[3], dayOfWeek: 7 };
  const result = validateWeek(days);
  assert.equal(result.ok, false);
});

test('a week missing a day is rejected', () => {
  const result = validateWeek(week().slice(0, 6));
  assert.equal(result.ok, false);
});

test('a closed day still has to be a real weekday', () => {
  const days = week();
  days[1] = { dayOfWeek: -1, isOff: true, startTime: '', endTime: '' };
  const result = validateWeek(days);
  assert.equal(result.ok, false);
});

test('a closed day comes back with usable times, not the blanks it was sent', () => {
  // Closed days skip time validation, so '' can reach here. If '' were stored,
  // reopening that day later would hand getAvailableSlots an unparseable window.
  const result = validateWeek(week({ 3: { isOff: true, startTime: '', endTime: '' } }));
  assert.equal(result.ok, true);
  const wednesday = result.ok ? result.days.find((d) => d.dayOfWeek === 3) : undefined;
  assert.match(wednesday?.startTime ?? '', /^\d{2}:\d{2}$/);
  assert.match(wednesday?.endTime ?? '', /^\d{2}:\d{2}$/);
});

test('an open day keeps exactly the times it was given', () => {
  const result = validateWeek(week({ 4: { startTime: '11:30', endTime: '20:30' } }));
  const thursday = result.ok ? result.days.find((d) => d.dayOfWeek === 4) : undefined;
  assert.equal(thursday?.startTime, '11:30');
  assert.equal(thursday?.endTime, '20:30');
});

test('countSlots agrees with the booking engine for every window it is shown for', async () => {
  // The admin screen promises "N bookable slots". If that number is computed
  // differently from the slots customers are actually offered, the screen lies.
  // Pin the two together rather than trusting two copies of the same arithmetic.
  const { buildSlotsForWindow } = await import('./scheduling');
  const { countSlots } = await import('./opening-hours');
  const past = new Date('2000-01-01T00:00:00Z');

  const windows = [
    ['10:00', '19:00'], ['09:30', '18:00'], ['10:00', '10:30'],
    ['11:00', '16:00'], ['00:00', '23:30'], ['12:00', '12:59'],
  ];
  for (const [startTime, endTime] of windows) {
    for (const duration of [30, 45, 60, 90]) {
      const actual = buildSlotsForWindow('2099-06-10', { startTime, endTime }, [], duration, past).length;
      assert.equal(
        countSlots(startTime, endTime, duration),
        actual,
        `${startTime}-${endTime} @ ${duration}min`,
      );
    }
  }
});
