import type { Metadata } from 'next';
import { jsonLdScript } from '@/app/lib/json-ld';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/app/lib/prisma';
import { publicServiceSelect } from '../public-service-select';
import {
  getAllCategoryContent,
  getCategoryContentBySlug,
  getRelatedCategories,
} from '@/app/services/category-content-service';
import { Faq } from '@/components/seo/Faq';
import { getFaqsByKey } from '@/app/services/faq-service';
import { SITE_URL as BASE_URL } from '@/app/lib/site-url';

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
  const cat = await getCategoryContentBySlug(slug);
  if (!cat) return {};

  return {
    title: cat.title,
    description: cat.metaDescription,
    alternates: { canonical: `/services/${cat.slug}` },
    openGraph: {
      title: `${cat.title} | Harbour Hair Salon`,
      description: cat.metaDescription,
    },
  };
}

async function getServicesForCategory(category: string) {
  const services = await prisma.service.findMany({
    where: { category },
    select: publicServiceSelect,
    orderBy: { price: 'asc' },
  });
  return services.map((s) => ({ ...s, price: Number(s.price) }));
}

async function getActiveGlobalOffer() {
  const offer = await prisma.offer.findFirst({
    where: { isActive: true, isGlobal: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!offer) return null;
  return { ...offer, discountValue: Number(offer.discountValue) };
}

function applyOffer(
  price: number,
  offer: { discountType: string; discountValue: number } | null
) {
  if (!offer) return null;
  if (offer.discountType === 'PERCENTAGE') {
    return price - price * (offer.discountValue / 100);
  }
  return Math.max(0, price - offer.discountValue);
}

export default async function ServiceCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = await getCategoryContentBySlug(slug);
  if (!cat) notFound();

  const [services, activeOffer, relatedResults, keyedFaqs] = await Promise.all([
    getServicesForCategory(cat.category),
    getActiveGlobalOffer(),
    getRelatedCategories(cat.relatedSlugs.filter((relatedSlug) => relatedSlug !== slug)),
    getFaqsByKey(`category:${cat.slug}`),
  ]);
  const related = relatedResults.filter((c): c is NonNullable<typeof c> => Boolean(c));

  // FAQs come from two admin screens: the JSON block on this category row, and
  // Faq rows saved under the key `category:<slug>` in Admin → FAQs. Show both,
  // de-duplicated by question so a repeated entry is not indexed twice.
  const seenQuestions = new Set<string>();
  const faqItems = [...cat.faqs, ...keyedFaqs]
    .filter(({ question }) => {
      const key = question.trim().toLowerCase();
      if (seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    })
    .map(({ question, answer }) => ({ question, answer }));

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE_URL },
      { '@type': 'ListItem', position: 2, name: 'Services & Pricing', item: `${BASE_URL}/services` },
      { '@type': 'ListItem', position: 3, name: cat.title, item: `${BASE_URL}/services/${cat.slug}` },
    ],
  };

  const servicesSchema = {
    '@context': 'https://schema.org',
    '@type': 'OfferCatalog',
    name: cat.title,
    description: cat.metaDescription,
    itemListElement: services.map((s) => ({
      '@type': 'Service',
      name: s.name,
      description: s.description || `${s.name} at Harbour Hair Salon, Leeds.`,
      category: cat.category,
      provider: {
        '@type': 'HairSalon',
        name: 'Harbour Hair Salon',
        url: BASE_URL,
      },
      areaServed: { '@type': 'City', name: 'Leeds' },
      offers: {
        '@type': 'Offer',
        price: s.price.toFixed(2),
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
      },
    })),
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
            alt={`${cat.title} at Harbour Hair Salon`}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <nav aria-label="Breadcrumb" className="mb-4 text-xs text-zinc-400 uppercase tracking-[0.2em]">
            <ol className="flex items-center justify-center gap-2">
              <li><Link href="/" className="hover:text-zinc-300">Home</Link></li>
              <li aria-hidden="true">·</li>
              <li><Link href="/services" className="hover:text-zinc-300">Services</Link></li>
              <li aria-hidden="true">·</li>
              <li className="text-zinc-200">{cat.category}</li>
            </ol>
          </nav>
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            {cat.hero} <span className="text-zinc-400">in Leeds</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            {cat.intro}
          </p>
        </div>
      </section>

      {/* Long-form overview */}
      {cat.overview.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-3xl">
          <div className="prose-lg space-y-6 text-zinc-700 leading-relaxed font-light">
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
            {cat.category} Pricing
          </h2>
          {activeOffer && (
            <p className="mt-4 inline-block px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-full text-sm text-zinc-700">
              <span className="font-bold uppercase tracking-wider text-xs bg-black text-white px-2 py-1 rounded mr-2">
                Offer
              </span>
              {activeOffer.title} —{' '}
              {activeOffer.discountType === 'PERCENTAGE'
                ? `${activeOffer.discountValue}% off`
                : `£${activeOffer.discountValue.toFixed(2)} off`}{' '}
              all services
            </p>
          )}
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden divide-y divide-zinc-100">
          {services.length === 0 ? (
            <p className="p-8 text-center text-zinc-500">Pricing coming soon. Please call the salon for details.</p>
          ) : (
            services.map((s) => {
              const discounted = applyOffer(s.price, activeOffer);
              return (
                <article
                  key={s.id}
                  className="flex items-center justify-between gap-6 p-5 md:p-6 hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base md:text-lg font-medium text-zinc-900">{s.name}</h3>
                    {s.description && (
                      <p className="text-sm text-zinc-500 mt-1 font-light">{s.description}</p>
                    )}
                    <p className="text-xs text-zinc-400 uppercase tracking-wider mt-2">
                      {s.duration} min
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {discounted !== null ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-zinc-400 line-through">£{s.price.toFixed(2)}</span>
                        <span className="text-lg font-serif font-bold text-zinc-900">£{discounted.toFixed(2)}</span>
                      </div>
                    ) : (
                      <span className="text-lg font-serif font-bold text-zinc-900">£{s.price.toFixed(2)}</span>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* What's included */}
      {cat.includes.length > 0 && (
        <section className="bg-zinc-50 border-y border-zinc-100 py-20">
          <div className="container mx-auto px-4 max-w-3xl">
            <div className="text-center mb-12">
              <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
                What&apos;s included
              </h2>
            </div>
            <ul className="grid md:grid-cols-2 gap-4">
              {cat.includes.map((item, i) => (
                <li key={i} className="flex items-start gap-3 bg-white p-5 rounded-lg border border-zinc-100">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-zinc-900/10 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-zinc-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
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
              What to expect
            </h2>
          </div>
          <ol className="space-y-8">
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
                  How to look after it
                </h2>
              </div>
              <ul className="space-y-4">
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
              Book {cat.category}
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ — omitted entirely when empty so no bare heading or empty FAQPage schema is emitted. */}
      {faqItems.length > 0 && (
        <Faq
          title={`${cat.category} FAQs`}
          intro={`Common questions about ${cat.category.toLowerCase()} at Harbour Hair Salon.`}
          items={faqItems}
        />
      )}

      {/* Related */}
      {related.length > 0 && (
        <section className="container mx-auto px-4 py-20 max-w-5xl border-t border-zinc-100">
          <div className="text-center mb-12">
            <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-serif text-zinc-900 tracking-tight">
              You might also like
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/services/${r.slug}`}
                className="group block bg-white border border-zinc-200 rounded-2xl p-8 hover:border-zinc-900 hover:shadow-lg transition-all"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 mb-2">Explore</p>
                <h3 className="text-2xl font-serif text-zinc-900 mb-3 group-hover:text-zinc-700 transition-colors">
                  {r.hero} in Leeds
                </h3>
                <p className="text-zinc-600 font-light leading-relaxed">{r.intro}</p>
                <span className="inline-flex items-center gap-2 mt-4 text-sm font-bold uppercase tracking-[0.15em] text-zinc-900 group-hover:text-zinc-600 transition-colors">
                  Learn more
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
