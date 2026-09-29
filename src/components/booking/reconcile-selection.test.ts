import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSelection } from './reconcile-selection';
import type { BookingDay } from '../../app/services/booking-days';

const days: BookingDay[] = [
  { date: '2026-10-05', status: 'OPEN', hours: { start: '10:00', end: '12:00' }, slots: [{ time: '10:00', available: true }, { time: '10:30', available: false }] },
  { date: '2026-10-06', status: 'UNAVAILABLE', hours: null, slots: [] },
];

test('a chosen time that is still free stays chosen, on the same step', () => {
  assert.deepEqual(reconcileSelection(days, '2026-10-05', '10:00', 'CONFIRM'), { time: '10:00', step: 'CONFIRM' });
});

test('a refused booking whose time was just taken goes back to the times, not a dead confirm page', () => {
  assert.deepEqual(reconcileSelection(days, '2026-10-05', '10:30', 'CONFIRM'), { time: null, step: 'DATE' });
});

test('a day that became unavailable also sends the customer back to choose again', () => {
  assert.deepEqual(reconcileSelection(days, '2026-10-06', '11:00', 'CONFIRM'), { time: null, step: 'DATE' });
});

test('on the date step a taken time is just cleared', () => {
  assert.deepEqual(reconcileSelection(days, '2026-10-05', '10:30', 'DATE'), { time: null, step: 'DATE' });
});

test('with no time chosen nothing changes', () => {
  assert.deepEqual(reconcileSelection(days, '2026-10-05', null, 'STYLIST'), { time: null, step: 'STYLIST' });
});
