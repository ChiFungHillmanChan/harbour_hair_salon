/**
 * Sentinel stylist id for the "Anyone / first available" booking option.
 * Lives in a client-safe module so both the wizard and the server actions can
 * import it without pulling in Prisma.
 */
export const ANY_STYLIST_ID = 'any';

/**
 * Days the booking page's date strip shows, and the most `fetchBookingDays`
 * will compute in one request. Here, not in the action file: a 'use server'
 * module may export only async functions (`next build` refuses anything else).
 */
export const BOOKING_DAYS_MAX = 14;

/**
 * The least notice, in minutes, an ONLINE request needs. Online requests wait
 * for a member of staff to approve them, so a time sooner than this could not
 * be confirmed before the customer is due: the booking page shows such times
 * as unavailable and submitBooking refuses them. Bookings staff enter in Admin
 * are not restricted.
 *
 * 120 (two hours) is the salon's default. To change it, change this number and
 * redeploy: the booking page, the server check and the customer's message
 * ("at least N hours' notice") all read it. Whole hours read best.
 */
export const MIN_BOOKING_NOTICE_MINUTES = 120;

/**
 * Until how many hours before its start a customer can cancel a CONFIRMED
 * booking online (cancelAppointment); after that they call the salon. Whether
 * a card deposit is refunded is a separate rule: DEPOSIT_REFUND_NOTICE_HOURS.
 * The booking page warns when a requested time is already inside this window.
 */
export const ONLINE_CANCEL_NOTICE_HOURS = 24;

/**
 * Owner decision 2026-10-18: a customer who cancels a CONFIRMED booking at
 * least this many hours before its start gets the card deposit back in full;
 * cancelling later keeps it (as a missed appointment does). Between this and
 * ONLINE_CANCEL_NOTICE_HOURS the customer may still cancel online, and My
 * Bookings says before they confirm that the deposit is kept. The booking
 * page, the booking terms, the confirmation email and the admin dialog's help
 * all read this number; change it and the wording follows. Exactly this many
 * hours ahead still counts as in time (isDepositRefundableOnCancel).
 */
export const DEPOSIT_REFUND_NOTICE_HOURS = 48;

/**
 * True when `start` gives at least `minutes` of notice from `now`. Compared
 * as absolute instants, so a clock change in between neither shortens nor
 * stretches the notice.
 */
export function meetsMinimumNotice(start: Date, now: Date = new Date(), minutes: number = MIN_BOOKING_NOTICE_MINUTES): boolean {
  return start.getTime() - now.getTime() >= minutes * 60_000;
}

/**
 * Whether a customer cancelling a confirmed booking that starts at `start`,
 * at `now`, gets its deposit refunded (DEPOSIT_REFUND_NOTICE_HOURS or more
 * ahead) or not (less: it is kept). Absolute instants, like meetsMinimumNotice.
 * `depositLockedAt` (Appointment.depositLockedAt, owner decision 2026-10-18):
 * the booking was moved at the customer's request made inside that window, so
 * the deposit stays kept whatever the new time.
 */
export function isDepositRefundableOnCancel(start: Date, now: Date = new Date(), depositLockedAt: Date | null = null): boolean {
  return depositLockedAt === null && meetsMinimumNotice(start, now, DEPOSIT_REFUND_NOTICE_HOURS * 60);
}

/**
 * Late arrivals (docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md).
 * A CONFIRMED booking whose customer is not marked arrived this many minutes
 * after its start is cancelled by the calendar-sync cron while Admin →
 * Settings has the rule switched on. The booking terms and emails read it.
 */
export const LATE_ARRIVAL_CANCEL_MINUTES = 15;
/** Bookings that started longer ago than this are left for staff, never cancelled late (a missed cron tick). */
export const LATE_ARRIVAL_LOOKBACK_MINUTES = 120;
/** The late-cancel email waits this long, so a restore made meanwhile drops it unsent. */
export const LATE_CANCEL_EMAIL_DELAY_MINUTES = 30;
/** How long after the automatic cancellation staff may restore the booking. */
export const LATE_CANCEL_RESTORE_HOURS = 24;
/** "Arrived" can be recorded from this many minutes before the start. */
export const ARRIVAL_EARLY_MINUTES = 60;

/**
 * Consultation credit (docs/superpowers/specs/2026-10-16-consultation-credit-pricing-ux-design.md §2):
 * a consultation's fee is taken off a consultation-required treatment booked
 * within this many salon-local calendar months of it (services/consultation-credit.ts).
 * The booking terms and the consultation's emails read it.
 */
export const CONSULTATION_CREDIT_MONTHS = 6;

/**
 * Beta booking (lib/booking-beta.ts): the most accounts Admin → Settings may
 * list as beta testers. A handful of trusted accounts, not a second launch.
 */
export const BOOKING_BETA_MAX_TESTERS = 20;

/**
 * Owner decision 2026-10-18 ("short version" of the customer emails): the
 * REMINDER goes only to a booking confirmed at least this many hours before
 * its start. One confirmed later has only just had its confirmation email.
 */
export const REMINDER_MIN_CONFIRMED_AHEAD_HOURS = 24;

/**
 * Whether a booking starting at `start` gets a reminder, given when it was
 * confirmed (null: not known — the reminder goes, as before the rule).
 */
export function isReminderWanted(start: Date, confirmedAt: Date | null): boolean {
  return confirmedAt === null || meetsMinimumNotice(start, confirmedAt, REMINDER_MIN_CONFIRMED_AHEAD_HOURS * 60);
}
