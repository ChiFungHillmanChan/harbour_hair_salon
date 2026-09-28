import { toPence, type Pence } from './money';
import { parseQuote, type PriceQuote } from './quote';
import type { PriceNature, PriceType, VatDisplay } from './policy';

/**
 * The price of an EXISTING appointment, as recorded — never re-derived from
 * today's price list.
 *
 * Bookings made before prices were frozen per appointment have a null
 * priceAtBooking. Their amount is UNKNOWN: it is not today's service price
 * (that is what used to be shown, and what payroll used to count), and it is
 * not zero. Their price type and VAT basis are unknown too.
 */
export type RecordedPrice =
  | {
      known: true;
      amountPence: Pence;
      /** Null for bookings made before quotes were stored: type/VAT unknown. */
      priceType: PriceType | null;
      vatDisplay: VatDisplay | null;
      priceNature: PriceNature | null;
      quote: PriceQuote | null;
    }
  | { known: false };

export function recordedPrice(appointment: { priceAtBooking: { toString(): string } | number | null; quoteJson?: string | null }): RecordedPrice {
  if (appointment.priceAtBooking === null || appointment.priceAtBooking === undefined) return { known: false };
  const quote = parseQuote(appointment.quoteJson ?? null);
  const amountPence = toPence(appointment.priceAtBooking);
  // A quote that disagrees with the committed amount is ignored for its
  // labels; the committed amount is what the customer agreed to.
  const trusted = quote && quote.amountPence === amountPence ? quote : null;
  return {
    known: true,
    amountPence,
    priceType: trusted?.priceType ?? null,
    vatDisplay: trusted?.vatDisplay ?? null,
    priceNature: trusted?.priceNature ?? null,
    quote: trusted,
  };
}
