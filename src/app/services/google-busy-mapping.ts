// Busy blocks for the stylists the diary names (spec §5 of the diary mirror
// design, docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md),
// and the interval of a Google event. Nothing here reads the database.

import { createHash } from 'node:crypto';
import { fromZonedTime } from 'date-fns-tz';
import type { GoogleEvent } from './google-calendar-gateway';
import type { DiaryEntry } from './google-diary-classify';
import { SALON_TIMEZONE } from './salon-time';

export type GoogleBusyBlock = { externalUid: string; stylistId: string; start: Date; end: Date };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The following calendar day, or null for a malformed date (one bad event must never stop the pull). */
function nextDay(day: string): string | null {
  if (!DAY_RE.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** An all-day date is salon-local midnight (DST-correct), not UTC midnight. */
function salonMidnight(day: string): Date | null {
  if (!DAY_RE.test(day)) return null;
  const at = fromZonedTime(`${day}T00:00:00`, SALON_TIMEZONE);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function eventInterval(event: GoogleEvent): { start: Date; end: Date } | null {
  let start: Date | null;
  let end: Date | null;
  if (event.start?.dateTime) {
    start = new Date(event.start.dateTime);
    end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  } else if (event.start?.date) {
    start = salonMidnight(event.start.date);
    const endDay = event.end?.date ?? nextDay(event.start.date);
    end = endDay ? salonMidnight(endDay) : null;
  } else {
    return null;
  }
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { start, end };
}

/**
 * STYLIST and LEAVE entries block their stylists, exactly as #72 stored them
 * (one row per event and stylist). UNASSIGNED entries are the chair rule's
 * (diary-chair-rule.ts) and NOTE entries block nothing: neither is ever a busy
 * block, so neither reaches a Fresha busy feed.
 */
export function googleBusyBlocks(entries: readonly DiaryEntry[]): GoogleBusyBlock[] {
  const blocks: GoogleBusyBlock[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'STYLIST' && entry.kind !== 'LEAVE') continue;
    for (const stylistId of new Set(entry.stylistIds)) {
      blocks.push({
        externalUid: createHash('sha256').update(`${entry.googleEventId}::${stylistId}`).digest('hex'),
        stylistId, start: entry.start, end: entry.end,
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
