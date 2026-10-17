// Pure classification of the salon's Google diary
// (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §4).
// No database, no Google call. Transparency ("Show as available") is ignored:
// Google makes all-day events "available" by default, and every such event in
// the real diary is leave (spec §4 rule 6, amended 2026-10-17).

import { createHash } from 'node:crypto';
import { isGoogleColorId } from '@/app/lib/calendar-colors';
import { parseGoogleAliases } from '@/app/lib/google-aliases';
import type { GoogleEvent } from './google-calendar-gateway';
import { isWebsiteEvent } from './google-calendar-event';
import { eventInterval } from './google-busy-mapping';

/** The diary window looks back this far; entries that ended earlier are deleted (privacy notice). */
export const GOOGLE_DIARY_RETENTION_DAYS = 30;
export const GOOGLE_DIARY_LOOKAHEAD_DAYS = 90;
export const DIARY_TITLE_MAX = 200;

export const DIARY_KINDS = ['STYLIST', 'UNASSIGNED', 'LEAVE', 'NOTE'] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number];

export type DiaryStylist = { id: string; name: string; googleColorId: string | null; googleAliases: string | null };
/** Active stylists only (an inactive one never blocks), and the two salon colours. */
export type DiaryConfig = { stylists: readonly DiaryStylist[]; unassignedColorId: string; leaveColorId: string };
export type DiaryClassification = { kind: DiaryKind; stylistIds: string[] };
export type DiaryEntry = {
  googleEventId: string; kind: DiaryKind; stylistIds: string[]; title: string; colorId: string | null;
  start: Date; end: Date; allDay: boolean; htmlLink: string | null;
};

const HAN = /\p{Script=Han}/u;
const ONE_LATIN_LETTER = /^\p{Script=Latin}$/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Spec §4 "Name matching", case-insensitive:
 *  - a CJK name matches as a substring ("天off");
 *  - a one-letter Latin alias only in brackets ("早走(L)", "( F )");
 *  - a longer Latin name when no Latin letter is glued to its left and it is
 *    followed by the end, a non-letter, or "off" ("LoxOff", "lox.", "Day off lox"; not "Loxley").
 */
function nameMatcher(name: string): RegExp {
  const escaped = escapeRegExp(name);
  if (HAN.test(name)) return new RegExp(escaped, 'iu');
  if (ONE_LATIN_LETTER.test(name)) return new RegExp(`\\(\\s*${escaped}\\s*\\)`, 'iu');
  return new RegExp(`(?<!\\p{Script=Latin})${escaped}(?=$|[^\\p{Script=Latin}]|off)`, 'iu');
}

/** Every stylist the title names (own name or any alias), in the config's order. NFKC turns full-width "（Ｌ）" into "(L)". */
export function stylistsNamedIn(title: string, stylists: readonly DiaryStylist[]): string[] {
  const text = title.normalize('NFKC');
  const ids: string[] = [];
  for (const stylist of stylists) {
    const names = [stylist.name, ...parseGoogleAliases(stylist.googleAliases)]
      .map((name) => name.normalize('NFKC').trim())
      .filter((name) => name.length > 0);
    if (names.some((name) => nameMatcher(name).test(text))) ids.push(stylist.id);
  }
  return ids;
}

/** Spec §4, in order. null: not part of the diary (the website's own event, or cancelled). */
export function classifyDiaryEvent(event: GoogleEvent, config: DiaryConfig): DiaryClassification | null {
  if (isWebsiteEvent(event)) return null;
  if (event.status === 'cancelled') return null;
  if (event.colorId) {
    const owners = config.stylists.filter((stylist) => stylist.googleColorId === event.colorId).map((stylist) => stylist.id);
    if (owners.length > 0) return { kind: 'STYLIST', stylistIds: owners };
    if (event.colorId === config.unassignedColorId) return { kind: 'UNASSIGNED', stylistIds: [] };
  }
  // The leave colour, any other colour and no colour alike: the title decides.
  const named = stylistsNamedIn(event.summary ?? '', config.stylists);
  return named.length > 0 ? { kind: 'LEAVE', stylistIds: named } : { kind: 'NOTE', stylistIds: [] };
}

function diaryTitle(summary: string | undefined): string {
  // By code point, so a cut never splits a surrogate pair.
  return Array.from((summary ?? '').replace(/\s+/g, ' ').trim()).slice(0, DIARY_TITLE_MAX).join('');
}

/** Google's own event links only: anything else is never rendered as a link in Admin. Parsed, not pattern-matched. */
function safeLink(link: string | undefined): string | null {
  if (!link || link.length > 500) return null;
  try {
    const url = new URL(link);
    const ok = url.protocol === 'https:' && url.hostname === 'www.google.com' && url.pathname === '/calendar/event'
      && url.port === '' && url.username === '' && url.password === '';
    return ok ? link : null;
  } catch {
    return null;
  }
}

/** The diary as stored (spec §7): classified events with a valid interval, one per Google id. Only the title is kept. */
export function diaryEntriesFrom(events: readonly GoogleEvent[], config: DiaryConfig): DiaryEntry[] {
  const seen = new Set<string>();
  const entries: DiaryEntry[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    const classification = classifyDiaryEvent(event, config);
    if (!classification) continue;
    const interval = eventInterval(event);
    if (!interval) continue;
    seen.add(event.id);
    entries.push({
      googleEventId: event.id,
      kind: classification.kind,
      stylistIds: classification.stylistIds,
      title: diaryTitle(event.summary),
      colorId: isGoogleColorId(event.colorId) ? event.colorId : null,
      start: interval.start,
      end: interval.end,
      allDay: !event.start?.dateTime && Boolean(event.start?.date),
      htmlLink: safeLink(event.htmlLink),
    });
  }
  return entries;
}

/** Equal for the same entries in any order: the pull rewrites the diary only when it changed. */
export function diaryHash(entries: readonly DiaryEntry[]): string {
  const rows = entries
    .map((entry) => JSON.stringify([
      entry.googleEventId, entry.kind, [...entry.stylistIds].sort(), entry.title, entry.colorId,
      entry.start.toISOString(), entry.end.toISOString(), entry.allDay, entry.htmlLink,
    ]))
    .sort();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
