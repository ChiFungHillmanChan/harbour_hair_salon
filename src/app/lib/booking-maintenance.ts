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
//   - /book renders a maintenance notice pointing customers to the salon phone
//     and Treatwell, and is viewable without signing in
//   - submitBooking / rescheduleAppointment refuse server-side, so the block
//     cannot be bypassed by calling the actions directly
//   - slot-fetching actions return nothing
//   - the Reschedule button in My Bookings is disabled
//
// Cancellation is deliberately NOT blocked — customers may always cancel an
// existing appointment.

export const TREATWELL_BOOKING_URL =
  'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/';

export const BOOKING_MAINTENANCE_MESSAGE =
  'Our online booking is temporarily under maintenance. Please book via Treatwell instead — thank you, and sorry for any inconvenience.';

/** True when customers may create or move bookings online. */
export async function isBookingEnabled(): Promise<boolean> {
  const settings = await getSiteSettings();
  return settings.bookingEnabled;
}
