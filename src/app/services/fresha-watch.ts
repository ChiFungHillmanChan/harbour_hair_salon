// The Fresha watch (docs/superpowers/specs/2026-10-26-fresha-watch-and-google-mirror-design.md):
// every 5 minutes in staff hours, read each stylist's Fresha export and compare
// it with the last one seen. Only a feed that CHANGED is imported (one Neon
// wake) and copied to the Google mirror; an unchanged tick costs the Fresha
// requests and one Redis read, never the database. The half-hourly
// calendar-sync import stays as it was: it keeps every feed's lastSuccessAt
// fresh for the booking gate whether or not this watch runs.

import { createHash } from 'node:crypto';
import type { Locale } from '@/i18n/config';
import { CalendarFeedError, CALENDAR_WINDOW_DAYS, parseCalendarBusyIntervals } from './calendar-ical';
import type { CalendarSyncResult } from './calendar-sync-service';
import { reconcileFreshaMirror, type FreshaMirrorGateway } from './fresha-mirror';
import { GoogleCalendarError } from './google-calendar-gateway';

export type FreshaWatchConnection = { id: string; stylistName: string; googleColorId: string | null; inboundUrl: string };
/** What the watch needs from the database, read through the Data Cache (fresha-watch-connections.ts). */
export type FreshaWatchSnapshot = { locale: Locale; connections: FreshaWatchConnection[] };

/** Per connection: the last feed imported and mirrored, and when a failing step may be tried again. */
export type FreshaWatchEntry = { imported?: string; mirrored?: string; feedRetryAt?: number; mirrorRetryAt?: number };
/** `importTicks`: when the ticks of the last hour that imported anything ran (MAX_IMPORT_TICKS_PER_HOUR). */
export type FreshaWatchState = { feeds: Record<string, FreshaWatchEntry>; importTicks: number[] };
export type FreshaWatchStore = { read(): Promise<FreshaWatchState | null>; write(state: FreshaWatchState): Promise<void> };

export type FreshaWatchDependencies = {
  store: FreshaWatchStore;
  loadSnapshot: () => Promise<FreshaWatchSnapshot>;
  /** The pinned HTTPS transport (calendar-feed-url.ts). */
  fetchFeed: (url: string) => Promise<string>;
  /** Imports one connection from the text just fetched (syncCalendarFeeds with that connection). */
  importFeed: (connectionId: string, feed: { url: string; text: string }) => Promise<CalendarSyncResult[]>;
  /** Null while the mirror is off. */
  mirror: FreshaMirrorGateway | null;
  /** No new import or Google write is started after this instant. */
  deadline: number;
  now?: () => number;
};

export type FreshaWatchResult = {
  skipped?: 'state-unavailable';
  checked: number; changed: number; imported: number; mirrored: number; failed: number;
  /** Changes left for a later tick (or the half-hourly import) because the hour's import budget was spent. */
  deferred: number;
};

/** A feed that cannot be fetched is left alone for this long (three ticks): Fresha is not asked on every tick while it fails. */
export const FEED_RETRY_MS = 15 * 60_000;
/** A mirror Google refuses (calendar not shared, wrong id) is tried again after this long. */
export const MIRROR_RETRY_MS = 30 * 60_000;
/**
 * The hard ceiling on what the watch can cost: at most this many ticks an hour
 * import (each is one Neon wake, however many feeds it imports). Real Fresha
 * changes come a few an hour and rarely reach it. It is there for the day the
 * export gains another field that changes on every request: without it, every
 * tick would look like a change and pin Neon awake, the August 2026 failure.
 */
export const MAX_IMPORT_TICKS_PER_HOUR = 4;
const HOUR_MS = 60 * 60_000;

/**
 * The feed's identity for change detection. Fresha renders the export afresh
 * on every request and stamps each event's DTSTAMP with the request time
 * (measured 2026-10-26), so DTSTAMP is left out or every tick would look
 * like a change. Folded lines are unfolded first and line endings ignored.
 */
export function feedFingerprint(text: string): string {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^DTSTAMP[;:]/i.test(line));
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * One watch tick. Never throws for one feed's problem: a feed that cannot be
 * fetched waits FEED_RETRY_MS; an import is tried once per feed change, failed
 * or not (its own lastError tells the admin), because each attempt wakes Neon
 * and the half-hourly import retries anyway. Throws only when the snapshot
 * cannot be loaded. Without its Redis state the watch does nothing at all.
 */
export async function runFreshaWatch(deps: FreshaWatchDependencies): Promise<FreshaWatchResult> {
  const clock = deps.now ?? Date.now;
  const result: FreshaWatchResult = { checked: 0, changed: 0, imported: 0, mirrored: 0, failed: 0, deferred: 0 };
  let previous: FreshaWatchState;
  try {
    previous = (await deps.store.read()) ?? { feeds: {}, importTicks: [] };
  } catch (error) {
    // Without the last fingerprints every feed would look changed: never fall back to importing.
    console.error('Fresha watch: state unavailable:', error instanceof Error ? error.name : 'unknown');
    return { ...result, skipped: 'state-unavailable' };
  }
  const snapshot = await deps.loadSnapshot();
  const started = clock();
  // Only the connections still watched are kept: a removed one's entry goes.
  const state: FreshaWatchState = { feeds: {}, importTicks: previous.importTicks.filter((at) => at > started - HOUR_MS) };
  for (const connection of snapshot.connections) state.feeds[connection.id] = { ...previous.feeds[connection.id] };
  let dirty = Object.keys(previous.feeds).some((id) => !(id in state.feeds));
  const mayImport = state.importTicks.length < MAX_IMPORT_TICKS_PER_HOUR;
  let importedThisTick = false;

  const due = snapshot.connections.filter((connection) => !((state.feeds[connection.id].feedRetryAt ?? 0) > started));
  const fetched = await Promise.allSettled(due.map((connection) => deps.fetchFeed(connection.inboundUrl)));
  for (const [index, connection] of due.entries()) {
    const entry = state.feeds[connection.id];
    const feed = fetched[index];
    result.checked += 1;
    if (feed.status === 'rejected') {
      entry.feedRetryAt = clock() + FEED_RETRY_MS;
      dirty = true;
      result.failed += 1;
      continue;
    }
    if (entry.feedRetryAt !== undefined) { delete entry.feedRetryAt; dirty = true; }
    const text = feed.value;
    const fingerprint = feedFingerprint(text);

    if (entry.imported !== fingerprint && !mayImport) {
      // Left unrecorded: imported by the first tick the budget allows, or by the half-hourly import.
      result.changed += 1;
      result.deferred += 1;
    } else if (entry.imported !== fingerprint && clock() <= deps.deadline) {
      result.changed += 1;
      importedThisTick = true;
      try {
        const imported = await deps.importFeed(connection.id, { url: connection.inboundUrl, text });
        // Another import holds the lease (the half-hourly one): try again next tick.
        if (!imported.some((run) => run.skipped)) { entry.imported = fingerprint; dirty = true; }
        result.imported += imported.filter((run) => run.ok && !run.skipped).length;
        result.failed += imported.filter((run) => !run.ok).length;
      } catch (error) {
        console.error('Fresha watch: import failed:', { connectionId: connection.id, error: error instanceof Error ? error.name : 'unknown' });
        entry.imported = fingerprint;
        dirty = true;
        result.failed += 1;
      }
    }

    if (!deps.mirror || entry.mirrored === fingerprint || (entry.mirrorRetryAt ?? 0) > clock() || clock() > deps.deadline) continue;
    const now = new Date(clock());
    const windowEnd = new Date(now.getTime() + CALENDAR_WINDOW_DAYS * 86_400_000);
    let intervals;
    try {
      intervals = parseCalendarBusyIntervals(text, { now, windowEnd });
    } catch (error) {
      // An unreadable feed is the import's lastError to report; the mirror keeps the last good copy.
      if (!(error instanceof CalendarFeedError)) throw error;
      entry.mirrored = fingerprint;
      dirty = true;
      continue;
    }
    try {
      const mirrored = await reconcileFreshaMirror({
        gateway: deps.mirror, connection: { id: connection.id, stylistName: connection.stylistName, googleColorId: connection.googleColorId },
        intervals, locale: snapshot.locale, now, windowEnd, deadline: deps.deadline, clock,
      });
      // Cut off by the deadline: the rest is written next tick (the ids are stable).
      if (mirrored.complete) { entry.mirrored = fingerprint; delete entry.mirrorRetryAt; dirty = true; }
      result.mirrored += 1;
    } catch (error) {
      const kind = error instanceof GoogleCalendarError ? error.kind : 'unknown';
      console.error('Fresha watch: Google mirror failed:', { connectionId: connection.id, kind });
      // A Google hiccup is retried next tick; a refusal (the calendar not shared) only every half hour.
      if (kind !== 'retryable') { entry.mirrorRetryAt = clock() + MIRROR_RETRY_MS; dirty = true; }
      result.failed += 1;
    }
  }

  if (importedThisTick) { state.importTicks.push(started); dirty = true; }
  if (result.deferred) console.error('Fresha watch: hourly import budget spent; changes left to the next allowed tick:', { deferred: result.deferred });
  if (dirty) {
    try {
      await deps.store.write(state);
    } catch (error) {
      // The next tick imports the same change again: one more wake, nothing lost.
      console.error('Fresha watch: state not saved:', error instanceof Error ? error.name : 'unknown');
    }
  }
  return result;
}
