import prisma from '@/app/lib/prisma';
import { Service, Offer } from '@prisma/client';
import Link from 'next/link';

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
  const sortOrder = ['Haircuts', 'Colouring', 'Treatments'];
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

  const getDiscountedPrice = (price: number) => {
    if (!activeOffer) return null;
    if (activeOffer.discountType === 'PERCENTAGE') {
      return price - (price * (activeOffer.discountValue / 100));
    }
    return Math.max(0, price - activeOffer.discountValue);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[url('https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2574&auto=format&fit=crop')] bg-cover bg-center" />
        <div className="relative z-10 container mx-auto px-4 text-center">
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">
            Our <span className="italic text-zinc-400">Menu</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            Expertly crafted services tailored to your unique style and preferences.
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

        <div className="space-y-20">
          {categories.map((category) => (
            <div key={category}>
              <h2 className="text-3xl font-serif text-zinc-900 mb-8 text-center relative">
                <span className="relative z-10 bg-white px-6">{category}</span>
                <div className="absolute top-1/2 left-0 w-full h-px bg-zinc-200 -z-0" />
              </h2>
              
              <div className="grid grid-cols-1 gap-8">
                {groupedServices[category].map((service) => {
                  const discountedPrice = getDiscountedPrice(service.price);
                  
                  return (
                    <div key={service.id} className="group flex justify-between items-baseline border-b border-zinc-100 pb-4 hover:border-zinc-300 transition-colors">
                      <div className="pr-8">
                        <h3 className="text-xl font-serif text-zinc-900 mb-1 group-hover:text-zinc-600 transition-colors">
                          {service.name}
                        </h3>
                        {service.description && (
                          <p className="text-zinc-500 font-light text-sm leading-relaxed mb-2">
                            {service.description}
                          </p>
                        )}
                        <span className="text-xs text-zinc-400 uppercase tracking-wider">
                          {service.duration} mins
                        </span>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        {discountedPrice !== null ? (
                          <div className="flex flex-col items-end">
                            <span className="text-sm text-zinc-400 line-through decoration-zinc-400/50">
                              £{service.price.toFixed(2)}
                            </span>
                            <span className="text-xl font-medium text-red-700 font-serif">
                              £{discountedPrice.toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xl font-medium text-zinc-900 font-serif">
                            £{service.price.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-20 text-center">
           <Link 
             href="/book"
             className="inline-block bg-zinc-900 text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-800 transition-all"
           >
             Book Appointment
           </Link>
        </div>
      </div>
    </div>
  );
}
