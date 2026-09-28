import type { PriceListEntry } from '@/app/services/pricing/public-catalog';
import { standardPriceRange } from '@/app/services/pricing/public-catalog';
import { menuItemDescription } from '@/app/services/pricing/policy';
import Link from '@/i18n/link';
import { getT } from '@/i18n/server';
import { Reveal } from './Reveal';
import { MenuPrice } from './MenuPrice';

interface ServiceMenuProps {
  entries: PriceListEntry[];
  title?: string;
  flatList?: boolean;
}

/**
 * The home page's "Signature Services" cards. Prices come from the shared
 * catalogue: a menu item shows its STANDARD price range (never an NHS price as
 * a "from" price everyone can get) and says when an NHS price exists.
 */
export async function ServiceMenu({ entries, title, flatList = false }: ServiceMenuProps) {
  const [t, tp] = await Promise.all([getT('services'), getT('pricing')]);
  const categories = Array.from(new Set(entries.map((entry) => (entry.kind === 'offering' ? entry.offering.category : entry.service.category))));

  const renderServiceCard = (entry: PriceListEntry, index: number) => {
    const options = entry.kind === 'offering' ? entry.options : [entry.service];
    const range = standardPriceRange(options);
    const hasNhs = options.some((option) => option.priceType === 'NHS');
    const name = entry.kind === 'offering' ? entry.offering.name : entry.service.name;
    const translated = entry.kind === 'offering' ? entry.offering.translated : entry.service.translated;
    const description = entry.kind === 'offering' ? (menuItemDescription(entry.offering.description, options) ?? '') : (entry.service.description ?? '');
    const key = entry.kind === 'offering' ? entry.offering.id : entry.service.id;
    const sample = options.find((option) => option.priceType !== 'NHS') ?? options[0];
    const durations = options.filter((option) => option.durationConfirmed).map((option) => option.duration);

    return (
      <Reveal
        key={key}
        as="article"
        delay={index * 40}
        className="group relative flex flex-col h-full bg-white border border-zinc-200/80 rounded-2xl p-6 md:p-7 transition-all duration-500 ease-apple hover:border-zinc-900 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] hover:-translate-y-1"
      >
        {/* Accent corner */}
        <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden rounded-tr-2xl pointer-events-none">
          <div className="absolute top-0 right-0 w-px h-12 bg-gradient-to-b from-zinc-300 to-transparent" />
          <div className="absolute top-0 right-0 h-px w-12 bg-gradient-to-l from-zinc-300 to-transparent" />
        </div>

        {/* Title + price. min-h-[3lh] reserves 3 lines for the title so all cards
            in a row align their description/divider Y positions. */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="text-xl md:text-2xl font-serif text-zinc-900 leading-tight pr-4 flex-1 min-h-[3lh] group-hover:text-zinc-700 transition-colors" lang={translated ? undefined : 'en'}>
            {name}
          </h3>
          <div className="text-right whitespace-nowrap flex-shrink-0">
            {range && sample && <MenuPrice min={range.min} max={range.max} semantics={sample} />}
          </div>
        </div>

        {/* Description always renders with a min-height so the dashed divider
            below lands at the same Y regardless of description length. */}
        <p className="text-zinc-500 font-light text-sm leading-relaxed mb-4 min-h-[2lh]" lang={translated ? undefined : 'en'}>
          {description}
        </p>

        {/* mt-auto pins the meta row to the bottom of the card. */}
        <div className="mt-auto flex items-center gap-3 pt-3 border-t border-dashed border-zinc-200">
          <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] text-zinc-500 font-medium">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {durations.length > 0
              ? tp('minutes', { count: Math.min(...durations) })
              : tp('durationAtConsultation')}
          </span>
          {hasNhs && (
            <span className="inline-flex items-center text-[10px] uppercase tracking-[0.15em] font-bold text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-full">
              {t('menu.nhsAvailable')}
            </span>
          )}
        </div>
      </Reveal>
    );
  };

  return (
    <section id="services" className="relative py-28 bg-white text-zinc-900 overflow-hidden">
      {/* Subtle backdrop grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#00000008_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative container mx-auto px-4">
        <Reveal className="text-center mb-16">
          <p className="text-sm uppercase tracking-[0.2em] text-zinc-500 mb-4 font-medium">{t('menu.eyebrow')}</p>
          <h2 className="text-4xl md:text-6xl font-serif mb-4 tracking-tight">{title ?? t('menu.defaultTitle')}</h2>
          <div className="w-16 h-px bg-zinc-300 mx-auto" />
        </Reveal>

        {flatList ? (
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            {entries.map((entry, index) => renderServiceCard(entry, index))}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            {categories.map((category, catIndex) => (
              <Reveal key={category} delay={catIndex * 80} className="mb-12 last:mb-0">
                <h3 className="text-2xl font-serif mb-6 uppercase tracking-widest border-b border-zinc-200 pb-2">
                  {tp.dynamic(`categories.${category}`, undefined, category)}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                  {entries
                    .filter((entry) => (entry.kind === 'offering' ? entry.offering.category : entry.service.category) === category)
                    .map((entry, idx) => renderServiceCard(entry, idx))}
                </div>
              </Reveal>
            ))}
          </div>
        )}

        {/* View All + Book links */}
        <Reveal className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-16" delay={120}>
          <Link
            href="/services"
            className="text-sm uppercase tracking-[0.15em] font-medium text-zinc-600 hover:text-zinc-900 transition-colors border-b border-zinc-300 hover:border-zinc-900 pb-1"
          >
            {t('menu.viewFullMenu')}
          </Link>
          <Link
            href="/book"
            className="group inline-flex items-center gap-2 bg-zinc-900 text-white px-8 md:px-10 py-3.5 md:py-4 text-[13px] md:text-sm uppercase tracking-[0.12em] md:tracking-[0.15em] font-bold hover:bg-black transition-all duration-500 ease-apple hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)] hover:-translate-y-0.5"
          >
            {t('menu.bookAppointment')}
            <svg className="w-4 h-4 transition-transform duration-500 ease-apple group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
