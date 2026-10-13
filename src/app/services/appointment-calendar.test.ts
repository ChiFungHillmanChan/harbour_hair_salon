import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCalendarEvent } from './appointment-calendar';
import { appointmentGoogleCalendarUrl, appointmentIcsBlob, appointmentIcsFile } from '../lib/calendar-links';

const appointment = {
  id: 'cmappt123', date: new Date('2026-10-24T10:30:00Z'), durationMinutes: 85,
  serviceName: 'Cut & Blow-dry', stylistName: 'Ivan', sequence: 1,
};

test('an English calendar entry: title, stylist, My Bookings link, salon address and the frozen duration', () => {
  assert.deepEqual(appointmentCalendarEvent(appointment, 'en-GB'), {
    uid: 'appointment-cmappt123@harbourhair.co.uk',
    sequence: 1,
    start: '2026-10-24T10:30:00.000Z',
    end: '2026-10-24T11:55:00.000Z',
    title: 'Cut & Blow-dry at Harbour Hair Salon',
    details: 'Stylist: Ivan\nView or change your booking: https://www.harbourhair.co.uk/appointments',
    location: 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX',
    url: 'https://www.harbourhair.co.uk/appointments',
    filename: 'harbour-hair-2026-10-24.ics',
  });
});

test('a Chinese calendar entry links to the Chinese My Bookings', () => {
  const event = appointmentCalendarEvent({ ...appointment, serviceName: '洗剪吹' }, 'zh-HK');
  assert.equal(event.title, '洗剪吹｜Harbour Hair Salon');
  assert.equal(event.details, '髮型師：Ivan\n查看或更改預約：https://www.harbourhair.co.uk/zh-hk/appointments');
  assert.equal(event.url, 'https://www.harbourhair.co.uk/zh-hk/appointments');
  assert.equal(event.location, 'Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX');
});

test('the file name is the salon date of the visit, whatever the UTC date', () => {
  // 23:30Z on 31 July is already 00:30 BST on 1 August in London.
  const late = appointmentCalendarEvent({ ...appointment, date: new Date('2026-07-31T23:30:00Z') }, 'en-GB');
  assert.equal(late.filename, 'harbour-hair-2026-08-01.ics', '00:30 BST on 1 August');
});

test('the Google link and the .ics file are built from the same entry', async () => {
  const event = appointmentCalendarEvent(appointment, 'en-GB');
  const link = new URL(appointmentGoogleCalendarUrl(event));
  assert.equal(link.searchParams.get('text'), event.title);
  assert.equal(link.searchParams.get('dates'), '20261024T103000Z/20261024T115500Z');
  assert.equal(link.searchParams.get('details'), event.details);
  assert.equal(link.searchParams.get('location'), event.location);
  const ics = appointmentIcsFile(event, 'PUBLISH', new Date('2026-10-13T08:00:00Z')).replace(/\r\n /g, '');
  assert.match(ics, /\r\nSUMMARY:Cut & Blow-dry at Harbour Hair Salon\r\n/);
  assert.match(ics, /\r\nDTEND:20261024T115500Z\r\n/);
  assert.match(ics, /\r\nSEQUENCE:1\r\n/);
  const blob = appointmentIcsBlob(event, new Date('2026-10-13T08:00:00Z'));
  assert.equal(blob.type, 'text/calendar;charset=utf-8');
  assert.equal(await blob.text(), appointmentIcsFile(event, 'PUBLISH', new Date('2026-10-13T08:00:00Z')));
});
