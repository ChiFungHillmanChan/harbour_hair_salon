import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCalendarUid, appointmentIcs, appointmentIcsBlob, appointmentIcsFile, escapeIcsText, foldIcsLine, googleCalendarUrl, icsUtc, type AppointmentCalendarEvent } from './calendar-links';
import { resolveSalonDateTime } from '../services/salon-time';

const start = new Date('2026-10-24T10:30:00Z'); // 11:30 BST
const end = new Date('2026-10-24T11:30:00Z');
const stamp = new Date('2026-10-13T08:00:00Z');
const ADDRESS = 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX';
const DETAILS = 'Stylist: Ivan\nView or change your booking: https://www.harbourhair.co.uk/appointments';

test('times are written as UTC basic format', () => {
  assert.equal(icsUtc(start), '20261024T103000Z');
  assert.equal(icsUtc(new Date('2026-10-24T10:30:45.678Z')), '20261024T103045Z');
});

test('a Google Calendar link carries the title, UTC times, details and location, URL-encoded', () => {
  const url = googleCalendarUrl({ title: 'Cut & Blow-dry at Harbour Hair Salon', start, end, details: DETAILS, location: ADDRESS });
  assert.equal(url,
    'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=Cut%20%26%20Blow-dry%20at%20Harbour%20Hair%20Salon'
    + '&dates=20261024T103000Z/20261024T113000Z'
    + '&details=Stylist%3A%20Ivan%0AView%20or%20change%20your%20booking%3A%20https%3A%2F%2Fwww.harbourhair.co.uk%2Fappointments'
    + '&location=Upper%20Floor%2C%20Unit%2015%20Central%20Arcade%2C%20Central%20Rd%2C%20Leeds%20LS1%206DX');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('text'), 'Cut & Blow-dry at Harbour Hair Salon');
  assert.equal(parsed.searchParams.get('details'), DETAILS);
  assert.equal(parsed.searchParams.get('location'), ADDRESS);
});

test('Chinese text survives the Google link, and an absent detail is simply left out', () => {
  const url = new URL(googleCalendarUrl({ title: '於 Harbour Hair Salon 剪髮', start, end }));
  assert.equal(url.searchParams.get('text'), '於 Harbour Hair Salon 剪髮');
  assert.equal(url.searchParams.has('details'), false);
  assert.equal(url.searchParams.has('location'), false);
});

test('Google link times are the real instants on both sides of the clocks going back', () => {
  const saturday = resolveSalonDateTime('2026-10-24', '11:00').utc; // BST
  const sunday = resolveSalonDateTime('2026-10-25', '11:00').utc; // GMT
  assert.equal(new URL(googleCalendarUrl({ title: 'x', start: saturday, end: new Date(saturday.getTime() + 3_600_000) })).searchParams.get('dates'), '20261024T100000Z/20261024T110000Z');
  assert.equal(new URL(googleCalendarUrl({ title: 'x', start: sunday, end: new Date(sunday.getTime() + 3_600_000) })).searchParams.get('dates'), '20261025T110000Z/20261025T120000Z');
});

const event = {
  uid: appointmentCalendarUid('cmappt123'), sequence: 2, start, end,
  summary: 'Cut at Harbour Hair Salon', description: DETAILS, location: ADDRESS,
  url: 'https://www.harbourhair.co.uk/appointments', stamp,
};
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

test('an .ics file is one VEVENT in a VCALENDAR, every line ending in CRLF', () => {
  const ics = appointmentIcs({ ...event, method: 'PUBLISH' });
  assert.ok(ics.endsWith('\r\n'));
  assert.doesNotMatch(ics, /[^\r]\n/, 'no bare LF line endings');
  const lines = unfold(ics).trimEnd().split('\r\n');
  assert.deepEqual(lines, [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbour Hair Salon//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:appointment-cmappt123@harbourhair.co.uk',
    'DTSTAMP:20261013T080000Z',
    'DTSTART:20261024T103000Z',
    'DTEND:20261024T113000Z',
    'SEQUENCE:2',
    'STATUS:CONFIRMED',
    'SUMMARY:Cut at Harbour Hair Salon',
    'DESCRIPTION:Stylist: Ivan\\nView or change your booking: https://www.harbourhair.co.uk/appointments',
    'LOCATION:Upper Floor\\, Unit 15 Central Arcade\\, Central Rd\\, Leeds LS1 6DX',
    'URL:https://www.harbourhair.co.uk/appointments',
    'END:VEVENT',
    'END:VCALENDAR',
  ]);
});

test('a cancellation is METHOD:CANCEL, STATUS:CANCELLED, with the same UID', () => {
  const cancel = unfold(appointmentIcs({ ...event, sequence: 3, method: 'CANCEL' }));
  assert.match(cancel, /\r\nMETHOD:CANCEL\r\n/);
  assert.match(cancel, /\r\nSTATUS:CANCELLED\r\n/);
  assert.match(cancel, /\r\nSEQUENCE:3\r\n/);
  assert.match(cancel, /\r\nUID:appointment-cmappt123@harbourhair\.co\.uk\r\n/);
});

// RFC 5546 (iTIP) requires an ORGANIZER on PUBLISH and CANCEL objects sent by email.
const organizer = { name: 'Harbour Hair Salon', email: 'hello@harbourhair.co.uk' };
const ORGANIZER_LINE = 'ORGANIZER;CN="Harbour Hair Salon":mailto:hello@harbourhair.co.uk';

test('an emailed file names its organizer inside the event, for PUBLISH and CANCEL alike', () => {
  for (const method of ['PUBLISH', 'CANCEL'] as const) {
    const lines = unfold(appointmentIcs({ ...event, method, organizer })).trimEnd().split('\r\n');
    const at = lines.indexOf(ORGANIZER_LINE);
    assert.ok(at > lines.indexOf('BEGIN:VEVENT') && at < lines.indexOf('END:VEVENT'), method);
    assert.equal(lines.filter((line) => line.startsWith('ORGANIZER')).length, 1, method);
  }
  assert.doesNotMatch(appointmentIcs({ ...event, method: 'PUBLISH' }), /ORGANIZER/, 'none unless given');
});

test('the organizer name is a quoted parameter value: double quotes and control characters are dropped, never escaped', () => {
  const ics = unfold(appointmentIcs({ ...event, method: 'PUBLISH', organizer: { name: 'Harbour "Hair" Salon, Leeds; UK\r\n', email: 'hello@harbourhair.co.uk' } }));
  assert.match(ics, /\r\nORGANIZER;CN="Harbour Hair Salon, Leeds; UK":mailto:hello@harbourhair\.co\.uk\r\n/);
});

test('a long organizer line folds at 75 octets, never inside a character, and unfolds to the original', () => {
  const long = { name: '海港髮型屋 Harbour Hair Salon（利茲中央商場分店）', email: 'appointments.and.enquiries@harbourhair.co.uk' };
  const ics = appointmentIcs({ ...event, method: 'CANCEL', organizer: long });
  const strict = new TextDecoder('utf-8', { fatal: true });
  for (const line of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
    assert.doesNotThrow(() => strict.decode(Buffer.from(line, 'utf8')));
  }
  assert.ok(unfold(ics).includes(`\r\nORGANIZER;CN="${long.name}":mailto:${long.email}\r\n`));
});

test('appointmentIcsFile passes the organizer through; the My Bookings download (a file, not an email) has none', async () => {
  const calendarEvent: AppointmentCalendarEvent = {
    uid: appointmentCalendarUid('cmappt123'), sequence: 1, start: start.toISOString(), end: end.toISOString(),
    title: 'Cut at Harbour Hair Salon', details: DETAILS, location: ADDRESS,
    url: 'https://www.harbourhair.co.uk/appointments', filename: 'harbour-hair-2026-10-24.ics',
  };
  assert.ok(unfold(appointmentIcsFile(calendarEvent, 'PUBLISH', stamp, organizer)).includes(`\r\n${ORGANIZER_LINE}\r\n`));
  assert.doesNotMatch(appointmentIcsFile(calendarEvent, 'PUBLISH', stamp), /ORGANIZER/);
  const download = await appointmentIcsBlob(calendarEvent, stamp).text();
  assert.match(download, /\r\nMETHOD:PUBLISH\r\n/);
  assert.doesNotMatch(download, /ORGANIZER/);
});

test('DTSTAMP defaults to the moment the file is made', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T09:15:00Z') });
  assert.match(appointmentIcs({ ...event, stamp: undefined, method: 'PUBLISH' }), /\r\nDTSTAMP:20261020T091500Z\r\n/);
});

test('the customer UID can never collide with the stylist busy feed (<id>@harbourhair.co.uk)', () => {
  assert.equal(appointmentCalendarUid('abc'), 'appointment-abc@harbourhair.co.uk');
  assert.notEqual(appointmentCalendarUid('abc'), 'abc@harbourhair.co.uk');
});

test('TEXT values escape backslash, semicolon, comma and every kind of newline', () => {
  assert.equal(escapeIcsText('a\\b;c,d\ne\r\nf\rg'), 'a\\\\b\\;c\\,d\\ne\\nf\\ng');
  const ics = unfold(appointmentIcs({ ...event, summary: 'Cut; colour, and\\or style', method: 'PUBLISH' }));
  assert.match(ics, /\r\nSUMMARY:Cut\\; colour\\, and\\\\or style\r\n/);
});

test('a line of exactly 75 octets stays whole; one octet more folds', () => {
  assert.equal(foldIcsLine('x'.repeat(75)), 'x'.repeat(75));
  assert.equal(foldIcsLine('x'.repeat(76)), `${'x'.repeat(75)}\r\n x`);
});

test('long lines fold at 75 octets with CRLF + space and unfold to the original', () => {
  const description = 'A long note about the appointment. '.repeat(8);
  const ics = appointmentIcs({ ...event, description, method: 'PUBLISH' });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.ok(unfold(ics).includes(`\r\nDESCRIPTION:${description}\r\n`));
});

test('folding never splits a multi-byte character: every folded line is valid UTF-8 on its own', () => {
  // Three bytes per Chinese character and four per emoji: a fold at a fixed
  // byte count would cut one in half somewhere in here.
  const summary = `${'女士洗剪吹'.repeat(17)} 💇‍♀️ ${'於 Harbour Hair Salon 剪髮，'.repeat(3)}`;
  const ics = appointmentIcs({ ...event, summary, method: 'PUBLISH' });
  const bytes = Buffer.from(ics, 'utf8');
  const strict = new TextDecoder('utf-8', { fatal: true });
  let from = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || (bytes[i] === 0x0d && bytes[i + 1] === 0x0a)) {
      const segment = bytes.subarray(from, i);
      assert.ok(segment.length <= 75, `${segment.length} octets`);
      assert.doesNotThrow(() => strict.decode(segment));
      from = i + 2;
      i++;
    }
  }
  assert.ok(unfold(ics).includes(`\r\nSUMMARY:${escapeIcsText(summary)}\r\n`));
});
