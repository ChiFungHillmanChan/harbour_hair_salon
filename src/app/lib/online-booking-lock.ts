/**
 * ONLINE BOOKING STAYS CLOSED IN PRODUCTION UNTIL SQUARE DEPOSITS ARE WIRED.
 *
 * Self-service booking is meant to take a deposit through Square (plan:
 * docs/superpowers/plans/2026-09-16-square-deposit-payments-cantonese.md).
 * Only the foundations exist — lib/square-config.ts, lib/square-webhook.ts,
 * services/square-gateway.ts and services/deposit-policy.ts — and NOTHING calls
 * them yet: submitBooking takes no payment, there is no webhook route, and the
 * CSP still blocks Square's SDK.
 *
 * So while this is false, production refuses to open online booking whatever
 * Admin → Settings or the database says: the gate in lib/booking-maintenance.ts
 * answers "closed" before it reads anything, and the settings screen will not
 * switch booking on. Customers keep booking by phone and on the marketplaces.
 *
 * Set this to true only in the change that takes the deposit in the booking
 * flow. Local, CI and preview runs are not locked, so the booking flow itself
 * stays testable (they are not VERCEL_ENV=production).
 */
export const SQUARE_DEPOSITS_WIRED = false;

/** Read at call time, never at module load (project convention). */
export function isOnlineBookingLockedForPayments(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return !SQUARE_DEPOSITS_WIRED && env.VERCEL_ENV === 'production';
}
