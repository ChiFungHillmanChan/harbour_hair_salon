'use client';

import type { PriceListEntry } from '@/app/services/pricing/public-catalog';
import { OfferingPrices } from '@/components/pricing/OfferingPrices';
import { Duration, PriceFinePrint, useFormatPrice } from '@/components/pricing/PriceParts';

/**
 * The price table on a category page: each menu item with its length ×
 * standard/NHS prices, and standalone services as single rows — from the same
 * catalogue as the services list and the booking wizard.
 */
export function CategoryPriceList({ entries }: { entries: PriceListEntry[] }) {
  const formatPrice = useFormatPrice();
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden divide-y divide-zinc-100">
      {entries.map((entry) => entry.kind === 'offering' ? (
        <article key={entry.offering.id} className="p-5 md:p-6">
          <h3 className="text-base md:text-lg font-medium text-zinc-900" lang={entry.offering.translated ? undefined : 'en'}>{entry.offering.name}</h3>
          {entry.offering.description && (
            <p className="text-sm text-zinc-500 mt-1 font-light" lang={entry.offering.translated ? undefined : 'en'}>{entry.offering.description}</p>
          )}
          <div className="mt-3">
            <OfferingPrices options={entry.options} />
          </div>
          {entry.options.find((option) => option.priceNote)?.priceNote && (
            <p className="mt-2 text-xs text-zinc-500">{entry.options.find((option) => option.priceNote)!.priceNote}</p>
          )}
        </article>
      ) : (
        <article key={entry.service.id} className="flex items-center justify-between gap-6 p-5 md:p-6 hover:bg-zinc-50 transition-colors">
          <div className="flex-1 min-w-0">
            <h3 className="text-base md:text-lg font-medium text-zinc-900" lang={entry.service.translated ? undefined : 'en'}>{entry.service.name}</h3>
            {entry.service.description && (
              <p className="text-sm text-zinc-500 mt-1 font-light" lang={entry.service.translated ? undefined : 'en'}>{entry.service.description}</p>
            )}
            <p className="text-xs text-zinc-400 uppercase tracking-wider mt-2">
              <Duration option={entry.service} />
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-lg font-serif font-bold text-zinc-900 tabular-nums">{formatPrice(entry.service.amountPence)}</span>
            <PriceFinePrint service={entry.service} showNhs />
          </div>
        </article>
      ))}
    </div>
  );
}
