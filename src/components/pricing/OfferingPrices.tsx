'use client';

import { useT } from '@/i18n/client';
import type { ClientPublicService } from '@/app/services/public-service-select';
import { Duration, OptionLabel, PriceFinePrint, SurchargeBreakdown, useFormatPrice } from './PriceParts';

type Row = { key: string; label: ClientPublicService; standard?: ClientPublicService; nhs?: ClientPublicService };

/** Group options into one row per hair length with its standard and NHS price. */
export function rowsFor(options: ClientPublicService[]): Row[] {
  const rows = new Map<string, Row>();
  for (const option of options) {
    const key = option.hairLength ?? '-';
    const row = rows.get(key) ?? { key, label: option };
    if (option.priceType === 'NHS') row.nhs = option;
    else row.standard = option;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * One menu item's prices. Desktop: a compact table comparing standard and NHS
 * per hair length. Phones: one block per length, prices stacked vertically —
 * the NHS price is never hidden behind horizontal scrolling. An option with no
 * NHS price shows only its standard price (never £0, never a computed %).
 */
export function OfferingPrices({ options }: { options: ClientPublicService[] }) {
  const t = useT('pricing');
  const format = useFormatPrice();
  const rows = rowsFor(options);
  const hasNhs = rows.some((row) => row.nhs);
  const byId = new Map(options.map((option) => [option.id, option]));

  const cell = (option: ClientPublicService | undefined, isNhs: boolean) => {
    if (!option) return <span className="text-zinc-300" aria-label={t('noNhsPrice')}>—</span>;
    const base = option.surchargeBaseServiceId ? byId.get(option.surchargeBaseServiceId) : undefined;
    return (
      <span className="block">
        <span className="font-serif text-lg font-semibold text-zinc-900 tabular-nums">{format(option.amountPence)}</span>
        <PriceFinePrint service={option} showNhs={isNhs} />
        <SurchargeBreakdown option={option} base={base} />
      </span>
    );
  };

  return (
    <div>
      {/* md+: comparison table */}
      <table className="hidden md:table w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-zinc-500">
            <th scope="col" className="py-2 pr-4 font-medium">{t('columns.option')}</th>
            <th scope="col" className="py-2 pr-4 font-medium">{t('columns.standard')}</th>
            {hasNhs && <th scope="col" className="py-2 font-medium">{t('columns.nhs')}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-dashed divide-zinc-200">
          {rows.map((row) => (
            <tr key={row.key} className="align-top">
              <th scope="row" className="py-3 pr-4 text-left font-normal text-zinc-700">
                <span className="block font-medium text-zinc-900"><OptionLabel option={row.label} /></span>
                <span className="block text-[11px] text-zinc-500"><Duration option={row.standard ?? row.label} /></span>
              </th>
              <td className="py-3 pr-4">{cell(row.standard, false)}</td>
              {hasNhs && <td className="py-3">{cell(row.nhs, true)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* phones: stacked, no horizontal scroll */}
      <ul className="md:hidden divide-y divide-dashed divide-zinc-200">
        {rows.map((row) => (
          <li key={row.key} className="py-3">
            {row.label.hairLength && (
              <p className="text-sm font-medium text-zinc-900"><OptionLabel option={row.label} /></p>
            )}
            <p className="text-[11px] text-zinc-500 mb-2"><Duration option={row.standard ?? row.label} /></p>
            <dl className="space-y-2">
              {row.standard && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-xs uppercase tracking-[0.12em] text-zinc-500 pt-1">{t('columns.standard')}</dt>
                  <dd className="text-right">{cell(row.standard, false)}</dd>
                </div>
              )}
              {row.nhs && (
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-xs uppercase tracking-[0.12em] text-zinc-500 pt-1">{t('columns.nhs')}</dt>
                  <dd className="text-right">{cell(row.nhs, true)}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
