import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import { jsonLdScript } from '@/app/lib/json-ld';
import prisma from '@/app/lib/prisma';
import { publicServiceSelect } from '@/app/services/public-service-select';
import { Hero } from '@/components/home/Hero';
import { ServiceMenu } from '@/components/home/ServiceMenu';
import { StylistShowcase } from '@/components/home/StylistShowcase';
import { SocialProofBar } from '@/components/home/SocialProofBar';
import { TrustBar } from '@/components/home/TrustBar';
import { Faq } from '@/components/seo/Faq';
import { getAggregateRating } from '@/app/services/review-service';
import {
  getSiteSettings,
  buildSameAsArray,
} from '@/app/services/site-settings-service';
import { getFaqsByKey } from '@/app/services/faq-service';
import { SITE_URL } from '@/app/lib/site-url';
import VisitFollowBlock from '@/components/home/VisitFollowBlock';
import { openingHoursSpecification } from '@/app/lib/opening-hours-public';

export const metadata: Metadata = {
  title: 'Expert Hair Styling in Leeds City Centre',
  description: 'Book your appointment at Harbour Hair Salon, Central Arcade, Leeds. Expert cuts, colours, perms and grooming by Hong Kong trained stylists.',
  alternates: { canonical: '/' },
  openGraph: {
      ...OG_BASE,
    title: 'Harbour Hair Salon | Expert Hair Styling in Leeds',
    description: 'Professional hair salon in Leeds city centre. Book online today.',
  },
};

// Revalidate data every hour
export const revalidate = 3600;

// Homepage showcase, in display order: lead with signature, high-value work
// (balayage, premium colour, perms, treatments) and descend to everyday styling
// — instead of opening on entry-level add-ons like patch tests and heat sets.
//
// Selection is adaptive: we pick the flagship (highest-priced) service per
// category from whatever is in the catalogue, with an optional name preference.
// This survives price/name changes and seed-vs-production drift without needing
// a hand-maintained exact-name list.
const FEATURED_PLAN: { category: string; prefer?: RegExp }[] = [
  { category: 'Colouring', prefer: /balayage/i },
  { category: 'Colouring', prefer: /full head highlights/i },
  { category: 'Perms', prefer: /keratin|hot perm/i },
  { category: 'Treatments' },
  { category: 'Haircuts', prefer: /long hair - wash, ?haircut/i },
  { category: 'Styling', prefer: /shampoo & blow dry/i },
];

// Entry-level variants we never want to lead with on the homepage.
const SHOWCASE_EXCLUDE = /\((nhs|student[^)]*)\)|add-?on|patch test|consultation/i;

async function getPopularServices() {
  const all = await prisma.service.findMany({ select: publicServiceSelect });

  const showcaseable = all.filter(
    (s) => !s.isPatchTest && !SHOWCASE_EXCLUDE.test(s.name)
  );
  const pool = showcaseable.length > 0 ? showcaseable : all;

  const used = new Set<string>();
  const pickFlagship = ({ category, prefer }: { category: string; prefer?: RegExp }) => {
    const candidates = pool
      .filter((s) => s.category === category && !used.has(String(s.id)))
      .sort((a, b) => Number(b.price) - Number(a.price));
    const chosen = (prefer && candidates.find((s) => prefer.test(s.name))) || candidates[0];
    if (chosen) used.add(String(chosen.id));
    return chosen;
  };

  const featured = FEATURED_PLAN.map(pickFlagship).filter(
    (s): s is NonNullable<typeof s> => Boolean(s)
  );

  // Safety net: if the catalogue shape is unexpected and we matched too few,
  // top up with the highest-priced remaining services so the section is never sparse.
  if (featured.length < 4) {
    const extra = pool
      .filter((s) => !used.has(String(s.id)))
      .sort((a, b) => Number(b.price) - Number(a.price));
    for (const s of extra) {
      if (featured.length >= 6) break;
      used.add(String(s.id));
      featured.push(s);
    }
  }

  // Convert Decimal to number for client components.
  // Display cheapest first so visitors see an approachable entry point.
  return featured
    .map((service) => ({
      ...service,
      price: Number(service.price),
    }))
    .sort((a, b) => a.price - b.price);
}

async function getGlobalOffer() {
  const offer = await prisma.offer.findFirst({
    where: { isActive: true, isGlobal: true },
    orderBy: { createdAt: 'desc' }
  });

  if (!offer) return null;

  return {
    ...offer,
    discountValue: Number(offer.discountValue)
  };
}

async function getStylists() {
  // Only public-safe fields — the full row includes the secret treatwellIcalUrl,
  // which must never reach this client component / the RSC payload.
  return prisma.stylist.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, imageUrl: true, bio: true },
  });
}

export default async function Home() {
  const [services, stylists, activeOffer, aggregateRating, settings, homeFaqs] = await Promise.all([
    getPopularServices(),
    getStylists(),
    getGlobalOffer(),
    getAggregateRating(),
    getSiteSettings(),
    getFaqsByKey('home'),
  ]);

  const phoneDigits = settings.phone.replace(/\D/g, '');
  const telephoneE164 = phoneDigits.startsWith('0')
    ? `+44${phoneDigits.slice(1)}`
    : phoneDigits.startsWith('44')
      ? `+${phoneDigits}`
      : `+${phoneDigits}`;

  const hairSalonSchema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: 'Harbour Hair Salon',
    url: SITE_URL,
    image: `${SITE_URL}/images/og-image.png`,
    description:
      'Professional hair salon in Leeds city centre. Expert cuts, colours, perms and grooming by Hong Kong trained stylists.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Upper Floor, Unit 15 Central Arcade, Central Rd',
      addressLocality: 'Leeds',
      addressRegion: 'West Yorkshire',
      postalCode: 'LS1 6DX',
      addressCountry: 'GB',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 53.7965911,
      longitude: -1.5416801,
    },
    telephone: telephoneE164,
    priceRange: '$$',
    currenciesAccepted: 'GBP',
    paymentAccepted: 'Cash, Credit Card',
    areaServed: { '@type': 'City', name: 'Leeds' },
    sameAs: buildSameAsArray(settings),
    openingHoursSpecification: openingHoursSpecification(),
    knowsLanguage: ['en', 'zh-yue'],
  };

  if (aggregateRating.count > 0) {
    hairSalonSchema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: aggregateRating.average,
      reviewCount: aggregateRating.count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return (
    <div className="flex flex-col min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(hairSalonSchema) }}
      />
      <Hero
        eyebrow={settings.heroEyebrow}
        titleLine1={settings.heroTitleLine1}
        titleLine2={settings.heroTitleLine2}
        subtitle={settings.heroSubtitle}
      />
      <SocialProofBar average={aggregateRating.average} count={aggregateRating.count} />
      <TrustBar treatwellUrl={settings.treatwellUrl} googleBusinessUrl={settings.googleBusinessUrl} />
      <ServiceMenu
        services={services}
        activeOffer={activeOffer}
        title="Signature Services"
        flatList={true}
      />
      <StylistShowcase stylists={stylists} />
      {homeFaqs.length > 0 && (
        <Faq
          title="Your questions, answered"
          intro="Everything you need to know before your first visit to Harbour Hair Salon in Leeds."
          items={homeFaqs.map((f) => ({ question: f.question, answer: f.answer }))}
        />
      )}
      <VisitFollowBlock />
    </div>
  );
}
