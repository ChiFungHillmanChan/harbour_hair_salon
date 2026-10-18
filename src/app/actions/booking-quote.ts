'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import prisma from '@/app/lib/prisma';
import { isBetaBookingOpenFor, isBookingEnabled } from '@/app/lib/booking-maintenance';
import { getSession } from '@/app/lib/session';
import { availabilityLimiter } from '@/app/lib/rate-limit';
import { BookingError } from '@/app/services/booking-errors';
import { quoteDepositForNewBooking } from '@/app/services/deposit-quote';

/** What the booking wizard shows before any card form: the price, the deposit now, the rest in the salon. */
export type BookingQuotePreview =
  | { ok: true; amountPence: number; depositPence: number; remainderPence: number }
  | { ok: false };

// Same bound the booking actions put on ids sent by the browser.
const SERVICE_ID = z.string().trim().min(1).max(64);

/**
 * Price and deposit for one service, for display only: submitBooking works
 * both out again from current data and refuses if they changed. No sign-in is
 * needed, so it follows the public availability lookups (actions/booking.ts):
 * junk is refused before anything else, a closed booking page (or the
 * production payments lock) answers without touching the database, and every
 * call spends the same per-address availability budget. While booking is
 * closed, a signed-in caller may be a beta tester (lib/booking-maintenance.ts):
 * that check reads the database, so it runs only after the budget is spent.
 */
export async function previewBookingQuote(serviceId: string): Promise<BookingQuotePreview> {
  const id = SERVICE_ID.safeParse(serviceId);
  if (!id.success) return { ok: false };
  const publicOpen = await isBookingEnabled();
  // Cookie only: no query for a signed-out visitor while booking is closed.
  const betaUserId = publicOpen ? null : (await getSession())?.userId;
  if (!publicOpen && !betaUserId) return { ok: false };
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await availabilityLimiter.check(ip))) return { ok: false };
  if (!publicOpen && !(await isBetaBookingOpenFor(betaUserId))) return { ok: false };

  try {
    const { quote, deposit } = await quoteDepositForNewBooking(prisma, id.data);
    return { ok: true, amountPence: quote.amountPence, depositPence: deposit.depositPence, remainderPence: deposit.remainderPence };
  } catch (error) {
    // Unknown, retired or unlisted services are ordinary refusals; anything
    // else (database, an impossible deposit policy) is a fault worth a log line.
    if (!(error instanceof BookingError)) console.error('previewBookingQuote failed', { serviceId: id.data }, error);
    return { ok: false };
  }
}
