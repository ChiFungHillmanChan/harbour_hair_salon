import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarBusyLabel, isWholeDayBlock, salonWorkingWindow, type CalendarBusyBlock } from './calendar-busy-display';
import { createTranslator } from '@/i18n/translator';
import { en } from '@/i18n/messages/en';
import { zh } from '@/i18n/messages/zh';

test('a Pause that overshoots the stylist’s hours covers the working day', () => {
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1230 }, { startTime: '10:15', endTime: '19:00' }), true);
});

test('a lunch block does not', () => {
  assert.equal(isWholeDayBlock({ startMin: 780, endMin: 840 }, { startTime: '10:00', endTime: '19:00' }), false);
});

test('a block that stops before closing does not', () => {
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1080 }, { startTime: '10:00', endTime: '19:00' }), false);
});

test('with no working window only a midnight-to-midnight block counts', () => {
  assert.equal(isWholeDayBlock({ startMin: 0, endMin: 1440 }, null), true);
  assert.equal(isWholeDayBlock({ startMin: 600, endMin: 1230 }, null), false);
});

test('the salon window is the earliest start and latest finish of anyone rostered', () => {
  assert.deepEqual(salonWorkingWindow([{ startTime: '10:15', endTime: '19:00' }, null, { startTime: '10:00', endTime: '19:30' }, undefined]), { startTime: '10:00', endTime: '19:30' });
  assert.equal(salonWorkingWindow([null, undefined]), null);
});

const t = createTranslator('en-GB', en.adminSchedule, 'adminSchedule');
const block = (summary: string | null): CalendarBusyBlock => ({
  id: 'b1', stylistId: 's1', source: 'FRESHA', summary,
  start: '2026-10-16T12:00:00.000Z', end: '2026-10-16T15:00:00.000Z', lastSyncAt: '2026-10-16T10:00:00.000Z',
});

test('a Fresha blocked time reads as Blocked, never as a booking', () => {
  const label = calendarBusyLabel(block('Fresha Blocked Time'), 'Ivan', 780, 960, t);
  assert.equal(label.kind, 'blocked');
  assert.equal(label.provider, 'Blocked');
  assert.match(label.detail, /^Ivan is blocked · 13:00–16:00/);
  assert.doesNotMatch(label.detail, /booking/i);
  assert.equal(label.brand, 'Fresha');
});

test('a Fresha appointment reads as a Fresha booking', () => {
  const label = calendarBusyLabel(block('Fresha Appointment'), 'Ivan', 780, 960, t);
  assert.equal(label.kind, 'booking');
  assert.equal(label.provider, 'Fresha booking');
  assert.match(label.detail, /^Fresha booking · Ivan · 13:00–16:00/);
});

test('an untitled block keeps the provider’s name, and a whole day stays Unavailable', () => {
  assert.equal(calendarBusyLabel(block(null), 'Ivan', 780, 960, t).provider, 'Fresha');
  assert.equal(calendarBusyLabel(block(null), 'Ivan', 780, 960, t).kind, null);
  const day = calendarBusyLabel(block('Fresha Blocked Time'), 'Ivan', 600, 1170, t, true);
  assert.equal(day.provider, 'Unavailable');
  assert.equal(day.unavailable, true);
});

test('the labels are translated', () => {
  const tz = createTranslator('zh-HK', zh.adminSchedule, 'adminSchedule');
  assert.equal(calendarBusyLabel(block('Fresha Blocked Time'), 'Ivan', 780, 960, tz).provider, '已封鎖');
  assert.equal(calendarBusyLabel(block('Fresha Appointment'), 'Ivan', 780, 960, tz).provider, 'Fresha 預約');
});

test('Google-only time is labelled Google in both languages (a brand, never translated)', () => {
  const google: CalendarBusyBlock = { ...block(null), source: 'GOOGLE' };
  const tz = createTranslator('zh-HK', zh.adminSchedule, 'adminSchedule');
  for (const translate of [t, tz]) {
    const label = calendarBusyLabel(google, 'Ivan', 780, 960, translate);
    assert.equal(label.provider, 'Google');
    assert.equal(label.brand, 'Google');
    assert.equal(label.kind, null);
  }
});
