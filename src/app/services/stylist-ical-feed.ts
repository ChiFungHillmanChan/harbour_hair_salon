import type { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';

export type IcalFeedResult = { status: 200; body: string } | { status: 404 };

/**
 * One busy period, in a shape that survives a JSON round-trip through the Next
 * Data Cache unchanged (no `Date`, no `Decimal`). `stylist-ical-cache.ts` caches
 * arrays of these, so adding a non-primitive field here would silently corrupt
 * the cached copy.
 */
export type BusyEvent = { id: string; startMs: number; minutes: number };

/**
 * Which subscriber the feed is for. `standard` is the URL Fresha (and anything
 * else) holds; `treatwell` is the same URL with `&for=treatwell`, which also
 * carries Fresha's busy time (loadFreshaBusyEvents). Anything else is standard.
 */
export type FeedView = 'standard' | 'treatwell';

export function feedViewFromParam(value: string | null | undefined): FeedView {
  return value === 'treatwell' ? 'treatwell' : 'standard';
}

type Deps = {
  db?: PrismaClient;
  now?: Date;
  view?: FeedView;
};

// Query cut-off margin: appointments that STARTED up to this long ago may still
// be in progress, so they must stay in the feed until their end passes.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

function safeCompare(a: string, b: string): boolean {
  // Compare BYTE lengths, not `String.length` (UTF-16 code units): a multibyte
  // char can share code-unit length while differing in UTF-8 byte length, which
  // makes timingSafeEqual throw. Compute the buffers once and length-check them.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function toIcsUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

async function resolveDb(db?: PrismaClient): Promise<PrismaClient> {
  // Lazy-load the real Prisma client only when no db is injected, so unit
  // tests (which pass a fake db) never trigger prisma.ts's eager DB-URL
  // resolution.
  return db ?? (await import('@/app/lib/prisma')).default;
}

/** The stylist's outbound feed secret, or null when absent/unknown. */
export async function loadStylistToken(stylistId: string, db?: PrismaClient): Promise<string | null> {
  const client = await resolveDb(db);
  const stylist = await client.stylist.findUnique({
    where: { id: stylistId },
    select: { icalToken: true },
  });
  return stylist?.icalToken ?? null;
}

/**
 * Everything that may still occupy the chair, earliest first.
 *
 * Appointments: every booking except a cancelled one, exactly the rule the
 * website's own availability uses (booking-service.ts). A COMPLETED booking
 * counts until its end has passed — staff can mark a visit completed while it
 * is still running, and dropping it here would let a marketplace resell the
 * rest of that time.
 *
 * Google-only time: events the salon put in its Google calendar by hand
 * (`ExternalBusyBlock.source = 'GOOGLE'`) are exported too, so Fresha stops
 * selling that time. FRESHA and TREATWELL blocks are NEVER exported: Fresha
 * does not re-export what it imported (verified 2026-09-29), but sending its
 * own time back to it would still loop. The `source` filter below is that rule.
 */
export async function loadBusyEvents(stylistId: string, now: Date, db?: PrismaClient): Promise<BusyEvent[]> {
  const client = await resolveDb(db);
  const appointments = await client.appointment.findMany({
    where: {
      stylistId,
      status: { not: 'CANCELLED' },
      date: { gte: new Date(now.getTime() - LOOKBACK_MS) },
    },
    select: { id: true, date: true, durationAtBooking: true, service: { select: { duration: true } } },
    orderBy: { date: 'asc' },
  });
  const googleBlocks = await client.externalBusyBlock.findMany({
    where: { stylistId, source: 'GOOGLE', end: { gt: now } },
    select: { externalUid: true, start: true, end: true },
  });
  const events: BusyEvent[] = [
    ...appointments.map((appt) => ({
      id: appt.id,
      startMs: new Date(appt.date).getTime(),
      minutes: appt.durationAtBooking ?? appt.service.duration,
    })),
    // `externalUid` is a hash of the Google event, so the UID is stable across pulls.
    ...googleBlocks.map((block) => ({
      id: `g-${block.externalUid}`,
      startMs: new Date(block.start).getTime(),
      minutes: (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000,
    })),
  ];
  return events.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Fresha's busy time for one stylist (its bookings and blocked time, as the
 * website imported them), for the Treatwell view of the feed only.
 *
 * Treatwell imports this feed and nothing else, so before 2026-11-03 a Fresha
 * booking never reached Treatwell, which could sell the same hour (found on
 * 2026-11-03; owner chose this fix the same day). Treatwell has no export feed
 * and imports nothing back from here, so forwarding Fresha's time to it cannot
 * loop. Fresha's own URL (the standard view) still never carries these:
 * loadBusyEvents above is unchanged. TREATWELL blocks are not sent anywhere.
 */
export async function loadFreshaBusyEvents(stylistId: string, now: Date, db?: PrismaClient): Promise<BusyEvent[]> {
  const client = await resolveDb(db);
  const blocks = await client.externalBusyBlock.findMany({
    where: { stylistId, source: 'FRESHA', end: { gt: now } },
    select: { externalUid: true, start: true, end: true },
  });
  return blocks.map((block) => ({
    // `externalUid` is a hash of Fresha's UID, so the UID is stable across imports.
    id: `f-${block.externalUid}`,
    startMs: new Date(block.start).getTime(),
    minutes: (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60_000,
  }));
}

/** Both lists in start order, as `renderIcalFeed` expects. */
export function mergeBusyEvents(...lists: BusyEvent[][]): BusyEvent[] {
  return lists.flat().sort((a, b) => a.startMs - b.startMs);
}

/**
 * Render the busy feed. Pure, and deliberately re-evaluated per request even
 * when the events came from cache: `DTSTAMP` and the "already ended" filter
 * both depend on the current time, so freezing them alongside the rows would
 * keep stale events in the feed for the life of the cache entry.
 */
export function renderIcalFeed(events: BusyEvent[], now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbour Hair Salon//Busy Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    const start = new Date(event.startMs);
    const end = new Date(event.startMs + event.minutes * 60_000);
    if (end <= now) continue; // fully in the past — no longer blocks anything
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@harbourhair.co.uk`,
      `DTSTAMP:${toIcsUtc(now)}`,
      `DTSTART:${toIcsUtc(start)}`,
      `DTEND:${toIcsUtc(end)}`,
      'SUMMARY:Busy',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Uniform 404 unless the supplied token matches the stored one byte for byte. */
export function tokenMatches(supplied: string, stored: string | null): boolean {
  return Boolean(stored) && Boolean(supplied) && safeCompare(supplied, stored as string);
}

/**
 * Build the busy-times iCal feed Treatwell Connect / Fresha subscribe to for one
 * stylist ("External Calendar" per employee). Emits only start/end + a fixed
 * "Busy" summary — never customer PII. Any auth problem (unknown stylist, no
 * token configured, mismatch) is a uniform 404 so the route leaks nothing.
 *
 * Reads straight through to the database. The live route uses the cached
 * wrapper in `stylist-ical-cache.ts` instead — see that file for why.
 */
export async function buildStylistIcalFeed(
  stylistId: string,
  token: string,
  deps: Deps = {},
): Promise<IcalFeedResult> {
  const db = await resolveDb(deps.db);
  const now = deps.now ?? new Date();

  const stored = await loadStylistToken(stylistId, db);
  // Deliberately before the appointment query: an unauthenticated caller must
  // never be able to make this endpoint scan the Appointment table.
  if (!tokenMatches(token, stored)) return { status: 404 };

  const events = await loadBusyEvents(stylistId, now, db);
  const fresha = deps.view === 'treatwell' ? await loadFreshaBusyEvents(stylistId, now, db) : [];
  return { status: 200, body: renderIcalFeed(mergeBusyEvents(events, fresha), now) };
}
