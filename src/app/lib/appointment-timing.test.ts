import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAppointmentEnded, hasAppointmentStarted } from './appointment-timing';

const start = new Date('2099-09-01T12:00:00Z');
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

// The same boundary as the stylist busy feed (stylist-ical-feed.ts drops an
// event once `end <= now`): the chair is free from the end instant on.
test('an appointment has ended once its whole duration has passed', () => {
  assert.equal(hasAppointmentEnded(start, 60, at(-1)), false, 'before it starts');
  assert.equal(hasAppointmentEnded(start, 60, start), false, 'as it starts');
  assert.equal(hasAppointmentEnded(start, 60, at(59)), false, 'in its last minute');
  assert.equal(hasAppointmentEnded(start, 60, at(60)), true, 'at its end');
  assert.equal(hasAppointmentEnded(start, 60, at(61)), true);
  assert.equal(hasAppointmentEnded(start.toISOString(), 60, at(60)), true, 'the board passes ISO strings');
});

test('a visit under way has started but not ended', () => {
  assert.equal(hasAppointmentStarted(start, at(30)), true);
  assert.equal(hasAppointmentEnded(start, 60, at(30)), false);
  assert.equal(hasAppointmentEnded(start, 25, at(30)), true, 'a shorter visit is already over');
});

test('"now" defaults to the current time', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at(90) });
  assert.equal(hasAppointmentEnded(start, 60), true);
  assert.equal(hasAppointmentEnded(start, 120), false);
});
