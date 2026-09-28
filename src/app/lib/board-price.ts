import { formatGBP } from '@/app/services/pricing/money';
import type { PriceNature, PriceType, VatDisplay } from '@/app/services/pricing/policy';
import { HTML_LANG } from '@/i18n/config';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';

/**
 * A price as the admin board shows it. For an existing appointment this is its
 * RECORDED price (recordedPrice): unknown stays unknown — never today's service
 * price and never £0. For a service the admin is about to book it is that
 * option's listed price. The type/VAT/nature labels are null when the record
 * predates stored quotes, in which case no claim is made about them.
 */
export type BoardPrice =
  | { known: false }
  | {
      known: true;
      amountPence: number;
      priceType: PriceType | string | null;
      vatDisplay: VatDisplay | string | null;
      priceNature: PriceNature | string | null;
    };

/** "£142.00" plus its fine print ("NHS price applied · VAT excluded"), in the page language. */
export function describeBoardPrice(price: BoardPrice, tp: Translate<Messages['pricing']>): { amount: string; notes: string[] } {
  if (!price.known) return { amount: tp('unknownPrice'), notes: [] };
  const notes: string[] = [];
  if (price.priceType === 'NHS') notes.push(tp('nhsApplied'));
  if (price.vatDisplay === 'EXCLUDED') notes.push(tp('vatExcluded'));
  if (price.priceNature === 'SUBJECT_TO_CONSULTATION') notes.push(tp('subjectToConsultation'));
  return { amount: formatGBP(price.amountPence, HTML_LANG[tp.locale]), notes };
}
