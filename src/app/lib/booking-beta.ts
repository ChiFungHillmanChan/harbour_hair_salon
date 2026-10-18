import { z } from 'zod';
import { isPlaceholderEmail } from './walk-in-customer';
import { BOOKING_BETA_MAX_TESTERS } from './booking-constants';

/**
 * Beta booking's list of testers: `SiteSettings.bookingBetaEmails`, edited in
 * Admin → Settings. While online booking is closed to the public, a signed-in
 * account whose email is on this list still gets the full online booking flow
 * (lib/booking-maintenance.ts), and its booking emails are sent even while
 * NOTIFICATIONS_ENABLED is off (services/notification-outbox-service.ts).
 *
 * Pure and Prisma-free, so the gate, the outbox and the settings action share
 * one reading of the list. Stored normalised: lowercase, `", "`-joined.
 */

export { BOOKING_BETA_MAX_TESTERS };

/** Longest text the settings box accepts before it is even split (20 addresses of 254 characters fit). */
const MAX_RAW_LENGTH = 10_000;

/** One entry per address: commas, semicolons, spaces and line breaks all separate. */
const SEPARATORS = /[\s,;]+/;

/** The repository's email rule (actions/admin.ts, admin-schedule.ts). */
const TESTER_EMAIL = z.string().trim().toLowerCase().email().max(254);

/** The list as addresses: trimmed, lowercase, no blanks, each once, in the order typed. */
export function parseBookingBetaEmails(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const emails = new Set<string>();
  for (const entry of raw.split(SEPARATORS)) {
    const email = entry.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

/**
 * Whether `email` is on the list: an exact match once both are lowercase. A
 * missing address, or a walk-in/erased placeholder, never is.
 */
export function isBookingBetaTester(email: string | null | undefined, raw: string): boolean {
  if (typeof email !== 'string') return false;
  const address = email.trim().toLowerCase();
  if (!address || isPlaceholderEmail(address)) return false;
  return parseBookingBetaEmails(raw).includes(address);
}

/**
 * The settings box: any separators in, the stored form out (`", "`-joined
 * lowercase; blank clears the list). Refusals are message codes the settings
 * action translates, with the offending address as a parameter:
 *   - BETA_EMAIL: not a valid email address;
 *   - BETA_PLACEHOLDER: a walk-in or erased placeholder (it can never sign in or receive mail);
 *   - BETA_TOO_MANY: more than BOOKING_BETA_MAX_TESTERS addresses.
 */
export const bookingBetaEmailsSchema = z
  .string()
  .max(MAX_RAW_LENGTH, 'TOO_LONG')
  .transform((raw, ctx) => {
    const emails = parseBookingBetaEmails(raw);
    if (emails.length > BOOKING_BETA_MAX_TESTERS) {
      ctx.issues.push({ code: 'custom', message: 'BETA_TOO_MANY', params: { max: BOOKING_BETA_MAX_TESTERS }, input: raw });
      return z.NEVER;
    }
    for (const email of emails) {
      if (!TESTER_EMAIL.safeParse(email).success) {
        ctx.issues.push({ code: 'custom', message: 'BETA_EMAIL', params: { email }, input: raw });
        return z.NEVER;
      }
      if (isPlaceholderEmail(email)) {
        ctx.issues.push({ code: 'custom', message: 'BETA_PLACEHOLDER', params: { email }, input: raw });
        return z.NEVER;
      }
    }
    return emails.join(', ');
  });
