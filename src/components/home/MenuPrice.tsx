'use client';

import { useT } from '@/i18n/client';
import type { ClientPublicService } from '@/app/services/public-service-select';
import { PriceFinePrint, useFormatPrice } from '@/components/pricing/PriceParts';

/** A menu card's standard price, or "From £x" when the lengths differ or the price is a consultation-required starting point, plus its fine print. */
export function MenuPrice({ min, max, semantics }: { min: number; max: number; semantics: Pick<ClientPublicService, 'vatDisplay' | 'priceNature' | 'priceType' | 'requiresConsultation'> }) {
  const t = useT('services');
  const format = useFormatPrice();
  return (
    <>
      <span className="text-2xl font-serif font-semibold text-zinc-900 tabular-nums">
        {min === max && !semantics.requiresConsultation ? format(min) : t('menu.fromPrice', { price: format(min) })}
      </span>
      <PriceFinePrint service={{ ...semantics, priceType: 'STANDARD' }} />
    </>
  );
}
