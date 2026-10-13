/**
 * "Add it to my calendar" for a customer's own appointment: a Google Calendar
 * link and an RFC 5545 .ics file (Apple Calendar, Outlook and the rest).
 *
 * Pure and dependency-free, so the same code runs where the confirmation and
 * reminder emails are built (server) and on My Bookings, where the file is
 * made in the browser as a Blob — no route, no database read.
 *
 * Every time is written in UTC, so no VTIMEZONE is needed and a clock change
 * between booking and appointment cannot move the event.
 */

/**
 * The appointment's identity in a customer's calendar. Deliberately NOT the
 * stylist busy feed's `<id>@harbourhair.co.uk` (stylist-ical-feed.ts): a
 * calendar that sees both must never treat one as an update of the other.
 * Re-sending the same UID with a higher SEQUENCE updates (or, with
 * METHOD:CANCEL, removes) the entry in calendars that honour it.
 */
export function appointmentCalendarUid(appointmentId: string): string {
  return `appointment-${appointmentId}@harbourhair.co.uk`;
}

/** 2026-10-24T10:30:00.000Z → 20261024T103000Z (RFC 5545 UTC "basic" form, also what Google expects). */
export function icsUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * A Google Calendar "add event" link, prefilled; the customer still presses
 * Save. It can only ever ADD an event — it cannot update or remove one — which
 * is why moved and cancelled bookings also ask the customer to tidy up.
 */
export function googleCalendarUrl(event: { title: string; start: Date; end: Date; details?: string; location?: string }): string {
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(event.title)}`,
    // Digits, T, Z and the slash only: nothing to encode.
    `dates=${icsUtc(event.start)}/${icsUtc(event.end)}`,
    ...(event.details ? [`details=${encodeURIComponent(event.details)}`] : []),
    ...(event.location ? [`location=${encodeURIComponent(event.location)}`] : []),
  ];
  return `https://calendar.google.com/calendar/render?${params.join('&')}`;
}

/** RFC 5545 §3.3.11 TEXT: escape backslash, semicolon and comma; every line break becomes `\n`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const utf8Octets = (codePoint: number) => (codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4);

/**
 * RFC 5545 §3.1: a content line longer than 75 octets continues on the next
 * line after CRLF and one space. Splits only between code points, so a
 * multi-byte character (Chinese text, an emoji) is never cut in half.
 */
export function foldIcsLine(line: string): string {
  const lines: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8Octets(char.codePointAt(0)!);
    if (octets + size > 75) {
      lines.push(current);
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

export type IcsMethod = 'PUBLISH' | 'CANCEL';

/**
 * One appointment as an iCalendar file. PUBLISH adds (or, with a higher
 * SEQUENCE, updates) the entry; CANCEL with the same UID marks it cancelled.
 */
export function appointmentIcs(input: {
  uid: string;
  /** The appointment's notificationVersion: grows with every change, so the latest file wins. */
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  method: IcsMethod;
  /** When this file was made (DTSTAMP); now unless given. */
  stamp?: Date;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbour Hair Salon//Appointments//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTAMP:${icsUtc(input.stamp ?? new Date())}`,
    `DTSTART:${icsUtc(input.start)}`,
    `DTEND:${icsUtc(input.end)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(input.sequence))}`,
    `STATUS:${input.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    ...(input.description ? [`DESCRIPTION:${escapeIcsText(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    // A URI value, not TEXT: it is never escaped (our own https links only).
    ...(input.url ? [`URL:${input.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * One appointment as a calendar entry, already in the customer's language
 * (built by services/appointment-calendar.ts). Plain strings, so a server page
 * can hand it to a client component.
 */
export type AppointmentCalendarEvent = {
  uid: string;
  sequence: number;
  /** ISO instants. */
  start: string;
  end: string;
  title: string;
  details: string;
  location: string;
  /** My Bookings, where the booking can be viewed or changed. */
  url: string;
  /** Name for the downloaded or attached .ics file. */
  filename: string;
};

export function appointmentGoogleCalendarUrl(event: AppointmentCalendarEvent): string {
  return googleCalendarUrl({ title: event.title, start: new Date(event.start), end: new Date(event.end), details: event.details, location: event.location });
}

export function appointmentIcsFile(event: AppointmentCalendarEvent, method: IcsMethod, stamp?: Date): string {
  return appointmentIcs({
    uid: event.uid, sequence: event.sequence, start: new Date(event.start), end: new Date(event.end),
    summary: event.title, description: event.details, location: event.location, url: event.url, method, stamp,
  });
}

/** The .ics file as a Blob, for a download made on the customer's device (no request, no database). */
export function appointmentIcsBlob(event: AppointmentCalendarEvent, stamp?: Date): Blob {
  return new Blob([appointmentIcsFile(event, 'PUBLISH', stamp)], { type: 'text/calendar;charset=utf-8' });
}
