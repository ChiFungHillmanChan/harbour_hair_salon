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
  assert.ok(out);
  assert.equal(out.length, 1);
  assert.equal(out[0].uid, 'abc-123');
  assert.equal(out[0].start.toISOString(), '2026-07-01T09:00:00.000Z');
  assert.equal(out[0].end.toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(out[0].summary, 'Treatwell booking');
});

test('drops events that already ended before now', () => {
  const out = parseIcalBusyIntervals(EVENT, { now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(out, []);
});

test('drops events beyond the window end', () => {
  const out = parseIcalBusyIntervals(EVENT, {
    now: new Date('2026-06-01T00:00:00Z'),
    windowEnd: new Date('2026-06-15T00:00:00Z'),
  });
  assert.deepEqual(out, []);
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
  assert.deepEqual(out, []);
});

test('returns [] for a valid but empty calendar (prune is then correct)', () => {
  const empty = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'END:VCALENDAR'].join('\r\n');
  assert.deepEqual(parseIcalBusyIntervals(empty, { now: new Date('2026-06-01T00:00:00Z') }), []);
});

test('returns null (NOT []) for invalid input, so callers never prune on it', () => {
  // These are the shapes a broken Treatwell endpoint returns with HTTP 200.
  assert.equal(parseIcalBusyIntervals(''), null);
  assert.equal(parseIcalBusyIntervals('not a calendar'), null);
  assert.equal(parseIcalBusyIntervals('<html><body>Login</body></html>'), null);
  // Truncated feed — envelope opened but never closed.
  assert.equal(parseIcalBusyIntervals('BEGIN:VCALENDAR\r\nBEGIN:VEVENT'), null);
});

test('parses a TZID-localized (non-Z) VEVENT into the correct UTC instant', () => {
  // Some calendar providers emit local wall-clock times qualified by a TZID
  // parameter instead of a trailing "Z" UTC designator. 2026-07-02 is in BST
  // (UTC+1), so 10:00 Europe/London must resolve to 09:00Z.
  const tzidEvent = ICS(
    [
      'BEGIN:VEVENT',
      'UID:tzid-1',
      'SUMMARY:Treatwell booking (localized)',
      'DTSTART;TZID=Europe/London:20260702T100000',
      'DTEND;TZID=Europe/London:20260702T110000',
      'END:VEVENT',
    ].join('\r\n'),
  );
  const out = parseIcalBusyIntervals(tzidEvent, { now: new Date('2026-06-01T00:00:00Z') });
  assert.ok(out);
  assert.equal(out.length, 1);
  assert.equal(out[0].uid, 'tzid-1');
  assert.equal(out[0].start.toISOString(), '2026-07-02T09:00:00.000Z'); // 10:00 BST = 09:00Z
  assert.equal(out[0].end.toISOString(), '2026-07-02T10:00:00.000Z'); // 11:00 BST = 10:00Z
});

test('parseIcalBusyIntervals — a STATUS:CANCELLED event is excluded', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:cancelled-1',
    'DTSTART:20260702T100000Z',
    'DTEND:20260702T110000Z',
    'STATUS:CANCELLED',
    'SUMMARY:Cancelled booking',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const result = parseIcalBusyIntervals(ics, { now });
  assert.deepEqual(result, []);
});
