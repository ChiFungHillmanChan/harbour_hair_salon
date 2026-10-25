import 'server-only';
import { revalidateTag, unstable_cache, updateTag } from 'next/cache';
import { after } from 'next/server';
import { googleCalendarConfig } from '@/app/lib/google-calendar-config';
import { describeFault } from '@/app/lib/fault';
import {
  loadBusyEvents,
  loadStylistToken,
  renderIcalFeed,
  tokenMatches,
  type BusyEvent,
  type IcalFeedResult,
} from './stylist-ical-feed';

/**
 * Why the outbound busy feed is cached at all.
 *
 * `/api/ical/[stylistId]` is a PUBLIC endpoint that marketplaces poll on their
 * own schedule, and production logs on 2026-09-16 showed the real cadence:
 * three stylist feeds fetched TWICE EACH, exactly every five minutes, around
 * the clock — Fresha and Treatwell both subscribe to the same URL. Uncached
 * that was twelve database queries every five minutes forever.
 *
 * Neon bills compute time and suspends its endpoint after five minutes idle, so
 * a five-minute poll sits exactly on the suspend threshold and pins the compute
 * awake 24/7 — roughly the entire monthly CU-hour allowance spent on a feed
 * that changes a handful of times a day. This is the same failure that the
 * five-minute Treatwell cron caused in August 2026 (see CLAUDE.md), arriving
 * through a different door: the rules there police `vercel.json`, and nobody
 * was guarding a public route that external systems poll.
 *
 * So the database is read at most once per window per stylist no matter how
 * many times the feed is fetched, and `invalidateStylistIcalFeed()` drops the
 * entry the moment an appointment actually changes. Freshness therefore comes
 * from invalidation, not from polling; the window below is only a safety net
 * for a mutation path that forgets to call it (or a direct SQL edit).
 *
 * Keep that safety net LONG. Neon's operations log for 2026-09-18..21 showed
 * the old 30-minute window was the single largest Neon cost: with polls every
 * 5-15 minutes around the clock, every expiry turned the next poll into a
 * database wake — ~45 wakes and ~1.7 CU-hours a day, about half the free
 * plan's 100 CU-hours a month, while the feed itself changed a few times a day.
 * `renderIcalFeed` drops ended events on every request and `loadBusyEvents`
 * has no forward limit, so a day-old entry is still correct.
 *
 * The token and the appointments are cached SEPARATELY on purpose. A caller
 * with a wrong token is answered from the token cache alone and never reaches
 * the appointment entry — preserving the property (asserted in
 * stylist-ical-feed.test.ts) that a failed auth never scans the Appointment
 * table, at the cache layer as well as the database layer.
 *
 * The cached events are the stylist's non-cancelled appointments AND the
 * Google-only busy time (`ExternalBusyBlock` source GOOGLE: events the staff
 * add on the salon's Google Calendar), so Fresha stops selling an hour the
 * salon has blocked there. That time reaches this entry by the Google pull
 * (services/google-calendar-pull.ts), which has no Server Action around it and
 * so drops the tag itself, with `invalidateStylistIcalFeedFromCron()`, only
 * when the blocks it stored actually changed (an unchanged pull wakes no poller).
 * The timed expiry below stays a day for the same reason as before: both
 * kinds of change invalidate the tag.
 */
const EVENTS_TAG = 'stylist-ical-feed';
const TOKEN_TAG = 'stylist-ical-token';

/** Safety net only; every appointment mutation invalidates this immediately. */
export const EVENTS_REVALIDATE_SECONDS = 24 * 60 * 60;
/**
 * Tokens change only in `generateStylistIcalFeedTokenAction` (Admin →
 * Integrations → rotate), which invalidates the tag immediately; deleting a
 * stylist does too. The week-long timer is only so that an unsupported direct
 * SQL edit of `icalToken` still heals — at most one wake per stylist a week.
 */
export const TOKEN_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;

const readToken = unstable_cache(
  async (stylistId: string): Promise<string | null> => loadStylistToken(stylistId),
  ['stylist-ical-token'],
  { revalidate: TOKEN_REVALIDATE_SECONDS, tags: [TOKEN_TAG] },
);

const readBusyEvents = unstable_cache(
  // `now` is deliberately NOT a parameter: it would make every request a unique
  // cache key and defeat the whole point. The lookback only widens while an
  // entry lives (never narrows), and `renderIcalFeed` re-applies the exact
  // "already ended" cut per request, so the drift is immaterial.
  async (stylistId: string): Promise<BusyEvent[]> => loadBusyEvents(stylistId, new Date()),
  ['stylist-ical-events'],
  { revalidate: EVENTS_REVALIDATE_SECONDS, tags: [EVENTS_TAG] },
);

/** Cache-backed equivalent of `buildStylistIcalFeed`, used by the live route. */
export async function buildCachedStylistIcalFeed(
  stylistId: string,
  token: string,
  now = new Date(),
): Promise<IcalFeedResult> {
  // tokenMatches refuses an empty token anyway; refusing it first keeps a
  // tokenless probe with a made-up stylist id (a fresh cache key each time)
  // from waking the database (review 2026-10-25).
  if (!token) return { status: 404 };
  const stored = await readToken(stylistId);
  if (!tokenMatches(token, stored)) return { status: 404 };
  return { status: 200, body: renderIcalFeed(await readBusyEvents(stylistId), now) };
}

/**
 * Drop the cached busy feeds. Call from a server action AFTER the transaction
 * that changed an appointment has committed, so the marketplaces see the new
 * busy period on their next poll instead of up to a day later. Every booking
 * mutation already calls this, so it also schedules the Google Calendar push
 * (scheduleGoogleCalendarPush) for after the response.
 */
export function invalidateStylistIcalFeed(): void {
  // `updateTag`, not `revalidateTag`: in Next 16 the latter takes a cacheLife
  // profile and schedules expiry, while this must drop the entry NOW — a stale
  // busy feed is exactly how a marketplace double-books the chair. Every caller
  // is a 'use server' action, which is where updateTag is valid.
  updateTag(EVENTS_TAG);
  scheduleGoogleCalendarPush();
}

/**
 * The same immediate drop for appointment changes made by a cron job. Those
 * run in a Route Handler, where `updateTag` throws ("can only be called from
 * within a Server Action"); `revalidateTag` with `{ expire: 0 }` never serves
 * the stale copy either, so the next marketplace poll reads the database.
 *
 * It never pushes to Google Calendar: the Google pull calls it after storing
 * busy time, and a push from there would bring another Google notification,
 * another pull and another push without end. Cron-side booking changes (lapses,
 * late cancellations) reach Google with the next calendar-sync run's push,
 * which looks back 45 minutes (longer than its half-hourly cadence) — when
 * that run is open. calendar-sync skips its ticks outside staff hours, so a
 * change made then waits for the next open tick (if it is still within those
 * 45 minutes) or for housekeeping's daily 03:15 UTC run, which re-renders the
 * whole window. No timing is guaranteed beyond that.
 */
export function invalidateStylistIcalFeedFromCron(): void {
  revalidateTag(EVENTS_TAG, { expire: 0 });
}

/**
 * Writes the website's bookings to the salon's Google Calendar after the
 * response (services/google-calendar-push.ts; spec §5 "Real time"). Without
 * ids: every booking changed in the last 45 minutes, never synced, failing (a
 * booking before the 7-day window only for its first five attempts) or marked
 * for re-rendering. With ids: exactly those bookings, even past the
 * 7-day window (erasure re-renders the anonymised name). Call it after the
 * commit, from a Server Action, for a change that alters only the event's
 * text (a reschedule request, a deposit's state); a change of time or status
 * calls invalidateStylistIcalFeed, which already schedules it.
 *
 * Nothing is scheduled or imported while the sync is off. A failure never
 * reaches the action: the push records its own per-booking failures, the
 * calendar-sync cron retries them, and housekeeping's daily reconcile
 * re-renders the whole window.
 */
export function scheduleGoogleCalendarPush(appointmentIds?: string[]): void {
  // The configuration check comes first: a disabled sync adds no work to the action.
  if (!googleCalendarConfig()) return;
  if (appointmentIds && appointmentIds.length === 0) return;
  const input = appointmentIds ? { appointmentIds: [...appointmentIds] } : { mode: 'recent' as const };
  try {
    after(async () => {
      try {
        // Imported here, after the response: the action itself never loads the push.
        const { pushGoogleCalendar } = await import('./google-calendar-push');
        await pushGoogleCalendar(input);
      } catch (error) {
        console.error('Google Calendar push after a booking change failed', describeFault(error));
      }
    });
  } catch (error) {
    // Outside a request (a script) `after` throws: the next calendar-sync run pushes instead.
    console.error('Google Calendar push could not be scheduled', describeFault(error));
  }
}

/** Call when a stylist's outbound feed secret is regenerated or cleared. */
export function invalidateStylistIcalToken(): void {
  updateTag(TOKEN_TAG);
}
