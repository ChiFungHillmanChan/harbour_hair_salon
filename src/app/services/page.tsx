import type { Metadata } from 'next';
import { jsonLdScript } from '@/app/lib/json-ld';
import Image from 'next/image';
import prisma from '@/app/lib/prisma';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Hair Services & Pricing in Leeds',
  description: 'Full menu of haircuts, colouring, perms and treatments at Harbour Hair Salon, Leeds city centre. Prices from £10. Book online.',
  alternates: { canonical: '/services' },
  openGraph: {
    title: 'Hair Services & Pricing | Harbour Hair Salon Leeds',
    description: 'Full menu of haircuts, colouring, perms and treatments. Prices from £10. Book online.',
  },
};

// Revalidate data every hour
export const revalidate = 3600;

async function getServices() {
  const services = await prisma.service.findMany({
    orderBy: { category: 'asc' }
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

import { ServiceList } from '@/components/services/ServiceList';
import { Faq } from '@/components/seo/Faq';
import { getAllCategoryContent } from '@/app/services/category-content-service';
import { getFaqsByKey } from '@/app/services/faq-service';
import { SITE_URL } from '@/app/lib/site-url';

export default async function ServicesPage() {
  const [services, activeOffer, categoryContents, servicesFaqs] = await Promise.all([
    getServices(),
    getGlobalOffer(),
    getAllCategoryContent(),
    getFaqsByKey('services-master'),
  ]);
  
  // Group services by category
  const groupedServices = services.reduce((acc, service) => {
    if (!acc[service.category]) {
      acc[service.category] = [];
    }
    acc[service.category].push(service);
    return acc;
  }, {} as Record<string, typeof services>);

  // Custom sort order
  const sortOrder = ['Haircuts', 'Colouring', 'Perms', 'Treatments', 'Styling'];
  const categories = Object.keys(groupedServices).sort((a, b) => {
    const indexA = sortOrder.findIndex(key => a.includes(key));
    const indexB = sortOrder.findIndex(key => b.includes(key));
    
    // If both are in the list, sort by index
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    // If a is in list, it comes first
    if (indexA !== -1) return -1;
    // If b is in list, it comes first
    if (indexB !== -1) return 1;
    // Otherwise alphabetical
    return a.localeCompare(b);
  });

  // Build Service structured data
  const serviceSchemaItems = services.map(service => ({
    '@type': 'Service' as const,
    name: service.name,
    description: service.description || `${service.name} at Harbour Hair Salon`,
    offers: {
      '@type': 'Offer' as const,
      price: service.price.toFixed(2),
      priceCurrency: 'GBP',
    },
    provider: {
      '@type': 'HairSalon' as const,
      name: 'Harbour Hair Salon',
    },
  }));

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'OfferCatalog',
            name: 'Harbour Hair Salon Services',
            itemListElement: serviceSchemaItems,
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
              { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
              { '@type': 'ListItem', position: 2, name: 'Services & Pricing', item: `${SITE_URL}/services` },
            ],
          }),
        }}
      />
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/services-hero.webp"
            alt="Hair styling services at Harbour Hair Salon Leeds"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Services & <span className="text-zinc-400">Pricing</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Expertly crafted hair services in Leeds city centre, tailored to your unique style.
          </p>
        </div>
      </section>

      {/* Services Menu */}
      <div className="container mx-auto px-4 py-20 max-w-4xl">
        {activeOffer && (
          <div className="bg-zinc-50 border border-zinc-200 p-4 text-center mb-12 rounded-lg">
            <p className="text-zinc-900 font-medium">
              <span className="font-bold uppercase tracking-wider text-xs bg-black text-white px-2 py-1 rounded mr-2">Special Offer</span>
              {activeOffer.title} - {activeOffer.discountType === 'PERCENTAGE' ? `${activeOffer.discountValue}% OFF` : `£${activeOffer.discountValue.toFixed(2)} OFF`} all services
            </p>
          </div>
        )}

        <ServiceList
          groupedServices={groupedServices}
          categories={categories}
          activeOffer={activeOffer}
          categorySlugs={Object.fromEntries(
            categoryContents.map((c) => [c.category, c.slug])
          )}
        />

        <div className="mt-20 text-center">
           <Link
             href="/book"
             className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-black transition-all"
           >
             Book Appointment
           </Link>
        </div>
      </div>
      {servicesFaqs.length > 0 && (
        <Faq
          title="Service FAQs"
          intro="Common questions about our haircuts, colouring, perms and treatments in Leeds."
          items={servicesFaqs.map((f) => ({ question: f.question, answer: f.answer }))}
        />
      )}
    </div>
  );
}
