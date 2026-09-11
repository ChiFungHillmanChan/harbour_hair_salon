import { sync as icalSync } from 'node-ical';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export type CalendarBusyInterval = { uid: string; start: Date; end: Date };
export const CALENDAR_WINDOW_DAYS = 90;
export const MAX_CALENDAR_EVENTS = 2_000;
const DAY_MS = 86_400_000;

/** Safe, operator-facing messages only: never include source text or feed URLs. */
export class CalendarFeedError extends Error {}

function eventDate(line: string | undefined): Date | undefined {
  if (!line) return undefined;
  const split = line.indexOf(':');
  const property = line.slice(0, split);
  const value = line.slice(split + 1);
  const day = /^\d{8}$/.test(value) && /;VALUE=DATE(?:;|$)/.test(property);
  const timed = /^\d{8}T\d{6}Z?$/.test(value);
  if (!day && !timed) throw new CalendarFeedError('Invalid calendar event date.');
  const zone = /;TZID=("[^"]+"|[^;]+)/.exec(property)?.[1]?.replace(/^"|"$/g, '');
  if (!day && !value.endsWith('Z') && !zone) {
    throw new CalendarFeedError('Floating calendar times are unsupported. Export UTC or a named time zone.');
  }
  const tz = day ? 'Europe/London' : value.endsWith('Z') ? 'UTC' : zone!;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(); }
  catch { throw new CalendarFeedError('Unsupported calendar time zone.'); }
  const local = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${day ? '00:00:00' : `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`}`;
  const result = fromZonedTime(local, tz);
  if (!Number.isFinite(result.getTime()) || formatInTimeZone(result, tz, "yyyy-MM-dd'T'HH:mm:ss") !== local) {
    throw new CalendarFeedError('Invalid calendar date or daylight-saving time.');
  }
  return result;
}

/**
 * Discrete appointments only. Refuse recurrence rather than silently opening
 * occupied slots. All-day events use salon-local midnight, including DST.
 * Entire documents fail atomically; an unreadable event is never an empty feed.
 */
export function parseCalendarBusyIntervals(
  text: string,
  options: { now?: Date; windowEnd?: Date } = {},
): CalendarBusyInterval[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').trim().split(/\r?\n/).map((line) => {
    const normalized = line.replace(/^[^:;]+/, (name) => name.toUpperCase());
    return /^(BEGIN|END|STATUS|TRANSP|METHOD):/.test(normalized) ? normalized.toUpperCase() : normalized;
  });
  const unfolded = lines.join('\r\n');
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR' ||
      lines.filter((line) => line === 'BEGIN:VCALENDAR').length !== 1 ||
      lines.filter((line) => line === 'END:VCALENDAR').length !== 1) {
    throw new CalendarFeedError('Invalid or truncated calendar feed.');
  }
  if (lines.includes('BEGIN:VFREEBUSY')) throw new CalendarFeedError('Unsupported free/busy calendar format. Export individual appointments.');
  if (lines.some((line) => /^METHOD:/.test(line) && line !== 'METHOD:PUBLISH')) {
    throw new CalendarFeedError('Unsupported calendar update method. A complete published feed is required.');
  }
  const eventBlocks = unfolded.match(/BEGIN:VEVENT\r?\n[\s\S]*?\r?\nEND:VEVENT/g) ?? [];
  if (eventBlocks.length !== lines.filter((line) => line === 'BEGIN:VEVENT').length ||
      eventBlocks.length !== lines.filter((line) => line === 'END:VEVENT').length) {
    throw new CalendarFeedError('Invalid or truncated calendar event.');
  }
  if (eventBlocks.length > MAX_CALENDAR_EVENTS) throw new CalendarFeedError('Calendar has too many events.');
  const now = options.now ?? new Date();
  const windowEnd = options.windowEnd ?? new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS);
  const seen = new Set<string>();
  const result: CalendarBusyInterval[] = [];
  for (const block of eventBlocks) {
    const fields = block.split(/\r?\n/);
    // VTIMEZONE STANDARD/DAYLIGHT rules describe zone transitions, not
    // recurring appointments. Only recurrence inside a VEVENT is unsupported.
    if (fields.some((line) => /^(RRULE|RDATE|EXRULE|EXDATE|RECURRENCE-ID)[;:]/.test(line))) {
      throw new CalendarFeedError('Recurring calendar events are unsupported. Export individual appointments; previous busy times were retained.');
    }
    for (const property of ['UID', 'DTSTART', 'DTEND', 'STATUS', 'TRANSP']) {
      if (fields.filter((line) => line.startsWith(`${property}:`) || line.startsWith(`${property};`)).length > 1) {
        throw new CalendarFeedError('Ambiguous duplicate calendar event properties.');
      }
    }
    const uid = fields.find((line) => line.startsWith('UID:'))?.slice(4);
    if (!uid || uid.length > 1_024 || seen.has(uid)) throw new CalendarFeedError('Invalid or duplicate calendar event identifier.');
    seen.add(uid);
    if (fields.includes('STATUS:CANCELLED') || fields.includes('TRANSP:TRANSPARENT')) continue;
    // node-ical validates the event envelope; explicit date validation above
    // avoids its permissive fallback for unknown zones and malformed dates.
    try { icalSync.parseICS(`BEGIN:VCALENDAR\r\n${block}\r\nEND:VCALENDAR`); }
    catch { throw new CalendarFeedError('Invalid calendar event.'); }
    const startLine = fields.find((line) => /^DTSTART[;:]/.test(line));
    const endLine = fields.find((line) => /^DTEND[;:]/.test(line));
    const start = eventDate(startLine);
    let end = eventDate(endLine);
    if (start && !end && startLine?.startsWith('DTSTART;VALUE=DATE:')) {
      const localDay = startLine.slice(-8);
      const next = new Date(`${localDay.slice(0, 4)}-${localDay.slice(4, 6)}-${localDay.slice(6, 8)}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      end = fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, 'Europe/London');
    }
    if (!start || !end || end <= start) throw new CalendarFeedError('Calendar event is missing a valid start or end.');
    if (end > now && start < windowEnd) result.push({ uid, start, end });
  }
  return result;
}
