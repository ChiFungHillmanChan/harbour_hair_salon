'use client';

import { Stylist } from '@prisma/client';
import { useState } from 'react';

function StylistPortrait({ stylist }: { stylist: Stylist }) {
  const [loadFailed, setLoadFailed] = useState(false);
  const showImage = stylist.imageUrl && !loadFailed;

  return (
    <div className="aspect-[3/4] bg-zinc-800 relative overflow-hidden">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stylist.imageUrl!}
          alt={`${stylist.name} - ${stylist.role} at Harbour Hair Salon Leeds`}
          width={448}
          height={597}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
          <span className="text-6xl font-serif text-accent">{stylist.name.charAt(0)}</span>
        </div>
      )}
    </div>
  );
}

export function StylistShowcase({ stylists }: { stylists: Stylist[] }) {
  return (
    <section id="team" className="py-24 bg-zinc-900 text-white">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <p className="text-sm uppercase tracking-[0.3em] text-accent mb-4 font-medium">
            Our Team
          </p>
          <h2 className="text-3xl md:text-5xl font-serif mb-6">
            Meet The <span className="italic text-zinc-400">Stylist</span>
          </h2>
          <div className="w-16 h-[2px] bg-accent mx-auto mb-6" />
          <p className="text-zinc-400 max-w-2xl mx-auto font-light leading-relaxed">
            Chan, an experienced stylist with Hong Kong training, delivers tailored haircuts and grooming services with meticulous attention to detail.
          </p>
        </div>

        <div className="grid md:grid-cols-1 md:max-w-lg gap-8 mx-auto">
          {stylists.map(stylist => (
            <div key={stylist.id} className="bg-zinc-800/50 group overflow-hidden border border-zinc-700/50 hover:border-accent/30 transition-all duration-500">
              <StylistPortrait stylist={stylist} />
              <div className="p-8 text-center">
                <h3 className="text-xl font-serif font-medium mb-1 text-white">{stylist.name}</h3>
                <p className="text-accent text-sm uppercase tracking-wider mb-4">{stylist.role}</p>
                <div className="w-8 h-[1px] bg-zinc-700 mx-auto mb-4" />
                <p className="text-zinc-400 text-sm italic font-light leading-relaxed">
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
