import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import Image from 'next/image';
import Link from '@/i18n/link';
import { notFound } from 'next/navigation';
import {
  getAllCategoryContent,
  getCategoryContentBySlug,
  getRelatedCategories,
} from '@/app/services/category-content-service';
import { Faq } from '@/components/seo/Faq';
import { getFaqsByKey } from '@/app/services/faq-service';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';
import { getPublicCatalog } from '@/app/services/pricing/public-catalog';
import { serviceSchemaItems } from '@/app/services/pricing/json-ld';
import { CategoryPriceList } from '@/components/services/CategoryPriceList';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';

export const revalidate = 3600;

export async function generateStaticParams() {
  const all = await getAllCategoryContent();
  return all.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const cat = await getCategoryContentBySlug(slug, locale);
  if (!cat) return {};

  return {
    title: cat.title,
    description: cat.metaDescription,
    alternates: alternatesFor(locale, `/services/${cat.slug}`),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: `${cat.title} | Harbour Hair Salon`,
      description: cat.metaDescription,
    },
  };
}

export default async function ServiceCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const cat = await getCategoryContentBySlug(slug, locale);
  if (!cat) notFound();

  const [t, tp, catalog, relatedResults, keyedFaqs] = await Promise.all([
    getT('services'),
    getT('pricing'),
    getPublicCatalog(locale),
    getRelatedCategories(cat.relatedSlugs.filter((relatedSlug) => relatedSlug !== slug), locale),
    getFaqsByKey(`category:${cat.slug}`, locale),
  ]);
  const related = relatedResults.filter((c): c is NonNullable<typeof c> => Boolean(c));
  // Same catalogue as the services list, booking wizard and JSON-LD: one
  // definition of every option and price. Offers are paused, so no banner.
  const entries = catalog.categories.find((group) => group.category === cat.category)?.entries ?? [];
  const categoryLabel = tp.dynamic(`categories.${cat.category}`, undefined, cat.category);
  const en = cat.translated ? undefined : 'en';

  // FAQs come from two admin screens: the JSON block on this category row, and
  // Faq rows saved under the key `category:<slug>` in Admin → FAQs. Show both,
  // de-duplicated by question so a repeated entry is not indexed twice.
  const seenQuestions = new Set<string>();
  const faqItems = [
    ...cat.faqs.map((f) => ({ ...f, translated: cat.translated })),
    ...keyedFaqs,
  ]
    .filter(({ question }) => {
      const key = question.trim().toLowerCase();
      if (seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    })
    .map(({ question, answer, translated }) => ({ question, answer, lang: locale !== 'en-GB' && !translated ? 'en' : undefined }));

  const url = (path: string) => `${BASE_URL}${localizeHref(locale, path) === '/' ? '' : localizeHref(locale, path)}`;
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: url('/') },
      { '@type': 'ListItem', position: 2, name: t('breadcrumb.servicesPricing'), item: url('/services') },
      { '@type': 'ListItem', position: 3, name: cat.title, item: url(`/services/${cat.slug}`) },
    ],
  };

  const servicesSchema = {
    '@context': 'https://schema.org',
    '@type': 'OfferCatalog',
    name: cat.title,
    description: cat.metaDescription,
    inLanguage: locale,
    itemListElement: serviceSchemaItems(
      entries,
      {
        hairLength: (length) => tp.dynamic(`hairLength.${length}`),
        describe: (name) => t('jsonLd.serviceAtLeeds', { name }),
      },
      {
        category: cat.category,
        provider: { '@type': 'HairSalon', name: 'Harbour Hair Salon', url: BASE_URL },
        areaServed: { '@type': 'City', name: 'Leeds' },
      },
    ),
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(servicesSchema) }}
      />

      {/* Hero */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/services-hero.webp"
            alt={t('category.heroImageAlt', { title: cat.title })}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <nav aria-label={t('breadcrumb.label')} className="mb-4 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/" className="hover:text-zinc-300">{t('breadcrumb.home')}</Link></li>
              <li aria-hidden="true">·</li>
              <li><Link href="/services" className="hover:text-zinc-300">{t('breadcrumb.services')}</Link></li>
              <li aria-hidden="true">·</li>
              <li className="text-zinc-200">{categoryLabel}</li>
            </ol>
          </nav>
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight" lang={en}>
            {cat.hero} <span className="text-zinc-400" lang={locale}>{t('category.heroSuffix')}</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed" lang={en}>
            {cat.intro}
          </p>
        </div>
      </section>

      {/* Long-form overview */}
      {cat.overview.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-3xl">
          <div className="prose-lg space-y-6 text-zinc-700 leading-relaxed font-light" lang={en}>
            {cat.overview.map((p, i) => (
              <p key={i} className="text-lg">
                {p}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Pricing table */}
      <section className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-12">
          <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
            {t('category.pricingTitle', { category: categoryLabel })}
          </h2>
        </div>

        {entries.length === 0 ? (
          <p className="p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-2xl">{t('category.pricingSoon')}</p>
        ) : (
          <ClientMessages namespaces={['pricing']}>
            <CategoryPriceList entries={entries} />
          </ClientMessages>
        )}
      </section>

      {/* What's included */}
      {cat.includes.length > 0 && (
        <section className="bg-zinc-50 border-y border-zinc-100 py-20">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="text-center mb-12">
              <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
                {t('category.includes')}
              </h2>
            </div>
            <ul className="grid md:grid-cols-2 gap-4" lang={en}>
              {cat.includes.map((item, i) => (
                <li key={i} className="flex items-start gap-3 bg-white p-5 rounded-lg border border-zinc-100">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-zinc-900/10 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-zinc-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-zinc-700 font-light leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Process */}
      {cat.process.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-3xl">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              {t('category.process')}
            </h2>
          </div>
          <ol className="space-y-8" lang={en}>
            {cat.process.map((p, i) => (
              <li key={i} className="flex gap-6">
                <span className="shrink-0 w-12 h-12 rounded-full border-2 border-zinc-300 flex items-center justify-center text-zinc-900 font-serif text-xl">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-xl font-serif text-zinc-900 mb-2">{p.step}</h3>
                  <p className="text-zinc-600 font-light leading-relaxed">{p.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Aftercare — the heading and tips are optional; the booking CTA is not. */}
      <section className="bg-zinc-900 text-white py-20">
        <div className="container mx-auto px-4 max-w-3xl">
          {cat.aftercare.length > 0 && (
            <>
              <div className="text-center mb-12">
                <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
                <h2 className="text-3xl md:text-4xl font-serif tracking-tight">
                  {t('category.aftercare')}
                </h2>
              </div>
              <ul className="space-y-4" lang={en}>
                {cat.aftercare.map((tip, i) => (
                  <li key={i} className="flex gap-4 items-start text-zinc-300 font-light leading-relaxed">
                    <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-white/50" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-12 text-center">
            <Link
              href="/book"
              className="inline-block bg-white text-zinc-900 px-12 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all"
            >
              {t('category.bookCategory', { category: categoryLabel })}
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ — omitted entirely when empty so no bare heading or empty FAQPage schema is emitted. */}
      {faqItems.length > 0 && (
        <Faq
          title={t('category.faqTitle', { category: categoryLabel })}
          intro={t('category.faqIntro', { category: locale === 'en-GB' ? categoryLabel.toLowerCase() : categoryLabel })}
          items={faqItems}
        />
      )}

      {/* Related */}
      {related.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-5xl border-t border-zinc-100">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              {t('category.related')}
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/services/${r.slug}`}
                className="group block bg-white border border-zinc-200 rounded-2xl p-8 hover:border-zinc-900 hover:shadow-lg transition-all"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">{t('category.explore')}</p>
                <h3 className="text-2xl font-serif text-zinc-900 mb-3 group-hover:text-zinc-700 transition-colors" lang={r.translated ? undefined : 'en'}>
                  {t('category.relatedTitle', { hero: r.hero })}
                </h3>
                <p className="text-zinc-600 font-light leading-relaxed" lang={r.translated ? undefined : 'en'}>{r.intro}</p>
                <span className="inline-flex items-center gap-2 mt-4 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                  {t('category.learnMore')}
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
