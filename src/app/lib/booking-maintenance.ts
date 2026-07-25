// TEMPORARY online-booking kill-switch (added 2026-07-25).
//
// While this flag is true:
//   - /book renders a maintenance notice pointing customers to Treatwell
//     (middleware also lets the page through without sign-in so everyone sees it)
//   - submitBooking / rescheduleAppointment refuse server-side, so the block
//     cannot be bypassed by calling the actions directly
//   - slot-fetching actions return nothing
//
// Flip to `false` and redeploy to restore online booking. Cancellation is
// deliberately NOT blocked — customers may still cancel existing appointments.
//
// Kept dependency-free so middleware (edge) can import it safely.

export const BOOKING_MAINTENANCE: boolean = true;

export const TREATWELL_BOOKING_URL =
  'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/';

export const BOOKING_MAINTENANCE_MESSAGE =
  'Our online booking is temporarily under maintenance. Please book via Treatwell instead — thank you, and sorry for any inconvenience.';
