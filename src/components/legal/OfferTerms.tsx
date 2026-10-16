import type { Messages } from '@/i18n/messages';
import type { Translate } from '@/i18n/translator';

/** The five offer, discount-code and NHS/student-price terms, in the order /booking-terms and /offers show them. */
export const OFFER_TERM_KEYS = ['oneCode', 'noCombine', 'noCashValue', 'proof', 'withdraw'] as const;

/** One paragraph per term, from `legal.bookingTerms.offers`. */
export function OfferTerms({ t }: { t: Translate<Messages['legal']> }) {
  return (
    <>
      {OFFER_TERM_KEYS.map((key) => <p key={key}>{t(`bookingTerms.offers.${key}`)}</p>)}
    </>
  );
}
