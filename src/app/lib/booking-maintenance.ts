import 'server-only';
import { getSiteSettings } from '@/app/services/site-settings-service';

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

/** True when customers may create or move bookings online. */
export async function isBookingEnabled(): Promise<boolean> {
  const settings = await getSiteSettings();
  return settings.bookingEnabled;
}
