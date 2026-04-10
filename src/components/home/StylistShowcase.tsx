'use client';

import { Stylist } from '@prisma/client';
import Link from 'next/link';
import { useState } from 'react';
import { Reveal } from './Reveal';

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
          className="w-full h-full object-cover transition-transform duration-[1200ms] ease-apple group-hover:scale-[1.06]"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
          <span className="text-6xl font-serif text-accent">{stylist.name.charAt(0)}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-apple" />
    </div>
  );
}

export function StylistShowcase({ stylists }: { stylists: Stylist[] }) {
  return (
    <section id="team" className="relative py-28 bg-zinc-900 text-white overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-accent/5 blur-3xl" />
      <div className="relative container mx-auto px-4">
        <Reveal className="text-center mb-16">
          <p className="text-sm uppercase tracking-[0.35em] text-accent mb-4 font-medium">
            Our Team
          </p>
          <h2 className="text-4xl md:text-6xl font-serif mb-6 tracking-tight">
            Meet The <span className="italic text-zinc-400">Stylist</span>
          </h2>
          <div className="w-16 h-[2px] bg-accent mx-auto mb-6" />
          <p className="text-zinc-400 max-w-2xl mx-auto font-light leading-relaxed">
            Chan, an experienced stylist with Hong Kong training, delivers tailored haircuts and grooming services with meticulous attention to detail.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-1 md:max-w-lg gap-8 mx-auto">
          {stylists.map((stylist, index) => (
            <Reveal
              key={stylist.id}
              variant="scale"
              delay={index * 120}
              className="group bg-zinc-800/50 overflow-hidden border border-zinc-700/50 hover:border-accent/40 transition-all duration-700 ease-apple hover:shadow-[0_30px_80px_-20px_rgba(201,169,110,0.25)] hover:-translate-y-1"
            >
              <Link href={`/stylists/${slugifyName(stylist.name)}`} className="block">
                <StylistPortrait stylist={stylist} />
                <div className="p-8 text-center">
                  <h3 className="text-xl font-serif font-medium mb-1 text-white group-hover:text-accent transition-colors">{stylist.name}</h3>
                  <p className="text-accent text-sm uppercase tracking-wider mb-4">{stylist.role}</p>
                  <div className="w-8 h-[1px] bg-zinc-700 mx-auto mb-4" />
                  <p className="text-zinc-400 text-sm italic font-light leading-relaxed mb-6">
                    &ldquo;{stylist.bio}&rdquo;
                  </p>
                  <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] font-bold text-accent">
                    View profile
                    <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>

        <div className="text-center mt-16">
          <Link
            href="/stylists"
            className="inline-flex items-center gap-2 border border-white/40 text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-medium hover:bg-white/10 hover:border-white/70 transition-all duration-500 ease-apple"
          >
            Meet the whole team
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
