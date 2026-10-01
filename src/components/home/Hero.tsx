'use client';

import Image from 'next/image';
import Link from '@/i18n/link';
import type { ReactNode } from 'react';
import { useT } from '@/i18n/client';

interface HeroProps {
  eyebrow?: string;
  titleLine1?: string;
  titleLine2?: string;
  subtitle?: string;
  bookingActions?: ReactNode;
}

export function Hero({
  eyebrow = '',
  titleLine1 = '',
  titleLine2 = '',
  subtitle = '',
  bookingActions,
}: HeroProps) {
  const t = useT('home');

  // Preserve the salon's saved copy; use the dictionary only for blank fields.
  const safeEyebrow = eyebrow.trim() || t('hero.defaultEyebrow');
  const safeTitleLine1 = titleLine1.trim() || t('hero.defaultTitleLine1');
  const safeTitleLine2 = titleLine2.trim() || t('hero.defaultTitleLine2');
  const safeSubtitle = subtitle.trim() || t('hero.defaultSubtitle');

  return (
    <section className="relative flex items-center justify-center overflow-hidden bg-zinc-900 px-5 py-10 text-white sm:py-14 md:min-h-[660px] md:py-20">
      <div className="absolute inset-0">
        <Image
          src="/images/hero-salon.webp"
          alt={t('hero.imageAlt')}
          fill
          loading="eager"
          fetchPriority="high"
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/65" />
      </div>

      {/* No entrance delay or scroll fading: booking stays readable immediately. */}
      <div className="relative z-10 w-full max-w-4xl text-center">
        <p className="mb-4 text-sm font-medium text-zinc-200 md:mb-5 md:text-base">
          {safeEyebrow}
        </p>

        <h1 className="mb-4 font-serif text-[2.5rem] leading-[1.02] tracking-tight sm:text-6xl md:mb-5 md:text-7xl lg:text-8xl">
          <span className="block">{safeTitleLine1}</span>
          <span className="block">{safeTitleLine2}</span>
        </h1>

        <p className="mx-auto mb-6 max-w-xl text-sm leading-relaxed text-zinc-200 sm:text-base md:mb-8 md:text-lg">
          {safeSubtitle}
        </p>

        {bookingActions ?? (
          <Link
            href="/book"
            className="inline-flex min-h-12 items-center justify-center bg-white px-7 py-3 font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {t('hero.bookAppointment')}
          </Link>
        )}

        <Link
          href="/services"
          className="mt-4 inline-flex min-h-11 items-center justify-center px-3 text-sm text-white underline underline-offset-4 transition-colors hover:text-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          {t('hero.viewServices')}
        </Link>
      </div>
    </section>
  );
}
