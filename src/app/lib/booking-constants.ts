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
