import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import Image from 'next/image';
import prisma from '@/app/lib/prisma';
import Link from '@/i18n/link';
import { SITE_URL } from '@/app/lib/site-url';
import { jsonLdScript } from '@/app/lib/json-ld';
import { DISCOUNTS_PAUSED } from '@/app/services/pricing/policy';
import { formatGBP, toPence } from '@/app/services/pricing/money';
import { loadPublishedTranslations, overlay } from '@/app/services/content/translations';
import { HTML_LANG, type Locale } from '@/i18n/config';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('offers')]);
  // While discounts are paused the page must not promise savings, in search results either.
  return {
    title: DISCOUNTS_PAUSED ? t('meta.pausedTitle') : t('meta.title'),
    description: DISCOUNTS_PAUSED ? t('meta.pausedDescription') : t('meta.description'),
    alternates: alternatesFor(locale, '/offers'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: DISCOUNTS_PAUSED ? t('meta.pausedOgTitle') : t('meta.ogTitle'),
      description: DISCOUNTS_PAUSED ? t('meta.pausedDescription') : t('meta.ogDescription'),
    },
  };
}

// Revalidate data every hour
export const revalidate = 3600;

async function getOffers(locale: Locale) {
  const offers = await prisma.offer.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  });
  const translations = await loadPublishedTranslations(prisma, 'OFFER', offers.map((offer) => offer.id), locale);

  return offers.map(offer => ({
    ...overlay({ ...offer, discountValue: Number(offer.discountValue) }, translations.get(offer.id), ['title', 'description']),
    discountPence: toPence(offer.discountValue),
  }));
}

export default async function OffersPage() {
  const [locale, t] = await Promise.all([getLocale(), getT('offers')]);
  // Offers and discount codes are paused (pricing/policy.ts): no booking will
  // honour one, so none is listed and the database is not read. The records
  // stay in the admin panel for when discounts return.
  const offers = DISCOUNTS_PAUSED ? null : await getOffers(locale);
  const url = (path: string) => `${SITE_URL}${localizeHref(locale, path) === '/' ? '' : localizeHref(locale, path)}`;
  const fallbackLang = (translated: boolean) => (locale === 'en-GB' || translated ? undefined : 'en');

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: url('/') },
              { '@type': 'ListItem', position: 2, name: t('breadcrumb.offers'), item: url('/offers') },
            ],
          }),
        }}
      />
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/offers-hero.webp"
            alt={t('hero.imageAlt')}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            {t('hero.titleStart')} <span className="text-zinc-400">{t('hero.titleEnd')}</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            {offers === null ? t('hero.pausedSubtitle') : t('hero.subtitle')}
          </p>
        </div>
      </section>

      {/* Offers Grid */}
      <section className="container mx-auto px-4 py-24">
        {offers === null ? (
          <div className="text-center py-20 px-6 max-w-2xl mx-auto border border-zinc-100 rounded-sm bg-zinc-50 mb-16">
            <h2 className="text-2xl font-serif text-zinc-900 mb-3">{t('paused.title')}</h2>
            <p className="text-zinc-600 font-light leading-relaxed mb-8">
              {t('paused.body')}
            </p>
            <Link
              href="/services"
              className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
            >
              {t('paused.cta')}
            </Link>
          </div>
        ) : offers.length === 0 ? (
          <div className="text-center py-20 max-w-2xl mx-auto border border-zinc-100 rounded-sm bg-zinc-50 mb-16">
            <h3 className="text-2xl font-serif text-zinc-400 mb-2">{t('empty.title')}</h3>
            <p className="text-zinc-500 font-light mb-6">
              {t('empty.body')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 md:gap-16">
            {offers.map((offer) => (
              <div 
                key={offer.id} 
                className="group relative bg-white border border-zinc-200 p-10 md:p-14 transition-all duration-500 hover:shadow-2xl hover:border-zinc-300 flex flex-col justify-between min-h-[360px]"
              >
                {/* Decorative Accent */}
                <div className="absolute top-0 left-0 w-full h-1 bg-zinc-900 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
                
                <div>
                  <div className="flex justify-between items-start mb-8">
                    <span className="inline-block px-4 py-1.5 border border-zinc-200 text-xs font-medium tracking-[0.15em] uppercase text-zinc-500">
                      {t('card.limitedTime')}
                    </span>
                    <div className="text-right">
                      <span className="block text-4xl md:text-5xl font-serif font-bold text-zinc-900 mb-1">
                        {offer.discountType === 'PERCENTAGE'
                          ? t('card.percentOff', { value: offer.discountValue })
                          : formatGBP(offer.discountPence, HTML_LANG[locale], { wholePounds: true })}
                      </span>
                      <span className="text-xs text-zinc-500 uppercase tracking-widest">{t('card.offService')}</span>
                    </div>
                  </div>

                  <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-6 group-hover:text-zinc-700 transition-colors tracking-tight" lang={fallbackLang(offer.translated)}>
                    {offer.title}
                  </h2>
                  
                  <div className="w-12 h-px bg-zinc-200 my-8 group-hover:w-24 transition-all duration-500" />
                  
                  <p className="text-zinc-600 font-light leading-relaxed mb-10 text-lg" lang={fallbackLang(offer.translated)}>
                    {offer.description}
                  </p>
                </div>

                <div className="pt-6">
                  <Link 
                    href="/book"
                    className="inline-flex items-center text-sm font-bold uppercase tracking-[0.2em] text-zinc-900 group-hover:text-zinc-600 transition-colors border-b border-transparent group-hover:border-zinc-300 pb-1"
                  >
                    {t('card.book')}
                    <svg className="w-4 h-4 ml-2 transform group-hover:translate-x-2 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
