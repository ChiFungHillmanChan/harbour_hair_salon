import { sync as icalSync } from 'node-ical';
import type { CalendarResponse } from 'node-ical';

export type BusyInterval = { uid: string; start: Date; end: Date; summary?: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** node-ical returns SUMMARY as a string or a `{ val }` parameter object. */
function toStr(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'val' in value) return String((value as { val: unknown }).val);
  return String(value);
}

/**
 * Parse an iCal (.ics) document into busy intervals, keeping only events that
 * overlap the forward window [now, windowEnd). Pure: no network, no DB.
 *
 * Scope (v1): non-recurring timed VEVENTs only. Recurring events (rrule) are
 * skipped — Treatwell appointment feeds emit discrete events. All-day events
 * (datetype === 'date') with no DTEND block the whole day they start on.
 */
export function parseIcalBusyIntervals(
  icsText: string,
  opts: { now?: Date; windowEnd?: Date } = {},
): BusyInterval[] {
  if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) return [];

  const now = opts.now ?? new Date();
  const windowEnd = opts.windowEnd ?? new Date(now.getTime() + 90 * DAY_MS);

  let parsed: CalendarResponse;
  try {
    parsed = icalSync.parseICS(icsText);
  } catch {
    return [];
  }

  const out: BusyInterval[] = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT') continue;
    if ((ev as { rrule?: unknown }).rrule) continue; // skip recurring (v1)
    if (!ev.start) continue;

    const start = new Date(ev.start);
    let end: Date;
    if (ev.end) {
      end = new Date(ev.end);
    } else if (ev.datetype === 'date') {
      end = new Date(start.getTime() + DAY_MS); // all-day with no DTEND
    } else {
      continue; // timed event without DTEND — cannot bound it
    }
    if (!(end > start)) continue;

    // Keep only events overlapping [now, windowEnd)
    if (end <= now) continue;
    if (start >= windowEnd) continue;

    out.push({ uid: String(ev.uid ?? key), start, end, summary: toStr(ev.summary) });
  }
  return out;
}
