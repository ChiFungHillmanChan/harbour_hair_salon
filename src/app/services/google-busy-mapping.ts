// Pure mapping of the salon Google Calendar's own events to stylist busy
// blocks (spec §6). Nothing here reads the database.

import { createHash } from 'node:crypto';
import { fromZonedTime } from 'date-fns-tz';
import type { GoogleEvent } from './google-calendar-gateway';
import { SALON_TIMEZONE } from './salon-time';
import { GOOGLE_APPOINTMENT_PROPERTY } from './google-calendar-event';

export type GoogleBusyBlock = { externalUid: string; stylistId: string; start: Date; end: Date };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** An all-day date is salon-local midnight (DST-correct), not UTC midnight. */
function salonMidnight(day: string): Date | null {
  if (!DAY_RE.test(day)) return null;
  const at = fromZonedTime(`${day}T00:00:00`, SALON_TIMEZONE);
  return Number.isNaN(at.getTime()) ? null : at;
}

function eventInterval(event: GoogleEvent): { start: Date; end: Date } | null {
  let start: Date | null;
  let end: Date | null;
  if (event.start?.dateTime) {
    start = new Date(event.start.dateTime);
    end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  } else if (event.start?.date) {
    start = salonMidnight(event.start.date);
    end = salonMidnight(event.end?.date ?? nextDay(event.start.date));
  } else {
    return null;
  }
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { start, end };
}

export function googleBusyBlocks(events: GoogleEvent[], stylists: { id: string; name: string }[]): GoogleBusyBlock[] {
  // Longest name first, so "Lox Chan holiday" is Lox Chan's and not Lox's.
  const matchers = stylists
    .filter((s) => s.name.trim().length > 0)
    .sort((a, b) => b.name.trim().length - a.name.trim().length)
    .map((s) => ({ id: s.id, re: new RegExp('^' + escapeRegExp(s.name.trim()) + '(?=$|[\\s:：\\-·])', 'i') }));

  const blocks: GoogleBusyBlock[] = [];
  for (const event of events) {
    // Echo guard: an event the website wrote is never a block, whatever its state,
    // or every booking would clash with itself.
    if (event.extendedProperties?.private && GOOGLE_APPOINTMENT_PROPERTY in event.extendedProperties.private) continue;
    if (event.status === 'cancelled' || event.transparency === 'transparent') continue;
    const interval = eventInterval(event);
    if (!interval) continue;
    const title = (event.summary ?? '').trim();
    const named = title ? matchers.find((m) => m.re.test(title)) : undefined;
    const targets = named ? [named.id] : stylists.map((s) => s.id);
    for (const stylistId of targets) {
      blocks.push({
        externalUid: createHash('sha256').update(`${event.id}::${stylistId}`).digest('hex'),
        stylistId, start: interval.start, end: interval.end,
      });
    }
  }
  return blocks;
}

/** Equal for the same set of blocks in any order: the pull writes only when it changed. */
export function googleBusyHash(blocks: GoogleBusyBlock[]): string {
  const rows = blocks
    .map((b) => [b.externalUid, b.stylistId, b.start.toISOString(), b.end.toISOString()])
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
