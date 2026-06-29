import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcalBusyIntervals } from './treatwell-ical';

const ICS = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', body, 'END:VCALENDAR'].join('\r\n');

const EVENT = ICS(
  [
    'BEGIN:VEVENT',
    'UID:abc-123',
    'SUMMARY:Treatwell booking',
    'DTSTART:20260701T090000Z',
    'DTEND:20260701T100000Z',
    'END:VEVENT',
  ].join('\r\n'),
);

test('parses a single timed VEVENT into one interval', () => {
  const out = parseIcalBusyIntervals(EVENT, { now: new Date('2026-06-01T00:00:00Z') });
  assert.equal(out.length, 1);
  assert.equal(out[0].uid, 'abc-123');
  assert.equal(out[0].start.toISOString(), '2026-07-01T09:00:00.000Z');
  assert.equal(out[0].end.toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(out[0].summary, 'Treatwell booking');
});

test('drops events that already ended before now', () => {
  const out = parseIcalBusyIntervals(EVENT, { now: new Date('2026-08-01T00:00:00Z') });
  assert.equal(out.length, 0);
});

test('drops events beyond the window end', () => {
  const out = parseIcalBusyIntervals(EVENT, {
    now: new Date('2026-06-01T00:00:00Z'),
    windowEnd: new Date('2026-06-15T00:00:00Z'),
  });
  assert.equal(out.length, 0);
});

test('skips recurring (rrule) events in v1', () => {
  const recurring = ICS(
    [
      'BEGIN:VEVENT',
      'UID:rec-1',
      'SUMMARY:Weekly',
      'DTSTART:20260701T090000Z',
      'DTEND:20260701T100000Z',
      'RRULE:FREQ=WEEKLY;COUNT=10',
      'END:VEVENT',
    ].join('\r\n'),
  );
  const out = parseIcalBusyIntervals(recurring, { now: new Date('2026-06-01T00:00:00Z') });
  assert.equal(out.length, 0);
});

test('returns [] for empty / non-calendar text', () => {
  assert.deepEqual(parseIcalBusyIntervals(''), []);
  assert.deepEqual(parseIcalBusyIntervals('not a calendar'), []);
});
