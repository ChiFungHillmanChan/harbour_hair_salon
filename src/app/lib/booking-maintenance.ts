import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/app/lib/prisma';
import { checkCalendarBookingReadiness } from '@/app/services/integration-readiness';
import { BookingError } from '@/app/services/booking-errors';
import { checkOperationsRuntimeReadiness } from '@/app/services/operations-readiness';

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
//   - submitBooking / rescheduleAppointment refuse server-side, so the block
//     cannot be bypassed by calling the actions directly
//   - slot-fetching actions return nothing
//   - the Reschedule button in My Bookings is disabled
//
// Cancellation is deliberately NOT blocked — customers may always cancel an
// existing appointment.

// Returned by submitBooking / rescheduleAppointment, which have no business
// knowing which marketplaces are live — that is settings data, and naming one
// here is exactly what made the Treatwell link impossible to switch off.
export const BOOKING_MAINTENANCE_MESSAGE =
  'Online booking is closed at the moment. Please call the salon to book — thank you, and sorry for any inconvenience.';

/** Read the switch and calendar state without the public settings cache. */
export async function assertOnlineBookingReady(db: Prisma.TransactionClient) {
  const settings = await db.siteSettings.findUnique({ where: { id: 'singleton' }, select: { bookingEnabled: true, phone: true } });
  if (!settings?.bookingEnabled || process.env.NOTIFICATIONS_ENABLED !== 'true') throw new BookingError(BOOKING_MAINTENANCE_MESSAGE);
  const readiness = await checkCalendarBookingReadiness(db);
  if (!readiness.ready) throw new BookingError(BOOKING_MAINTENANCE_MESSAGE);
  const operations = await checkOperationsRuntimeReadiness(db);
  if (!operations.ready) throw new BookingError(BOOKING_MAINTENANCE_MESSAGE);
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') {
    const activeChannels = await db.calendarConnection.count({ where: { receivesBookings: true } });
    if (activeChannels) throw new BookingError(BOOKING_MAINTENANCE_MESSAGE);
  }
  return settings;
}

/** Configuration failures close the public booking flow; cancellation remains available. */
export async function isBookingEnabled(): Promise<boolean> {
  try { await assertOnlineBookingReady(prisma); return true; }
  catch { return false; }
}
