import type { Prisma } from '@prisma/client';
import { BookingError } from '../booking-errors';
import { buildQuote, QuoteIntegrityError, type PriceQuote } from './quote';

/** Everything a quote, the booking gates and the Treatwell sync read from a Service. */
export const quotableServiceSelect = {
  id: true,
  name: true,
  price: true,
  duration: true,
  offeringId: true,
  hairLength: true,
  priceType: true,
  priceVersion: true,
  vatDisplay: true,
  priceNature: true,
  durationConfirmed: true,
  surchargeBaseServiceId: true,
  surchargeAmount: true,
  priceSource: true,
  isPublic: true,
  isBookable: true,
  requiresPatchTest: true,
  requiresConsultation: true,
  isConsultation: true,
  isPatchTest: true,
  treatwellExternalId: true,
} satisfies Prisma.ServiceSelect;

export type QuotableServiceRow = Prisma.ServiceGetPayload<{ select: typeof quotableServiceSelect }>;

type ServiceReader = Pick<Prisma.TransactionClient, 'service'>;

/**
 * The one entry point for pricing a NEW booking — customer (named stylist or
 * "anyone"), admin-entered, or an admin changing an appointment's service.
 *
 * - Refuses services closed to new bookings (retired/unverified options), even
 *   when a stale page or a crafted request sends the id directly.
 * - Customers may only book options that are also public.
 * - Never applies an offer or discount code (DISCOUNTS_PAUSED).
 * - A price-list inconsistency (composite ≠ base + surcharge) refuses the
 *   booking instead of charging a guessed amount.
 */
export async function quoteForNewBooking(
  db: ServiceReader,
  serviceId: string,
  channel: 'CUSTOMER' | 'ADMIN',
): Promise<{ service: QuotableServiceRow; quote: PriceQuote }> {
  const service = await db.service.findUnique({ where: { id: serviceId }, select: quotableServiceSelect });
  if (!service) throw new BookingError('SERVICE_NOT_FOUND');
  if (!service.isBookable || (channel === 'CUSTOMER' && !service.isPublic)) throw new BookingError('SERVICE_NOT_BOOKABLE');
  const base = service.surchargeBaseServiceId
    ? await db.service.findUnique({ where: { id: service.surchargeBaseServiceId }, select: { id: true, price: true } })
    : null;
  try {
    return { service, quote: buildQuote(service, base) };
  } catch (error) {
    if (error instanceof QuoteIntegrityError) {
      console.error('Refusing to quote an inconsistent price', { serviceId });
      throw new BookingError('PRICE_UNAVAILABLE');
    }
    throw error;
  }
}
