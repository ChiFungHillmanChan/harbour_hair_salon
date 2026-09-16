import 'server-only';
import { unstable_cache, updateTag } from 'next/cache';
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
 * for a mutation path that forgets to call it.
 *
 * The token and the appointments are cached SEPARATELY on purpose. A caller
 * with a wrong token is answered from the token cache alone and never reaches
 * the appointment entry — preserving the property (asserted in
 * stylist-ical-feed.test.ts) that a failed auth never scans the Appointment
 * table, at the cache layer as well as the database layer.
 */
const EVENTS_TAG = 'stylist-ical-feed';
const TOKEN_TAG = 'stylist-ical-token';

/** Safety net only; every appointment mutation invalidates this immediately. */
const EVENTS_REVALIDATE_SECONDS = 30 * 60;
/** Tokens change only when an admin regenerates one, which invalidates the tag. */
const TOKEN_REVALIDATE_SECONDS = 60 * 60;

const readToken = unstable_cache(
  async (stylistId: string): Promise<string | null> => loadStylistToken(stylistId),
  ['stylist-ical-token'],
  { revalidate: TOKEN_REVALIDATE_SECONDS, tags: [TOKEN_TAG] },
);

const readBusyEvents = unstable_cache(
  // `now` is deliberately NOT a parameter: it would make every request a unique
  // cache key and defeat the whole point. The lookback window is 24 hours and
  // the entry lives for 30 minutes, so the drift is immaterial — and
  // `renderIcalFeed` re-applies the exact "already ended" cut per request.
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
  const stored = await readToken(stylistId);
  if (!tokenMatches(token, stored)) return { status: 404 };
  return { status: 200, body: renderIcalFeed(await readBusyEvents(stylistId), now) };
}

/**
 * Drop the cached busy feeds. Call from a server action AFTER the transaction
 * that changed an appointment has committed, so the marketplaces see the new
 * busy period on their next poll instead of up to 30 minutes later.
 */
export function invalidateStylistIcalFeed(): void {
  // `updateTag`, not `revalidateTag`: in Next 16 the latter takes a cacheLife
  // profile and schedules expiry, while this must drop the entry NOW — a stale
  // busy feed is exactly how a marketplace double-books the chair. Every caller
  // is a 'use server' action, which is where updateTag is valid.
  updateTag(EVENTS_TAG);
}

/** Call when a stylist's outbound feed secret is regenerated or cleared. */
export function invalidateStylistIcalToken(): void {
  updateTag(TOKEN_TAG);
}
