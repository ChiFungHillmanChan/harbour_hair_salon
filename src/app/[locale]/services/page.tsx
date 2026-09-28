import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import Image from 'next/image';
import Link from '@/i18n/link';
import { ServiceList } from '@/components/services/ServiceList';
import { Faq } from '@/components/seo/Faq';
import { getAllCategoryContent } from '@/app/services/category-content-service';
import { getFaqsByKey } from '@/app/services/faq-service';
import { getPublicCatalog } from '@/app/services/pricing/public-catalog';
import { serviceSchemaItems } from '@/app/services/pricing/json-ld';
import { SITE_URL } from '@/app/lib/site-url';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('services')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/services'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.ogDescription'),
    },
  };
}

// Revalidate data every hour
export const revalidate = 3600;

export default async function ServicesPage() {
  const locale = await getLocale();
  const [t, tp, catalog, categoryContents, servicesFaqs] = await Promise.all([
    getT('services'),
    getT('pricing'),
    getPublicCatalog(locale),
    getAllCategoryContent(locale),
    getFaqsByKey('services-master', locale),
  ]);

  // Build Service structured data from the same catalogue the page shows.
  const serviceSchemaItemsList = serviceSchemaItems(
    catalog.categories.flatMap((group) => group.entries),
    {
      hairLength: (length) => tp.dynamic(`hairLength.${length}`),
      describe: (name) => t('jsonLd.serviceAt', { name }),
    },
    { provider: { '@type': 'HairSalon', name: 'Harbour Hair Salon' } },
  );

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'OfferCatalog',
            name: t('jsonLd.catalogName'),
            inLanguage: locale,
            itemListElement: serviceSchemaItemsList,
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: `${SITE_URL}${localizeHref(locale, '/') === '/' ? '' : localizeHref(locale, '/')}` },
              { '@type': 'ListItem', position: 2, name: t('breadcrumb.servicesPricing'), item: `${SITE_URL}${localizeHref(locale, '/services')}` },
            ],
          }),
        }}
      />
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/services-hero.webp"
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
            {t('hero.subtitle')}
          </p>
        </div>
      </section>

      {/* Services Menu. No offer banner: site-wide offers are paused, and a
          banner for a discount no booking honours would mislead. */}
      <div className="container mx-auto px-4 py-20 max-w-5xl">
        <ClientMessages namespaces={['pricing']} sections={{ services: ['list'] }}>
          <ServiceList
            categories={catalog.categories}
            categorySlugs={Object.fromEntries(
              categoryContents.map((c) => [c.category, c.slug])
            )}
          />
        </ClientMessages>

        <div className="mt-20 text-center">
           <Link
             href="/book"
             className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
           >
             {t('book')}
           </Link>
        </div>
      </div>
      {servicesFaqs.length > 0 && (
        <Faq
          title={t('faqTitle')}
          intro={t('faqIntro')}
          items={servicesFaqs.map((f) => ({ question: f.question, answer: f.answer, lang: locale !== 'en-GB' && !f.translated ? 'en' : undefined }))}
        />
      )}
    </div>
  );
}
