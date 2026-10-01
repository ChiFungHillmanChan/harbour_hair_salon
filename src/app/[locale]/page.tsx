import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import { Hero } from '@/components/home/Hero';
import { BookingQuickLinks } from '@/components/home/BookingQuickLinks';
import { ServiceMenu } from '@/components/home/ServiceMenu';
import { StylistShowcase } from '@/components/home/StylistShowcase';
import { SocialProofBar } from '@/components/home/SocialProofBar';
import { TrustBar } from '@/components/home/TrustBar';
import { Faq } from '@/components/seo/Faq';
import { getAggregateRating } from '@/app/services/review-service';
import {
  getSiteSettings,
  getHeroContent,
  buildSameAsArray,
} from '@/app/services/site-settings-service';
import { getFaqsByKey } from '@/app/services/faq-service';
import VisitFollowBlock from '@/components/home/VisitFollowBlock';
import { buildHairSalonSchema } from '@/app/lib/hair-salon-schema';
import { FooterPromotions } from '@/components/layout/Layout';
import { getPublicCatalog, type PriceListEntry } from '@/app/services/pricing/public-catalog';
import { getAllStylistsWithSlug } from '@/app/stylists/slug';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import type { Locale } from '@/i18n/config';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('home')]);
  return {
    // `absolute`: the root layout's "%s | Harbour Hair Salon Leeds" template does
    // not apply to a page in the layout's own segment, so without it the home
    // page was the only title on the site that did not name the salon.
    title: { absolute: t('meta.title') },
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/'),
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

// Homepage showcase, in display order: lead with signature, high-value work
// (balayage, premium colour, perms, treatments) and descend to everyday styling
// — instead of opening on entry-level add-ons like patch tests and heat sets.
//
// Items are chosen by their stable menu-item key (ServiceOffering.key), never
// by matching names, with a per-category fallback so a renamed or missing
// item still leaves the section full.
const FEATURED_PLAN: { category: string; keys: string[] }[] = [
  { category: 'Colouring', keys: ['balayage'] },
  { category: 'Colouring', keys: ['full-head-highlights'] },
  { category: 'Perms', keys: ['keratin-treatment', 'paimore-hot-perm'] },
  { category: 'Treatments', keys: ['inkarami-treatment'] },
  { category: 'Haircuts', keys: ['wash-cut-blow-dry'] },
  { category: 'Styling', keys: ['shampoo-blow-dry'] },
];

const entryCategory = (entry: PriceListEntry) => (entry.kind === 'offering' ? entry.offering.category : entry.service.category);
const entryId = (entry: PriceListEntry) => (entry.kind === 'offering' ? entry.offering.id : entry.service.id);
const entryTopPrice = (entry: PriceListEntry) => Math.max(...(entry.kind === 'offering' ? entry.options : [entry.service]).filter((o) => o.priceType !== 'NHS').map((o) => o.amountPence), 0);
const showcaseable = (entry: PriceListEntry) => entry.kind === 'offering'
  || !(entry.service.isPatchTest || entry.service.isConsultation || entry.service.surchargeBaseServiceId);

async function getFeaturedEntries(locale: Locale): Promise<PriceListEntry[]> {
  const catalog = await getPublicCatalog(locale);
  const pool = catalog.categories.flatMap((group) => group.entries).filter(showcaseable);
  const used = new Set<string>();
  const featured: PriceListEntry[] = [];
  for (const { category, keys } of FEATURED_PLAN) {
    const byKey = keys.map((key) => pool.find((entry) => entry.kind === 'offering' && entry.offering.key === key && !used.has(entryId(entry)))).find(Boolean);
    const fallback = pool
      .filter((entry) => entryCategory(entry) === category && !used.has(entryId(entry)))
      .sort((a, b) => entryTopPrice(b) - entryTopPrice(a))[0];
    const chosen = byKey ?? fallback;
    if (chosen) {
      used.add(entryId(chosen));
      featured.push(chosen);
    }
  }
  // Safety net: top up so the section is never sparse.
  for (const entry of [...pool].sort((a, b) => entryTopPrice(b) - entryTopPrice(a))) {
    if (featured.length >= 4) break;
    if (used.has(entryId(entry))) continue;
    used.add(entryId(entry));
    featured.push(entry);
  }
  return featured;
}

async function getStylists(locale: Locale) {
  // Only public-safe fields (the helper uses an explicit projection), in the
  // page's language; names are never translated.
  const stylists = await getAllStylistsWithSlug(locale);
  return stylists.map(({ id, name, role, imageUrl, bio, translated }) => ({ id, name, role, imageUrl, bio, translated }));
}

export default async function Home() {
  const locale = await getLocale();
  const [t, ts, featured, stylists, aggregateRating, settings, hero, homeFaqs] = await Promise.all([
    getT('home'),
    getT('services'),
    getFeaturedEntries(locale),
    getStylists(locale),
    getAggregateRating(),
    getSiteSettings(),
    getHeroContent(locale),
    getFaqsByKey('home', locale),
  ]);

  const hairSalonSchema = buildHairSalonSchema(settings, {
    locale,
    description: t('page.schemaDescription'),
    sameAs: buildSameAsArray(settings),
  });

  return (
    <ClientMessages namespaces={['pricing']} sections={{ home: ['hero', 'stylists'], services: ['menu'] }}>
    <div className="flex flex-col min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(hairSalonSchema) }}
      />
      <Hero
        eyebrow={hero.heroEyebrow}
        titleLine1={hero.heroTitleLine1}
        titleLine2={hero.heroTitleLine2}
        subtitle={hero.heroSubtitle}
        bookingActions={<BookingQuickLinks settings={settings} />}
      />
      <SocialProofBar average={aggregateRating.average} count={aggregateRating.count} />
      <TrustBar treatwellUrl={settings.treatwellUrl} googleBusinessUrl={settings.googleBusinessUrl} />
      <ServiceMenu
        entries={featured}
        title={ts('menu.signatureTitle')}
        flatList={true}
      />
      <StylistShowcase stylists={stylists} />
      {homeFaqs.length > 0 && (
        <Faq
          title={t('page.faqTitle')}
          intro={t('page.faqIntro')}
          items={homeFaqs.map((f) => ({ question: f.question, answer: f.answer, lang: locale !== 'en-GB' && !f.translated ? 'en' : undefined }))}
        />
      )}
      <VisitFollowBlock />
      <FooterPromotions />
    </div>
    </ClientMessages>
  );
}
