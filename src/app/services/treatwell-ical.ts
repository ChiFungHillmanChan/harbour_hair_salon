import { parseCalendarBusyIntervals, type CalendarBusyInterval } from './calendar-ical';
export type BusyInterval = CalendarBusyInterval;

/** Legacy nullable contract backed by the strict provider-neutral parser. */
export function parseIcalBusyIntervals(text: string, options: { now?: Date; windowEnd?: Date } = {}): BusyInterval[] | null {
  try { return parseCalendarBusyIntervals(text, options); }
  catch { return null; }
}
