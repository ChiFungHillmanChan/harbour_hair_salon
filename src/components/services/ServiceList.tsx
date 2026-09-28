'use client';

import Link from '@/i18n/link';
import { useMemo } from 'react';
import { useT } from '@/i18n/client';
import { useDraftState } from '@/i18n/draft-store';
import type { PriceListEntry } from '@/app/services/pricing/public-catalog';
import { standardPriceRange } from '@/app/services/pricing/public-catalog';
import { OfferingPrices } from '@/components/pricing/OfferingPrices';
import { Duration, PriceFinePrint, useCategoryLabel, useFormatPrice } from '@/components/pricing/PriceParts';

interface ServiceListProps {
  categories: { category: string; entries: PriceListEntry[] }[];
  categorySlugs?: Record<string, string>;
}

type IconProps = { className?: string };

const ScissorsIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

const DropletIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5s6.5 7 6.5 12a6.5 6.5 0 0 1-13 0c0-5 6.5-12 6.5-12z" />
  </svg>
);

const SpiralIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20a8 8 0 1 0-8-8 6 6 0 0 0 6 6 4 4 0 0 0 4-4 2 2 0 0 0-2-2 1 1 0 0 0-1 1" />
  </svg>
);

const SparkleIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);

const BrushIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
  </svg>
);

// Icons follow the stored (English) category key, never its translation.
const CategoryIcon = ({ category, className }: { category: string; className?: string }) => {
  const lower = category.toLowerCase();
  if (lower.includes('haircut')) return <ScissorsIcon className={className} />;
  if (lower.includes('colour') || lower.includes('color')) return <DropletIcon className={className} />;
  if (lower.includes('perm')) return <SpiralIcon className={className} />;
  if (lower.includes('treatment')) return <SparkleIcon className={className} />;
  if (lower.includes('styling') || lower.includes('style')) return <BrushIcon className={className} />;
  return <ScissorsIcon className={className} />;
};

const entryServices = (entry: PriceListEntry) => (entry.kind === 'offering' ? entry.options : [entry.service]);

export function ServiceList({ categories, categorySlugs }: ServiceListProps) {
  const t = useT('services');
  const tp = useT('pricing');
  const formatPrice = useFormatPrice();
  const categoryLabel = useCategoryLabel();
  // The open tab survives a language switch (in memory only).
  const [activeCategory, setActiveCategory] = useDraftState<string>('services-list:tab', categories[0]?.category ?? '');
  const active = categories.find((group) => group.category === activeCategory) ?? categories[0];
  const activeSlug = active ? categorySlugs?.[active.category] : undefined;

  // "From" ranges quote STANDARD prices only: an NHS price is not a price
  // everyone can book, so it never becomes the advertised minimum.
  const rangeByCategory = useMemo(() => {
    const map: Record<string, { min: number; max: number } | null> = {};
    for (const group of categories) map[group.category] = standardPriceRange(group.entries.flatMap(entryServices));
    return map;
  }, [categories]);

  if (!active) return null;
  const activeRange = rangeByCategory[active.category];

  return (
    <div>
      {/* Category tab bar — flex-wrap + justify-center means every tab is always visible.
          Only sticky on md+; on mobile it scrolls with content so it never eats
          viewport space on small devices like iPhone SE. */}
      <div className="md:sticky md:top-[68px] z-20 -mx-4 px-4 md:mx-0 md:px-0 bg-white/90 backdrop-blur-md border-y border-zinc-100 mb-12">
        <div
          role="tablist"
          aria-label={t('list.categoriesLabel')}
          className="flex flex-wrap justify-center gap-2 py-4"
        >
          {categories.map(({ category, entries }) => {
            const isActive = category === active.category;
            const count = entries.length;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveCategory(category)}
                className={`group relative inline-flex items-center gap-2 pl-3 pr-3.5 py-2.5 rounded-full border transition-all duration-300 ${
                  isActive
                    ? 'bg-zinc-900 border-zinc-900 text-white shadow-lg shadow-zinc-900/20'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900'
                }`}
              >
                <CategoryIcon
                  category={category}
                  className={`w-3.5 h-3.5 transition-transform duration-300 ${isActive ? 'text-zinc-300' : 'text-zinc-400 group-hover:text-zinc-600'}`}
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap">
                  {categoryLabel(category)}
                </span>
                <span
                  className={`text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category hero strip */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-full bg-zinc-900 text-zinc-300 flex items-center justify-center shadow-md">
            <CategoryIcon category={active.category} className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-medium mb-1">
              {t('list.category')}
            </p>
            <h2 className="text-4xl md:text-5xl font-serif text-zinc-900 leading-none">
              {categoryLabel(active.category)}
            </h2>
          </div>
        </div>
        {activeRange && (
          <div className="text-left sm:text-right">
            <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-medium mb-1">
              {tp('from')}
            </p>
            <p className="text-2xl font-serif text-zinc-900">
              {activeRange.min === activeRange.max
                ? formatPrice(activeRange.min)
                : tp('range', { min: formatPrice(activeRange.min), max: formatPrice(activeRange.max) })}
            </p>
          </div>
        )}
      </div>

      {activeSlug && (
        <div className="mb-8">
          <Link
            href={`/services/${activeSlug}`}
            className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 border-b border-zinc-200 hover:border-zinc-400 hover:text-zinc-600 transition-colors pb-1"
          >
            {t('list.learnMore', { category: categoryLabel(active.category) })}
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      )}

      {/* Service cards grid */}
      <div
        key={active.category}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 animate-fade-in-up"
      >
        {active.entries.map((entry, index) => {
          const key = entry.kind === 'offering' ? entry.offering.id : entry.service.id;
          const title = entry.kind === 'offering' ? entry.offering.name : entry.service.name;
          const translated = entry.kind === 'offering' ? entry.offering.translated : entry.service.translated;
          const description = entry.kind === 'offering' ? (entry.offering.description ?? entry.options[0]?.description ?? null) : entry.service.description;
          const note = entry.kind === 'offering' ? entry.options.find((o) => o.priceNote)?.priceNote : entry.service.priceNote;
          return (
            <article
              key={key}
              className="group relative flex flex-col h-full bg-white border border-zinc-200/80 rounded-2xl p-6 md:p-7 transition-all duration-500 hover:border-zinc-900 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] hover:-translate-y-1"
              style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
            >
              {/* Accent corner */}
              <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden rounded-tr-2xl pointer-events-none">
                <div className="absolute top-0 right-0 w-px h-12 bg-gradient-to-b from-zinc-300/60 to-transparent" />
                <div className="absolute top-0 right-0 h-px w-12 bg-gradient-to-l from-zinc-300/60 to-transparent" />
              </div>

              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="text-xl md:text-2xl font-serif text-zinc-900 leading-tight pr-4 flex-1 group-hover:text-zinc-700 transition-colors" lang={translated ? undefined : 'en'}>
                  {title}
                </h3>
                {entry.kind === 'single' && (
                  <div className="text-right whitespace-nowrap flex-shrink-0">
                    <span className="text-2xl font-serif font-semibold text-zinc-900 tabular-nums">
                      {formatPrice(entry.service.amountPence)}
                    </span>
                    <PriceFinePrint service={entry.service} showNhs />
                  </div>
                )}
              </div>

              {description && (
                <p className="text-zinc-500 font-light text-sm leading-relaxed mb-4" lang={translated ? undefined : 'en'}>
                  {description}
                </p>
              )}

              {entry.kind === 'offering' ? (
                <div className="mt-auto pt-3 border-t border-dashed border-zinc-200">
                  <OfferingPrices options={entry.options} />
                  {note && <p className="mt-2 text-xs text-zinc-500">{note}</p>}
                </div>
              ) : (
                <div className="mt-auto flex items-center gap-3 pt-3 border-t border-dashed border-zinc-200">
                  <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-zinc-500 font-medium">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    <Duration option={entry.service} />
                  </span>
                  {note && <span className="text-xs text-zinc-500">{note}</span>}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-10 text-center text-xs text-zinc-500">{t('list.nhsNote')}</p>
    </div>
  );
}
