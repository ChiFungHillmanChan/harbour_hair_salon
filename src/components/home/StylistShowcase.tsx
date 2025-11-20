import { Stylist } from '@prisma/client';

export function StylistShowcase({ stylists }: { stylists: Stylist[] }) {
  return (
    <section id="team" className="py-20 bg-zinc-100 text-zinc-900">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-serif mb-4">Meet The Team</h2>
          <p className="text-zinc-600 max-w-2xl mx-auto">
            Chan, an experienced barber, delivers tailored haircuts and grooming services with meticulous attention to detail.
          </p>
        </div>

        <div className="grid md:grid-cols-1 md:max-w-md gap-8 mx-auto">
          {stylists.map(stylist => (
            <div key={stylist.id} className="bg-white shadow-sm group overflow-hidden">
              <div className="aspect-[3/4] bg-zinc-200 relative overflow-hidden">
                {/* Placeholder for image since we don't have real uploads yet */}
                <div className="absolute inset-0 bg-zinc-300 flex items-center justify-center text-zinc-400">
                  {stylist.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img 
                      src={stylist.imageUrl}
                      alt={stylist.name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <span className="text-4xl font-serif">{stylist.name.charAt(0)}</span>
                  )}
                </div>
              </div>
              <div className="p-6 text-center">
                <h3 className="text-xl font-medium mb-1">{stylist.name}</h3>
                <p className="text-zinc-500 text-sm uppercase tracking-wider mb-4">{stylist.role}</p>
                <p className="text-zinc-600 text-sm italic">
                  &ldquo;{stylist.bio}&rdquo;
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
