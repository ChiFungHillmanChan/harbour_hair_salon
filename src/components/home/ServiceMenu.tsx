import { Service, Offer } from '@prisma/client';
import Link from 'next/link';
import { Reveal } from './Reveal';

interface ServiceMenuProps {
  services: (Omit<Service, 'price'> & { price: number })[];
  activeOffer: (Omit<Offer, 'discountValue'> & { discountValue: number }) | null;
  title?: string;
  flatList?: boolean;
}

export function ServiceMenu({ services, activeOffer, title = 'Our Services', flatList = false }: ServiceMenuProps) {
  const sortOrder = ['Haircuts', 'Colouring', 'Perms', 'Treatments', 'Styling'];
  const categories = Array.from(new Set(services.map((s) => s.category))).sort((a, b) => {
    const indexA = sortOrder.indexOf(a);
    const indexB = sortOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  const getDiscountedPrice = (price: number) => {
    if (!activeOffer) return null;
    if (activeOffer.discountType === 'PERCENTAGE') {
      return price - price * (activeOffer.discountValue / 100);
    }
    return Math.max(0, price - activeOffer.discountValue);
  };

  const renderServiceCard = (
    service: Omit<Service, 'price'> & { price: number },
    index: number
  ) => {
    const discountedPrice = getDiscountedPrice(service.price);

    return (
      <Reveal
        key={service.id}
        as="article"
        delay={index * 40}
        className="group relative flex flex-col h-full bg-white border border-zinc-200/80 rounded-2xl p-6 md:p-7 transition-all duration-500 ease-apple hover:border-zinc-900 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] hover:-translate-y-1"
      >
        {/* Accent corner */}
        <div className="absolute top-0 right-0 w-12 h-12 overflow-hidden rounded-tr-2xl pointer-events-none">
          <div className="absolute top-0 right-0 w-px h-12 bg-gradient-to-b from-accent/60 to-transparent" />
          <div className="absolute top-0 right-0 h-px w-12 bg-gradient-to-l from-accent/60 to-transparent" />
        </div>

        {/* Title + price. min-h-[3lh] reserves 3 lines for the title so all cards
            in a row align their description/divider Y positions. */}
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

        {/* mt-auto pins the meta row to the bottom of the card. */}
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
      </Reveal>
    );
  };

  return (
    <section id="services" className="relative py-28 bg-white text-zinc-900 overflow-hidden">
      {/* Subtle backdrop grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#00000008_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative container mx-auto px-4">
        <Reveal className="text-center mb-16">
          <p className="text-sm uppercase tracking-[0.35em] text-accent mb-4 font-medium">What We Offer</p>
          <h2 className="text-4xl md:text-6xl font-serif mb-4 tracking-tight">{title}</h2>
          <div className="w-16 h-[2px] bg-accent mx-auto" />
        </Reveal>

        {flatList ? (
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            {services.map((service, index) => renderServiceCard(service, index))}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto">
            {categories.map((category, catIndex) => (
              <Reveal key={category} delay={catIndex * 80} className="mb-12 last:mb-0">
                <h3 className="text-2xl font-serif mb-6 uppercase tracking-widest border-b border-zinc-200 pb-2">
                  {category}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                  {services
                    .filter((s) => s.category === category)
                    .map((service, idx) => renderServiceCard(service, idx))}
                </div>
              </Reveal>
            ))}
          </div>
        )}

        {/* View All + Book links */}
        <Reveal className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-16" delay={120}>
          <Link
            href="/services"
            className="text-sm uppercase tracking-[0.2em] font-medium text-zinc-600 hover:text-accent transition-colors border-b border-zinc-300 hover:border-accent pb-1"
          >
            View Full Menu
          </Link>
          <Link
            href="/book"
            className="group inline-flex items-center gap-2 bg-accent text-black px-8 md:px-10 py-3.5 md:py-4 text-[13px] md:text-sm uppercase tracking-[0.18em] md:tracking-[0.2em] font-bold hover:bg-accent-light transition-all duration-500 ease-apple hover:shadow-[0_20px_50px_-15px_rgba(201,169,110,0.55)] hover:-translate-y-0.5"
          >
            Book Appointment
            <svg className="w-4 h-4 transition-transform duration-500 ease-apple group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
