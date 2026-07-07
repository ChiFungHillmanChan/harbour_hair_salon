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
 * Returns `null` when the input is NOT a structurally valid iCal document
 * (missing the VCALENDAR envelope, or node-ical throws). Callers MUST treat
 * `null` as "could not read the feed" and never prune on it — otherwise a
 * Treatwell endpoint that returns an HTML login/maintenance page or an empty
 * body (HTTP 200) would look like an empty calendar and wipe every synced busy
 * block, re-opening slots to double-booking. A genuinely empty-but-valid
 * calendar returns `[]` (prune is then correct).
 *
 * Scope (v1): non-recurring timed VEVENTs only. Recurring events (rrule) are
 * skipped — Treatwell appointment feeds emit discrete events. All-day events
 * (datetype === 'date') with no DTEND block the whole day they start on.
 */
export function parseIcalBusyIntervals(
  icsText: string,
  opts: { now?: Date; windowEnd?: Date } = {},
): BusyInterval[] | null {
  // Require the full VCALENDAR envelope. An HTML error page, empty body, or a
  // truncated feed fails this and is reported as invalid (null), not empty.
  if (!icsText || !icsText.includes('BEGIN:VCALENDAR') || !icsText.includes('END:VCALENDAR')) {
    return null;
  }

  const now = opts.now ?? new Date();
  const windowEnd = opts.windowEnd ?? new Date(now.getTime() + 90 * DAY_MS);

  let parsed: CalendarResponse;
  try {
    parsed = icalSync.parseICS(icsText);
  } catch {
    return null;
  }

  const out: BusyInterval[] = [];
  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT') continue;
    if ((ev as { rrule?: unknown }).rrule) continue; // skip recurring (v1)
    if (String((ev as { status?: unknown }).status ?? '').toUpperCase() === 'CANCELLED') continue;
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
