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
test('recurrence rules are explicitly refused instead of silently freeing recurring busy time', () => {
  assert.throws(() => parseCalendarBusyIntervals(ics(event('DTSTART:20261024T100000Z\r\nDTEND:20261024T110000Z\r\nRRULE:FREQ=DAILY')), { now }), /recurr/i);
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
  assert.throws(() => parseCalendarBusyIntervals(ics([timezone, summer.replace('END:VEVENT', 'RRULE:FREQ=DAILY\r\nEND:VEVENT')].join('\r\n')), { now }), /recurr/i);
});
