import 'server-only';
import { unstable_cache } from 'next/cache';
import type { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { checkCalendarBookingReadiness } from '@/app/services/integration-readiness';
import { BookingError } from '@/app/services/booking-errors';
import { checkOperationsRuntimeReadiness } from '@/app/services/operations-readiness';
import { isOnlineBookingLockedForPayments } from '@/app/lib/online-booking-lock';

// Online-booking master switch.
//
// This used to be a hardcoded `BOOKING_MAINTENANCE = true` constant that had to
// be edited and redeployed to open or close bookings. It is now the
// `SiteSettings.bookingEnabled` column, toggled from Admin -> Settings.
//
// The stored value defaults to FALSE (closed), and getSiteSettings() also falls
// back to `bookingEnabled: false` if the settings row cannot be read — so every
// failure mode lands on "booking closed" rather than accidentally opening a
// flow that could double-book against Treatwell.
//
// While booking is closed:
//   - /book renders a maintenance notice pointing customers to the salon phone,
//     plus a link per marketplace the salon currently advertises (none of which
//     is hardcoded — see marketplace-channels.ts), and is viewable without
//     signing in
//   - submitBooking / requestReschedule refuse server-side, so the block
//     cannot be bypassed by calling the actions directly
//   - slot-fetching actions return nothing
//   - the Reschedule button in My Bookings is disabled
//
// Cancellation is deliberately NOT blocked — customers may always cancel an
// existing appointment.

// Returned by submitBooking / requestReschedule, which have no business
// knowing which marketplaces are live — that is settings data, and naming one
// here is exactly what made the Treatwell link impossible to switch off.
export const BOOKING_MAINTENANCE_MESSAGE =
  'Online booking is closed at the moment. Please call the salon to book — thank you, and sorry for any inconvenience.';

/** Read the switch and calendar state without the public settings cache. */
export async function assertOnlineBookingReady(db: Prisma.TransactionClient) {
  // Production stays closed until Square deposits are wired, whatever the
  // switch or the database says (lib/online-booking-lock.ts).
  if (isOnlineBookingLockedForPayments()) throw new BookingError('MAINTENANCE');
  // A closed deployment must not wake Neon just to confirm booking is closed.
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') throw new BookingError('MAINTENANCE');
  const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { bookingEnabled: true, phone: true } });
  if (!settings?.bookingEnabled) throw new BookingError('MAINTENANCE');
  const readiness = await checkCalendarBookingReadiness(db);
  if (!readiness.ready) throw new BookingError('MAINTENANCE');
  const operations = await checkOperationsRuntimeReadiness(db);
  if (!operations.ready) throw new BookingError('MAINTENANCE');
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') {
    const activeChannels = await db.calendarConnection.count({ where: { receivesBookings: true } });
    if (activeChannels) throw new BookingError('MAINTENANCE');
  }
  return settings;
}

/**
 * Cheap, cached answer to "is booking open?", for rendering decisions only.
 *
 * `assertOnlineBookingReady` is deliberately uncached — it reads SiteSettings
 * directly, then the calendar coverage (a `stylist.findMany` with two nested
 * relations) and the operations report. That is the right cost to pay when a
 * booking is actually being written, but it is the wrong cost to pay to decide
 * what a PAGE should look like.
 *
 * /book is `force-dynamic` (it has to be — whether booking is open is per-request
 * state), it is linked from every page's footer and the sticky mobile bar, and
 * `robots.txt` stops only well-behaved crawlers. Uncached, every one of those
 * hits was three or four queries against Neon — and once booking opens, an
 * ANONYMOUS visitor pays all of them before being redirected to sign in, because
 * the gate has to run first to know whether to show the sign-in redirect or the
 * marketplace/phone page. Neon bills compute time and suspends after five idle
 * minutes, so a steady trickle of /book hits is exactly the "public endpoint
 * something external polls" cost vector CLAUDE.md warns about.
 *
 * Sixty seconds, tagged `site-settings` so Admin -> Settings invalidates it the
 * instant the salon flips the switch. The staleness is bounded and safe: the
 * authoritative check still runs uncached inside the booking transaction, so a
 * booking can never be WRITTEN against a stale reading — at worst a customer
 * sees the form for up to a minute after booking closed and is refused on submit.
 */
const readBookingOpen = unstable_cache(
  async (): Promise<boolean> => {
    // Only a real "closed" answer is cached. A Neon cold-start or pool error is
    // rethrown, so a failed revalidation keeps serving the last good answer
    // instead of closing booking for everyone (CLAUDE.md: never cache a fallback).
    try { await assertOnlineBookingReady(prisma); return true; }
    catch (error) {
      if (error instanceof BookingError) return false;
      throw error;
    }
  },
  ['booking-open'],
  { revalidate: 60, tags: ['site-settings'] },
);

/** Configuration failures close the public booking flow; cancellation remains available. */
export async function isBookingEnabled(): Promise<boolean> {
  // Check before cache hits too: an earlier deployment may have cached `true`.
  if (isOnlineBookingLockedForPayments()) return false;
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') return false;
  try {
    return await readBookingOpen();
  } catch (error) {
    // Fail closed for this request only; nothing is cached.
    console.error('Failed to read booking availability:', error);
    return false;
  }
}
