import { Service } from '@prisma/client';

export function ServiceMenu({ services }: { services: (Omit<Service, 'price'> & { price: number })[] }) {
  const categories = Array.from(new Set(services.map(s => s.category)));

  return (
    <section id="services" className="py-20 bg-white text-zinc-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-serif mb-4">Our Services</h2>
          <div className="w-24 h-1 bg-black mx-auto" />
        </div>

        <div className="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
          {categories.map(category => (
            <div key={category}>
              <h3 className="text-2xl font-serif mb-6 uppercase tracking-widest border-b border-zinc-200 pb-2">
                {category}
              </h3>
              <div className="space-y-6">
                {services
                  .filter(s => s.category === category)
                  .map(service => (
                    <div key={service.id} className="flex justify-between items-baseline group cursor-default">
                      <div className="flex-1 pr-8">
                        <h4 className="font-medium text-lg group-hover:text-zinc-600 transition-colors">
                          {service.name}
                        </h4>
                        <p className="text-zinc-500 text-sm mt-1">{service.description}</p>
                      </div>
                      <div className="text-lg font-serif whitespace-nowrap">
                        £{service.price.toFixed(2)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
