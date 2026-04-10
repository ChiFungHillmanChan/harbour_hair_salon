'use client';

import { Service, Offer } from '@prisma/client';
import Link from 'next/link';
import { useState, useMemo } from 'react';

interface ServiceListProps {
  groupedServices: Record<string, (Omit<Service, 'price'> & { price: number })[]>;
  categories: string[];
  activeOffer: (Omit<Offer, 'discountValue'> & { discountValue: number }) | null;
  categorySlugs?: Record<string, string>;
}

type IconProps = { className?: string };

const ScissorsIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

const DropletIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5s6.5 7 6.5 12a6.5 6.5 0 0 1-13 0c0-5 6.5-12 6.5-12z" />
  </svg>
);

const SpiralIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20a8 8 0 1 0-8-8 6 6 0 0 0 6 6 4 4 0 0 0 4-4 2 2 0 0 0-2-2 1 1 0 0 0-1 1" />
  </svg>
);

const SparkleIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);

const BrushIcon = ({ className }: IconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
  </svg>
);

const CategoryIcon = ({ category, className }: { category: string; className?: string }) => {
  const lower = category.toLowerCase();
  if (lower.includes('haircut')) return <ScissorsIcon className={className} />;
  if (lower.includes('colour') || lower.includes('color')) return <DropletIcon className={className} />;
  if (lower.includes('perm')) return <SpiralIcon className={className} />;
  if (lower.includes('treatment')) return <SparkleIcon className={className} />;
  if (lower.includes('styling') || lower.includes('style')) return <BrushIcon className={className} />;
  return <ScissorsIcon className={className} />;
};

export function ServiceList({ groupedServices, categories, activeOffer, categorySlugs }: ServiceListProps) {
  const [activeCategory, setActiveCategory] = useState<string>(categories[0] ?? '');
  const activeSlug = categorySlugs?.[activeCategory];

  const priceRangeByCategory = useMemo(() => {
    const map: Record<string, { min: number; max: number }> = {};
    for (const cat of categories) {
      const prices = (groupedServices[cat] ?? []).map((s) => s.price);
      if (prices.length > 0) {
        map[cat] = { min: Math.min(...prices), max: Math.max(...prices) };
      }
    }
    return map;
  }, [categories, groupedServices]);

  const getDiscountedPrice = (price: number) => {
    if (!activeOffer) return null;
    if (activeOffer.discountType === 'PERCENTAGE') {
      return price - price * (activeOffer.discountValue / 100);
    }
    return Math.max(0, price - activeOffer.discountValue);
  };

  const activeServices = groupedServices[activeCategory] ?? [];
  const activeRange = priceRangeByCategory[activeCategory];

  return (
    <div>
      {/* Category tab bar — flex-wrap + justify-center means every tab is always visible.
          Only sticky on md+; on mobile it scrolls with content so it never eats
          viewport space on small devices like iPhone SE. */}
      <div className="md:sticky md:top-[68px] z-20 -mx-4 px-4 md:mx-0 md:px-0 bg-white/90 backdrop-blur-md border-y border-zinc-100 mb-12">
        <div
          role="tablist"
          aria-label="Service categories"
          className="flex flex-wrap justify-center gap-2 py-4"
        >
          {categories.map((category) => {
            const isActive = category === activeCategory;
            const count = groupedServices[category]?.length ?? 0;
            return (
              <button
                key={category}
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
                  className={`w-3.5 h-3.5 transition-transform duration-300 ${isActive ? 'text-accent' : 'text-zinc-400 group-hover:text-zinc-600'}`}
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap">
                  {category}
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
          <div className="w-14 h-14 rounded-full bg-zinc-900 text-accent flex items-center justify-center shadow-md">
            <CategoryIcon category={activeCategory} className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-medium mb-1">
              Category
            </p>
            <h2 className="text-4xl md:text-5xl font-serif text-zinc-900 leading-none">
              {activeCategory}
            </h2>
          </div>
        </div>
        {activeRange && (
          <div className="text-left sm:text-right">
            <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-medium mb-1">
              From
            </p>
            <p className="text-2xl font-serif text-zinc-900">
              £{activeRange.min.toFixed(2)}
              <span className="text-zinc-400 text-lg"> – £{activeRange.max.toFixed(2)}</span>
            </p>
          </div>
        )}
      </div>

      {activeSlug && (
        <div className="mb-8">
          <Link
            href={`/services/${activeSlug}`}
            className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 border-b border-zinc-200 hover:border-accent hover:text-accent transition-colors pb-1"
          >
            Learn more about {activeCategory.toLowerCase()}
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      )}

      {/* Service cards grid */}
      <div
        key={activeCategory}
        className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 animate-fade-in-up"
      >
        {activeServices.map((service, index) => {
          const discountedPrice = getDiscountedPrice(service.price);
          return (
            <article
              key={service.id}
              className="group relative flex flex-col h-full bg-white border border-zinc-200/80 rounded-2xl p-6 md:p-7 transition-all duration-500 hover:border-zinc-900 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] hover:-translate-y-1"
              style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
            >
              {/* Accent corner */}
              <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden rounded-tr-2xl pointer-events-none">
                <div className="absolute top-0 right-0 w-px h-12 bg-gradient-to-b from-accent/60 to-transparent" />
                <div className="absolute top-0 right-0 h-px w-12 bg-gradient-to-l from-accent/60 to-transparent" />
              </div>

              {/* Title + price row. min-h-[3lh] reserves space for up to 3 lines of title,
                  so the description below starts at the same Y on every card in the row. */}
              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="text-xl md:text-2xl font-serif text-zinc-900 leading-tight pr-4 flex-1 min-h-[3lh] group-hover:text-zinc-700 transition-colors">
                  {service.name}
                </h3>
                <div className="text-right whitespace-nowrap flex-shrink-0">
                  {discountedPrice !== null ? (
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-zinc-400 line-through decoration-zinc-400/60">
                        £{service.price.toFixed(2)}
                      </span>
                      <span className="text-2xl font-serif font-semibold text-red-700">
                        £{discountedPrice.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-2xl font-serif font-semibold text-zinc-900">
                      £{service.price.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              {/* Description always renders with a min-height so the dashed divider
                  below lands at the same Y regardless of description length. */}
              <p className="text-zinc-500 font-light text-sm leading-relaxed mb-4 min-h-[2lh]">
                {service.description ?? ''}
              </p>

              {/* mt-auto pins the meta row to the bottom so dividers align across cards in the same row */}
              <div className="mt-auto flex items-center gap-3 pt-3 border-t border-dashed border-zinc-200">
                <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-zinc-500 font-medium">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {service.duration} mins
                </span>
                {discountedPrice !== null && (
                  <span className="inline-flex items-center text-[10px] uppercase tracking-[0.15em] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                    On Offer
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
