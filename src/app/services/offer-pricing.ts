// Pure offer-pricing math, shared by the server (booking-service, computing the
// recorded/charged priceAtBooking) and the client BookingWizard (its price
// summary). Intentionally NOT `server-only` so the wizard can import it, and
// intentionally free of Prisma types so a Decimal or a number both work.

export type ActiveOffer = {
  discountType: string; // 'PERCENTAGE' | 'FIXED'
  discountValue: number;
} | null;

/**
 * Apply a global offer to a price and round to whole pence. Returns the price
 * unchanged when there is no offer. This is the single source of truth so the
 * public service pages, the booking wizard summary, the recorded priceAtBooking
 * and the confirmation email all show the SAME number — previously the pages
 * advertised a discount the booking never honoured.
 */
export function applyOfferToPrice(price: number, offer: ActiveOffer): number {
  if (!offer) return price;
  const discounted =
    offer.discountType === 'PERCENTAGE'
      ? price - price * (offer.discountValue / 100)
      : price - offer.discountValue;
  return Math.max(0, Math.round(discounted * 100) / 100);
}
