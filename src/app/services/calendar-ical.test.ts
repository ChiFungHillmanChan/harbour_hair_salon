import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendarBusyIntervals } from './calendar-ical';
const now = new Date('2026-10-24T00:00:00Z');
const ics = (event: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}\r\nEND:VCALENDAR`;
const event = (fields: string) => `BEGIN:VEVENT\r\nUID:a\r\n${fields}\r\nEND:VEVENT`;

test('accepts genuinely empty feeds but refuses invalid/truncated documents', () => {
  assert.deepEqual(parseCalendarBusyIntervals(ics(''), { now }), []);
  for (const text of ['', '<html>Login</html>', ics('BEGIN:VEVENT')]) {
    assert.throws(() => parseCalendarBusyIntervals(text, { now }), /invalid/i);
  }
});
test('a recurring event becomes one busy interval per occurrence', () => {
  const intervals = parseCalendarBusyIntervals(
    ics(event('DTSTART:20261024T100000Z\r\nDTEND:20261024T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3')), { now });
  assert.equal(intervals.length, 3);
  // Each occurrence is upserted on its own externalUid, so sharing the series
  // UID would make them overwrite each other down to a single busy block.
  assert.equal(new Set(intervals.map((i) => i.uid)).size, 3);
  assert.ok(intervals.every((i) => i.end.getTime() - i.start.getTime() === 3_600_000));
});

// The clocks go back on 2026-10-25. Replaying the UTC instant would move a
// 10:00 commitment to 09:00 local and leave its last hour bookable while the
// stylist is still busy — the one error this parser must never make.
test('recurring occurrences keep salon-local wall-clock time across the DST change', () => {
  const intervals = parseCalendarBusyIntervals(
    ics(event('DTSTART:20261024T100000Z\r\nDTEND:20261024T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3')), { now });
  const localHour = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false });
  assert.deepEqual(intervals.map((i) => localHour(i.start)), ['11', '11', '11']);
  // 24 Oct is BST (10:00Z = 11:00), 26 Oct is GMT — so the UTC instant must move.
  assert.equal(intervals[0].start.toISOString(), '2026-10-24T10:00:00.000Z');
  assert.equal(intervals[2].start.toISOString(), '2026-10-26T11:00:00.000Z');
});

test('EXDATE removes a cancelled occurrence without dropping the series', () => {
  const intervals = parseCalendarBusyIntervals(
    ics(event('DTSTART:20261024T100000Z\r\nDTEND:20261024T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261025T100000Z')), { now });
  assert.equal(intervals.length, 2);
});

// Honouring these needs the whole series in hand; guessing would move a real
// appointment, so the feed is still refused outright.
test('RDATE, EXRULE and RECURRENCE-ID are still refused', () => {
  for (const extra of ['RDATE:20261101T100000Z', 'EXRULE:FREQ=WEEKLY', 'RECURRENCE-ID:20261024T100000Z']) {
    assert.throws(() => parseCalendarBusyIntervals(
      ics(event(`DTSTART:20261024T100000Z\r\nDTEND:20261024T110000Z\r\n${extra}`)), { now }), /recurr/i);
  }
});

test('an unbounded recurrence cannot flood the window', () => {
  // FREQ=HOURLY over 90 days is ~2,160 occurrences.
  assert.throws(() => parseCalendarBusyIntervals(
    ics(event('DTSTART:20261024T100000Z\r\nDTEND:20261024T103000Z\r\nRRULE:FREQ=HOURLY')), { now }), /too many/i);
});
test('UTC and London timestamps normalize consistently through DST change', () => {
  const intervals = parseCalendarBusyIntervals(ics(event('DTSTART;TZID=Europe/London:20261024T100000\r\nDTEND;TZID=Europe/London:20261024T110000')), { now });
  assert.equal(intervals[0].start.toISOString(), '2026-10-24T09:00:00.000Z');
  assert.equal(intervals[0].end.toISOString(), '2026-10-24T10:00:00.000Z');
});
test('an all-day DST transition blocks the entire salon-local day', () => {
  const intervals = parseCalendarBusyIntervals(ics(event('DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026')), { now });
  assert.equal(intervals[0].start.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(intervals[0].end.toISOString(), '2026-10-26T00:00:00.000Z');
});
test('unknown zones, floating times and missing duration fail the whole feed', () => {
  for (const fields of ['DTSTART;TZID=Unrecognized/Zone:20261025T100000\r\nDTEND;TZID=Unrecognized/Zone:20261025T110000', 'DTSTART:20261025T100000\r\nDTEND:20261025T110000', 'DTSTART:20261025T100000Z']) {
    assert.throws(() => parseCalendarBusyIntervals(ics(event(fields)), { now }));
  }
});
test('cancelled and transparent events are removed, future busy events contain no customer title', () => {
  assert.deepEqual(parseCalendarBusyIntervals(ics(event('DTSTART:20261025T100000Z\r\nDTEND:20261025T110000Z\r\nSTATUS:CANCELLED')), { now }), []);
  assert.deepEqual(parseCalendarBusyIntervals(ics(event('DTSTART:20261025T100000Z\r\nDTEND:20261025T110000Z\r\nTRANSP:TRANSPARENT')), { now }), []);
  const busy = parseCalendarBusyIntervals(ics(event('DTSTART:20261025T100000Z\r\nDTEND:20261025T110000Z\r\nSUMMARY:Private customer')), { now });
  assert.equal(busy.length, 1);
  assert.equal('summary' in busy[0], false);
});

test('mixed-case property names are parsed rather than mistaken for an empty feed', () => {
  const text = ics('begin:vevent\r\nuid:lower\r\ndtstart:20261025T100000Z\r\ndtend:20261025T110000Z\r\nend:vevent');
  assert.equal(parseCalendarBusyIntervals(text, { now }).length, 1);
});
test('ambiguous event properties and unsupported busy formats fail instead of unblocking', () => {
  assert.throws(() => parseCalendarBusyIntervals(ics(event('DTSTART:20261025T100000Z\r\nDTSTART:20261025T120000Z\r\nDTEND:20261025T130000Z')), { now }));
  assert.throws(() => parseCalendarBusyIntervals(ics('BEGIN:VFREEBUSY\r\nFREEBUSY:20261025T100000Z/20261025T110000Z\r\nEND:VFREEBUSY'), { now }), /unsupported/i);
});

test('VTIMEZONE daylight rules do not reject discrete IANA-zone appointments', () => {
  const timezone = [
    'BEGIN:VTIMEZONE', 'TZID:Europe/London',
    'BEGIN:DAYLIGHT', 'DTSTART:19700329T010000', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ].join('\r\n');
  const summer = event('DTSTART;TZID=Europe/London:20261024T100000\r\nDTEND;TZID=Europe/London:20261024T110000');
  const winter = event('DTSTART;TZID=Europe/London:20261026T100000\r\nDTEND;TZID=Europe/London:20261026T110000').replace('UID:a', 'UID:b');
  const intervals = parseCalendarBusyIntervals(ics([timezone, summer, winter].join('\r\n')), { now });
  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].start.toISOString(), '2026-10-24T09:00:00.000Z');
  assert.equal(intervals[1].start.toISOString(), '2026-10-26T10:00:00.000Z');
  // The VTIMEZONE block carries its own RRULE lines describing the zone
  // transitions; they must not be mistaken for the event's recurrence.
  const series = parseCalendarBusyIntervals(
    ics([timezone, summer.replace('END:VEVENT', 'RRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT')].join('\r\n')), { now });
  assert.equal(series.length, 2);
});
