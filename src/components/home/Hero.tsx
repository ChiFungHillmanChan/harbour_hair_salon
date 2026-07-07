'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

// Current copy, kept as the fallback so the hero renders sensibly even if a
// prop is omitted or (defensively) stored as an empty string in SiteSettings.
const DEFAULT_EYEBROW = 'Leeds City Centre';
const DEFAULT_TITLE_LINE1 = 'Expert Hair';
const DEFAULT_TITLE_LINE2 = 'Styling';
const DEFAULT_SUBTITLE =
  'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.';

interface HeroProps {
  eyebrow?: string;
  titleLine1?: string;
  titleLine2?: string;
  subtitle?: string;
}

export function Hero({
  eyebrow = DEFAULT_EYEBROW,
  titleLine1 = DEFAULT_TITLE_LINE1,
  titleLine2 = DEFAULT_TITLE_LINE2,
  subtitle = DEFAULT_SUBTITLE,
}: HeroProps) {
  const bgRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Belt and braces: fall back on empty strings too, not just undefined props.
  const safeEyebrow = eyebrow.trim() || DEFAULT_EYEBROW;
  const safeTitleLine1 = titleLine1.trim() || DEFAULT_TITLE_LINE1;
  const safeTitleLine2 = titleLine2.trim() || DEFAULT_TITLE_LINE2;
  const safeSubtitle = subtitle.trim() || DEFAULT_SUBTITLE;

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const bg = bgRef.current;
        const content = contentRef.current;
        if (bg) {
          // Parallax background: moves slower than scroll and subtly zooms.
          bg.style.transform = `translate3d(0, ${scrollY * 0.35}px, 0) scale(${1 + scrollY * 0.0005})`;
        }
        if (content) {
          // Content fades + lifts slightly as user scrolls — Apple-style.
          const fade = Math.max(0, 1 - scrollY / 600);
          content.style.opacity = String(fade);
          content.style.transform = `translate3d(0, ${scrollY * 0.18}px, 0)`;
        }
        rafId = 0;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section className="relative h-[78vh] min-h-[520px] md:h-[100vh] md:min-h-[680px] flex items-center justify-center bg-zinc-900 text-white overflow-hidden">
      {/* Background layer with parallax + initial slow zoom */}
      <div ref={bgRef} className="absolute inset-0 will-change-transform">
        <div className="absolute inset-0 hero-zoom">
          <Image
            src="/images/hero-salon.webp"
            alt="Harbour Hair Salon interior in Leeds Central Arcade"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/30" />
        {/* Soft vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_55%,rgba(0,0,0,0.65)_100%)]" />
      </div>

      {/* Content layer */}
      <div
        ref={contentRef}
        className="relative z-10 text-center max-w-4xl px-4 will-change-transform"
      >
        <div className="hero-rise hero-rise-0 w-12 md:w-16 h-px bg-white/50 mx-auto mb-5 md:mb-8" />

        <p className="hero-rise hero-rise-1 text-[11px] md:text-sm uppercase tracking-[0.2em] md:tracking-[0.25em] text-zinc-300 mb-4 md:mb-6 font-medium">
          {safeEyebrow}
        </p>

        <h1 className="text-[2.75rem] md:text-7xl lg:text-8xl font-serif mb-5 md:mb-6 tracking-tight leading-[0.95]">
          <span className="hero-rise hero-rise-2 block">{safeTitleLine1}</span>
          <span className="hero-rise hero-rise-3 block text-zinc-400 font-light">{safeTitleLine2}</span>
        </h1>

        <p className="hero-rise hero-rise-4 text-base md:text-xl text-zinc-300 mb-8 md:mb-10 max-w-2xl mx-auto font-light leading-relaxed px-2">
          {safeSubtitle}
        </p>

        <div className="hero-rise hero-rise-5 flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4">
          <Link
            href="/book"
            className="group inline-flex items-center justify-center gap-2 bg-white text-zinc-900 px-7 md:px-10 py-3 md:py-4 text-[13px] md:text-sm uppercase tracking-[0.12em] md:tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all duration-500 ease-apple hover:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)] hover:-translate-y-0.5"
          >
            Book Appointment
            <svg className="w-4 h-4 transition-transform duration-500 ease-apple group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
          <Link
            href="/services"
            className="inline-flex items-center justify-center border border-white/40 text-white px-7 md:px-10 py-3 md:py-4 text-[13px] md:text-sm uppercase tracking-[0.12em] md:tracking-[0.15em] font-medium hover:bg-white/10 hover:border-white/70 transition-all duration-500 ease-apple"
          >
            View Services
          </Link>
        </div>

        <div className="hero-rise hero-rise-5 w-12 md:w-16 h-px bg-white/50 mx-auto mt-8 md:mt-12" />
      </div>

      {/* Scroll indicator — pinned to viewport, parallax-independent */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 scroll-hint pointer-events-none">
        <svg className="w-6 h-6 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </div>
    </section>
  );
}
