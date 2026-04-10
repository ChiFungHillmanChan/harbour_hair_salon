import type { Metadata } from 'next';
import prisma from '@/app/lib/prisma';
import { Hero } from '@/components/home/Hero';
import { ServiceMenu } from '@/components/home/ServiceMenu';
import { StylistShowcase } from '@/components/home/StylistShowcase';
import { Faq } from '@/components/seo/Faq';
import { getAggregateRating } from '@/app/services/review-service';
import {
  getSiteSettings,
  buildSameAsArray,
} from '@/app/services/site-settings-service';
import { getFaqsByKey } from '@/app/services/faq-service';
import { getSession } from '@/app/lib/session';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Expert Hair Styling in Leeds City Centre',
  description: 'Book your appointment at Harbour Hair Salon, Central Arcade, Leeds. Expert cuts, colours, perms and grooming by Hong Kong trained stylists.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Harbour Hair Salon | Expert Hair Styling in Leeds',
    description: 'Professional hair salon in Leeds city centre. Book online today.',
  },
};

// Revalidate data every hour
export const revalidate = 3600;

const POPULAR_SERVICE_NAMES = [
  'Short Over Ears - Wash, Haircut & Blow Dry (Student & NHS)',
  'Short Over Ears - Wash, Haircut & Blow Dry',
  'Children (Up to 12Yr) - Short Over Ears',
  'Children (Up to 12Yr) - Long Hair',
  'Heat Set Add-on',
  'Shampoo & Blow Dry - Short Over Ears (Student & NHS)',
  'Shampoo & Blow Dry - Short Over Ears',
  'Shampoo & Blow Dry - Long Over Ears (Student & NHS)',
  'Shampoo & Blow Dry - Long Over Ears',
  'Patch Test',
];

async function getPopularServices() {
  const services = await prisma.service.findMany({
    where: {
      name: {
        in: POPULAR_SERVICE_NAMES
      }
    },
    orderBy: { price: 'asc' }
  });
  
  // Convert Decimal to number for client components
  return services.map(service => ({
    ...service,
    price: Number(service.price)
  }));
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
  return prisma.stylist.findMany({
    orderBy: { name: 'asc' }
  });
}

export default async function Home() {
  const session = await getSession();
  if (session?.role === 'ADMIN') {
    redirect('/admin');
  }

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
    url: 'https://harbourhairsalon.co.uk',
    image: 'https://harbourhairsalon.co.uk/images/og-image.png',
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
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday'], opens: '10:00', closes: '19:30' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday','Sunday'], opens: '10:30', closes: '18:00' },
    ],
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hairSalonSchema) }}
      />
      <Hero />
      <ServiceMenu
        services={services}
        activeOffer={activeOffer}
        title="Popular Services"
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
    </div>
  );
}
