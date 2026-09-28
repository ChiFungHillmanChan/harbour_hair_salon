'use client';

import { HTML_LANG } from '@/i18n/config';
import { useLocale, useT } from '@/i18n/client';
import { formatGBP } from '@/app/services/pricing/money';
import type { ClientPublicService } from '@/app/services/public-service-select';

/** "£157.00" — identical figures in both languages, formatted for the page's locale. */
export function useFormatPrice() {
  const locale = useLocale();
  return (pence: number) => formatGBP(pence, HTML_LANG[locale]);
}

type PriceSemantics = Pick<ClientPublicService, 'vatDisplay' | 'priceNature' | 'priceType'>;

/**
 * The small print that must travel with a price wherever it is shown: the
 * VAT wording (only when the price list says so — no claim otherwise), and
 * "may be adjusted after consultation" for prices that are not final.
 */
export function PriceFinePrint({ service, className = '', showNhs = false }: { service: PriceSemantics; className?: string; showNhs?: boolean }) {
  const t = useT('pricing');
  const notes: string[] = [];
  if (showNhs && service.priceType === 'NHS') notes.push(t('nhsApplies'));
  if (service.vatDisplay === 'EXCLUDED') notes.push(t('vatExcluded'));
  if (service.priceNature === 'SUBJECT_TO_CONSULTATION') notes.push(t('subjectToConsultation'));
  if (notes.length === 0) return null;
  return (
    <span className={`block text-[11px] leading-snug text-zinc-500 ${className}`}>
      {notes.join(' · ')}
    </span>
  );
}

/** "Long hair price £157.00 + extra long £37.00" for a composite option. */
export function SurchargeBreakdown({ option, base }: { option: Pick<ClientPublicService, 'surchargeAmountPence'>; base: Pick<ClientPublicService, 'amountPence'> | undefined }) {
  const t = useT('pricing');
  const format = useFormatPrice();
  if (option.surchargeAmountPence === null || !base) return null;
  return (
    <span className="block text-[11px] leading-snug text-zinc-500">
      {t('extraLongBreakdown', { base: format(base.amountPence), surcharge: format(option.surchargeAmountPence) })}
    </span>
  );
}

export function OptionLabel({ option }: { option: Pick<ClientPublicService, 'hairLength'> }) {
  const t = useT('pricing');
  return <>{option.hairLength ? t.dynamic(`hairLength.${option.hairLength}`) : null}</>;
}

export function Duration({ option }: { option: Pick<ClientPublicService, 'duration' | 'durationConfirmed'> }) {
  const t = useT('pricing');
  return <>{option.durationConfirmed ? t('minutes', { count: option.duration }) : t('durationAtConsultation')}</>;
}

/** Category heading in the page's language; unknown categories show as stored. */
export function useCategoryLabel() {
  const t = useT('pricing');
  return (category: string) => t.dynamic(`categories.${category}`, undefined, category);
}
