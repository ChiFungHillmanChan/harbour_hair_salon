import { Service, Offer } from '@prisma/client';
import Link from 'next/link';

interface ServiceMenuProps {
  services: (Omit<Service, 'price'> & { price: number })[];
  activeOffer: (Omit<Offer, 'discountValue'> & { discountValue: number }) | null;
  title?: string;
  flatList?: boolean;
}

export function ServiceMenu({ services, activeOffer, title = "Our Services", flatList = false }: ServiceMenuProps) {
  const sortOrder = ['Haircuts', 'Colouring', 'Perms', 'Treatments', 'Styling'];
  const categories = Array.from(new Set(services.map(s => s.category))).sort((a, b) => {
    const indexA = sortOrder.indexOf(a);
    const indexB = sortOrder.indexOf(b);
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

  const renderServiceItem = (service: (Omit<Service, 'price'> & { price: number })) => {
    const discountedPrice = getDiscountedPrice(service.price);
    
    return (
      <div key={service.id} className="flex justify-between items-baseline group cursor-default py-3 border-b border-zinc-100 last:border-0">
        <div className="flex-1 pr-8">
          <h4 className="font-medium text-lg group-hover:text-zinc-600 transition-colors">
            {service.name}
          </h4>
          {service.description && (
            <p className="text-zinc-500 text-sm mt-1">{service.description}</p>
          )}
          {service.duration && (
             <span className="text-xs text-zinc-400 uppercase tracking-wider block mt-1">
              {service.duration} mins
            </span>
          )}
        </div>
        <div className="text-right whitespace-nowrap">
          {discountedPrice !== null ? (
            <>
              <span className="text-sm text-zinc-400 line-through mr-2">
                £{service.price.toFixed(2)}
              </span>
              <span className="text-lg font-serif text-red-600">
                £{discountedPrice.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="text-lg font-serif">
              £{service.price.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <section id="services" className="py-24 bg-white text-zinc-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <p className="text-sm uppercase tracking-[0.3em] text-accent mb-4 font-medium">What We Offer</p>
          <h2 className="text-3xl md:text-5xl font-serif mb-4">{title}</h2>
          <div className="w-16 h-[2px] bg-accent mx-auto" />
        </div>

        {flatList ? (
          <div className="max-w-4xl mx-auto">
             <div className="space-y-4">
                {services.map(service => renderServiceItem(service))}
             </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
            {categories.map(category => (
              <div key={category}>
                <h3 className="text-2xl font-serif mb-6 uppercase tracking-widest border-b border-zinc-200 pb-2">
                  {category}
                </h3>
                <div className="space-y-6">
                  {services
                    .filter(s => s.category === category)
                    .map(service => renderServiceItem(service))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* View All + Book links */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-16">
          <Link
            href="/services"
            className="text-sm uppercase tracking-[0.2em] font-medium text-zinc-600 hover:text-accent transition-colors border-b border-zinc-300 hover:border-accent pb-1"
          >
            View Full Menu
          </Link>
          <Link
            href="/book"
            className="inline-block bg-accent text-black px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-all"
          >
            Book Appointment
          </Link>
        </div>
      </div>
    </section>
  );
}
