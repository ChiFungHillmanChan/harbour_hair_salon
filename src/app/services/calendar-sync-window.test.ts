import test from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarSyncWindow, shouldRefreshCalendar } from './calendar-sync-window';

const hours = [{ dayOfWeek: 1, startTime: '10:00', endTime: '19:00', isOff: false }];
test('sync includes the buffered closing cron minute despite scheduling delay in BST', () => {
  for (const [time, expected] of [['08:44:59', false], ['08:45:00', true], ['18:15:00', true], ['18:15:45', true], ['18:15:59.999', true], ['18:16:00', false]] as const) {
    assert.equal(isCalendarSyncWindow(hours, new Date(`2026-09-21T${time}Z`)), expected, time);
  }
});
test('same London hours follow winter time, irrespective of the server timezone', () => {
  assert.equal(isCalendarSyncWindow(hours, new Date('2026-10-26T09:44:59Z')), false);
  assert.equal(isCalendarSyncWindow(hours, new Date('2026-10-26T09:45:00Z')), true);
  assert.equal(isCalendarSyncWindow(hours, new Date('2026-10-26T19:15:00Z')), true);
  assert.equal(isCalendarSyncWindow(hours, new Date('2026-10-26T19:15:45Z')), true);
  assert.equal(isCalendarSyncWindow(hours, new Date('2026-10-26T19:16:00Z')), false);
});
test('closed days, empty schedules, malformed rows and off-duty rows never open a window', () => {
  const now = new Date('2026-09-21T11:00:00Z');
  assert.equal(isCalendarSyncWindow([], now), false);
  assert.equal(isCalendarSyncWindow(hours, new Date('2026-09-20T11:00:00Z')), false);
  for (const patch of [{ isOff: true }, { startTime: 'bad' }, { endTime: '09:00' }, { dayOfWeek: 8 }]) {
    assert.equal(isCalendarSyncWindow([{ ...hours[0], ...patch }], now), false);
  }
});
test('any active staff window opens sync, including buffers crossing midnight', () => {
  const windows = [...hours, { dayOfWeek: 2, startTime: '00:05', endTime: '00:30', isOff: false }];
  assert.equal(isCalendarSyncWindow(windows, new Date('2026-09-21T22:50:00Z')), true);
  assert.equal(isCalendarSyncWindow(windows, new Date('2026-09-21T22:49:59Z')), false);
  assert.equal(isCalendarSyncWindow([{ dayOfWeek: 1, startTime: '20:00', endTime: '23:55', isOff: false }], new Date('2026-09-21T23:10:00Z')), true);
});
test('dashboard refresh follows each quarter-hour import with time for it to finish', () => {
  const now = new Date('2026-09-21T11:16:30Z');
  const last = new Date('2026-09-21T11:16:29Z');
  assert.equal(shouldRefreshCalendar(hours, now, last, true), true);
  assert.equal(shouldRefreshCalendar(hours, now, new Date(last.getTime() + 1000), true), false);
  assert.equal(shouldRefreshCalendar(hours, new Date('2026-09-21T11:16:29Z'), new Date('2026-09-21T11:01:30Z'), true), false);
  assert.equal(shouldRefreshCalendar(hours, now, new Date('2026-09-21T11:00:00Z'), true), true);
  assert.equal(shouldRefreshCalendar(hours, now, last, false), false);
  assert.equal(shouldRefreshCalendar([], now, last, true), false);
});

test('the final buffered import still reaches the screen after the sync window closes', () => {
  assert.equal(shouldRefreshCalendar(hours, new Date('2026-09-21T18:17:00Z'), new Date('2026-09-21T18:02:00Z'), true), true);
  assert.equal(shouldRefreshCalendar(hours, new Date('2026-09-21T18:32:00Z'), new Date('2026-09-21T18:17:00Z'), true), false);
});
