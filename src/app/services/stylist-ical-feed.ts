import type { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';

export type IcalFeedResult = { status: 200; body: string } | { status: 404 };

type Deps = {
  db?: PrismaClient;
  now?: Date;
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

/**
 * Build the busy-times iCal feed Treatwell Connect subscribes to for one
 * stylist ("External Calendar" per employee). Emits only start/end + a fixed
 * "Busy" summary — never customer PII. Any auth problem (unknown stylist, no
 * token configured, mismatch) is a uniform 404 so the route leaks nothing.
 */
export async function buildStylistIcalFeed(
  stylistId: string,
  token: string,
  deps: Deps = {},
): Promise<IcalFeedResult> {
  // Lazy-load the real Prisma client only when no db is injected, so unit
  // tests (which pass a fake db) never trigger prisma.ts's eager DB-URL
  // resolution.
  const db = deps.db ?? (await import('@/app/lib/prisma')).default;
  const now = deps.now ?? new Date();

  const stylist = await db.stylist.findUnique({
    where: { id: stylistId },
    select: { icalToken: true },
  });
  if (!stylist?.icalToken || !token || !safeCompare(token, stylist.icalToken)) {
    return { status: 404 };
  }

  const appointments = await db.appointment.findMany({
    where: {
      stylistId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      date: { gte: new Date(now.getTime() - LOOKBACK_MS) },
    },
    select: { id: true, date: true, durationAtBooking: true, service: { select: { duration: true } } },
    orderBy: { date: 'asc' },
  });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harbour Hair Salon//Busy Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const appt of appointments) {
    const start = new Date(appt.date);
    const end = new Date(start.getTime() + (appt.durationAtBooking ?? appt.service.duration) * 60_000);
    if (end <= now) continue; // fully in the past — no longer blocks anything
    lines.push(
      'BEGIN:VEVENT',
      `UID:${appt.id}@harbourhair.co.uk`,
      `DTSTAMP:${toIcsUtc(now)}`,
      `DTSTART:${toIcsUtc(start)}`,
      `DTEND:${toIcsUtc(end)}`,
      'SUMMARY:Busy',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return { status: 200, body: lines.join('\r\n') + '\r\n' };
}
