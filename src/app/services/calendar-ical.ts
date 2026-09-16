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

const SALON_TIME_ZONE = 'Europe/London';
export const MAX_OCCURRENCES_PER_EVENT = 400;

/** Preserve the provider's UTC/TZID occurrences; only DATE values use salon days. */
function expandRecurrence(
  block: string,
  anchor: { start: Date; end: Date; uid: string; allDay: boolean },
  bounds: { now: Date; windowEnd: Date },
): CalendarBusyInterval[] {
  type Recurring = { rrule?: { between(a: Date, b: Date, inc?: boolean): Date[] } };
  if (anchor.allDay && /(?:^|[;:])(?:FREQ=(?:HOURLY|MINUTELY|SECONDLY)(?:;|$)|BY(?:HOUR|MINUTE|SECOND)=)/m.test(block.toUpperCase())) {
    throw new CalendarFeedError('Sub-daily recurrence rules are unsupported for date-only events.');
  }
  let event: Recurring | undefined;
  try {
    const parsed = icalSync.parseICS(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//x//EN\r\n${block}\r\nEND:VCALENDAR`);
    event = Object.values(parsed).find((entry) => entry?.type === 'VEVENT') as Recurring | undefined;
  } catch { throw new CalendarFeedError('Unreadable recurring calendar event.'); }
  if (!event?.rrule) throw new CalendarFeedError('Unreadable recurring calendar event.');

  const durationMs = anchor.end.getTime() - anchor.start.getTime();
  const calendarDays = anchor.allDay
    ? Math.round((Date.parse(formatInTimeZone(anchor.end, SALON_TIME_ZONE, 'yyyy-MM-dd')) - Date.parse(formatInTimeZone(anchor.start, SALON_TIME_ZONE, 'yyyy-MM-dd'))) / DAY_MS)
    : 0;
  // DATE values returned by node-ical use host-local midnight. Pad discovery,
  // then filter using the converted London instants so host TZ cannot drop a day.
  const margin = anchor.allDay ? 2 * DAY_MS : 0;
  let dates: Date[];
  try { dates = event.rrule.between(new Date(bounds.now.getTime() - durationMs - margin), new Date(bounds.windowEnd.getTime() + margin), true); }
  catch { throw new CalendarFeedError('Unsupported calendar recurrence rule.'); }
  if (dates.length > MAX_OCCURRENCES_PER_EVENT) throw new CalendarFeedError('Calendar has too many recurring occurrences.');

  // Parse the original EXDATE lists: node-ical's date-keyed map can collapse
  // multiple exclusions within one day. Validate before the permissive parser.
  const excluded = readExclusions(block.split(/\r?\n/), anchor.allDay);
  const intervals: CalendarBusyInterval[] = [];
  for (const date of dates) {
    const day = anchor.allDay ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
    const start = anchor.allDay ? fromZonedTime(`${day}T00:00:00`, SALON_TIME_ZONE) : date;
    if (excluded.has(start.getTime())) continue;
    const end = anchor.allDay
      ? fromZonedTime(`${new Date(Date.parse(day) + calendarDays * DAY_MS).toISOString().slice(0, 10)}T00:00:00`, SALON_TIME_ZONE)
      : new Date(start.getTime() + durationMs);
    if (end <= bounds.now || start >= bounds.windowEnd) continue;
    // Each occurrence is upserted separately on (source, stylistId, externalUid),
    // so they cannot share the series UID or they would overwrite each other.
    intervals.push({ uid: `${anchor.uid}::${start.toISOString()}`, start, end });
  }
  return intervals;
}

function readExclusions(fields: string[], allDay: boolean): Set<number> {
  const excluded = new Set<number>();
  for (const line of fields.filter((field) => /^EXDATE[;:]/.test(field))) {
    const split = line.indexOf(':');
    const property = line.slice(0, split).replace(/^EXDATE/, 'DTSTART');
    if (/;VALUE=DATE(?:;|$)/.test(property) !== allDay) throw new CalendarFeedError('Calendar exclusion date type must match its start.');
    for (const value of line.slice(split + 1).split(',')) excluded.add(eventDate(`${property}:${value}`)!.getTime());
  }
  return excluded;
}

/**
 * Recurring events follow their declared timezone; anything else that could
 * silently open an occupied slot is still refused. All-day events use
 * salon-local midnight, including DST. Entire documents fail atomically; an
 * unreadable event is never an empty feed.
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
    // recurring appointments. RRULE (with EXDATE) is expanded below; the rest
    // stay refused. RDATE and EXRULE are vanishingly rare in marketplace feeds,
    // and RECURRENCE-ID means a single occurrence was edited — honouring it
    // needs the whole series in hand, so guessing would move someone's booking.
    if (fields.some((line) => /^(RDATE|EXRULE|RECURRENCE-ID)[;:]/.test(line))) {
      throw new CalendarFeedError('Recurring calendar events are unsupported. Export individual appointments; previous busy times were retained.');
    }
    const recurring = fields.some((line) => /^RRULE[;:]/.test(line));
    for (const property of ['UID', 'DTSTART', 'DTEND', 'STATUS', 'TRANSP', 'RRULE']) {
      if (fields.filter((line) => line.startsWith(`${property}:`) || line.startsWith(`${property};`)).length > 1) {
        throw new CalendarFeedError('Ambiguous duplicate calendar event properties.');
      }
    }
    const uid = fields.find((line) => line.startsWith('UID:'))?.slice(4);
    if (!uid || uid.length > 1_024 || seen.has(uid)) throw new CalendarFeedError('Invalid or duplicate calendar event identifier.');
    seen.add(uid);
    if (fields.includes('STATUS:CANCELLED') || fields.includes('TRANSP:TRANSPARENT')) continue;
    const startLine = fields.find((line) => /^DTSTART[;:]/.test(line));
    const endLine = fields.find((line) => /^DTEND[;:]/.test(line));
    const allDay = Boolean(startLine && /;VALUE=DATE(?:;|:)/.test(startLine));
    if (endLine && /;VALUE=DATE(?:;|:)/.test(endLine) !== allDay) throw new CalendarFeedError('Calendar start and end date types must match.');
    if (fields.some((line) => /^DURATION[;:]/.test(line))) throw new CalendarFeedError('Calendar duration format is unsupported. Export an explicit end date.');
    readExclusions(fields, allDay);
    const start = eventDate(startLine);
    let end = eventDate(endLine);
    if (start && !end && startLine?.startsWith('DTSTART;VALUE=DATE:')) {
      const localDay = startLine.slice(-8);
      const next = new Date(`${localDay.slice(0, 4)}-${localDay.slice(4, 6)}-${localDay.slice(6, 8)}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      end = fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, 'Europe/London');
    }
    if (!start || !end || end <= start) throw new CalendarFeedError('Calendar event is missing a valid start or end.');
    try { icalSync.parseICS(`BEGIN:VCALENDAR\r\n${block}\r\nEND:VCALENDAR`); }
    catch { throw new CalendarFeedError('Invalid calendar event.'); }
    if (recurring) {
      result.push(...expandRecurrence(block, { start, end, uid, allDay }, { now, windowEnd }));
    } else if (end > now && start < windowEnd) result.push({ uid, start, end });
    if (result.length > MAX_CALENDAR_EVENTS) throw new CalendarFeedError('Calendar has too many events.');
  }
  return result;
}
