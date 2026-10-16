import test from 'node:test';
import assert from 'node:assert/strict';
import { busyKindOf, storedBusySummary } from './calendar-busy-kind';

test('Fresha’s two generic titles are kept in their canonical spelling', () => {
  assert.equal(storedBusySummary('Fresha Blocked Time'), 'Fresha Blocked Time');
  assert.equal(storedBusySummary('  fresha   blocked TIME '), 'Fresha Blocked Time');
  assert.equal(storedBusySummary('Fresha Appointment'), 'Fresha Appointment');
});

test('any other title is free text and never stored (it can be a customer’s name)', () => {
  for (const title of ['Jane Smith – cut & colour', 'Busy', 'Fresha Appointment with Jane', '', '   ', null, undefined]) {
    assert.equal(storedBusySummary(title), null, String(title));
  }
});

test('a stored title says whether the time is blocked or a booking', () => {
  assert.equal(busyKindOf('Fresha Blocked Time'), 'blocked');
  assert.equal(busyKindOf('Fresha Appointment'), 'booking');
  assert.equal(busyKindOf(null), null);
  assert.equal(busyKindOf('Something else'), null);
});
