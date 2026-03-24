import type { Metadata } from 'next';
import prisma from '@/app/lib/prisma';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Hair Services & Pricing in Leeds',
  description: 'Full menu of haircuts, colouring, perms and treatments at Harbour Hair Salon, Leeds city centre. Prices from £8. Book online.',
  alternates: { canonical: '/services' },
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

export default async function ServicesPage() {
  const [services, activeOffer] = await Promise.all([
    getServices(),
    getGlobalOffer()
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

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="/images/services-hero.png"
            alt="Hair styling services at Harbour Hair Salon Leeds"
            className="w-full h-full object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-[var(--accent)] mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Services & <span className="italic text-zinc-400">Pricing</span>
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
        />

        <div className="mt-20 text-center">
           <Link
             href="/book"
             className="inline-block bg-[var(--accent)] text-black px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-light)] transition-all"
           >
             Book Appointment
           </Link>
        </div>
      </div>
    </div>
  );
}
