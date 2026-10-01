import type { Metadata } from 'next';
import Link from '@/i18n/link';
import { OG_BASE } from '@/app/lib/og-defaults';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import SalonTour from './SalonTour';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('salon3d')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/about'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.description'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('meta.ogTitle'),
      description: t('meta.description'),
      images: OG_BASE.images,
    },
  };
}

export default async function AboutPage() {
  const [t, locale] = await Promise.all([getT('salon3d'), getLocale()]);

  return (
    <div className="bg-white text-zinc-900 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-black">
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
        <h1 className="max-w-4xl text-4xl font-serif leading-tight text-black sm:text-5xl lg:text-6xl">{t('heading')}</h1>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
          <p className="max-w-2xl text-lg leading-relaxed text-zinc-700 sm:text-xl">{t('intro')}</p>
          <p className="max-w-xl leading-relaxed text-zinc-600">{t('welcome')}</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/book" className="inline-flex min-h-12 items-center justify-center bg-black px-7 py-3 font-semibold text-white hover:bg-zinc-800">{t('book')}</Link>
          <Link href="/services" className="inline-flex min-h-12 items-center justify-center border border-zinc-300 px-7 py-3 font-semibold hover:bg-zinc-100">{t('services')}</Link>
        </div>
      </section>

      <section aria-labelledby="about-services" className="border-y border-zinc-200 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 id="about-services" className="text-3xl font-serif sm:text-4xl">{t('approach.heading')}</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3 md:gap-12">
            <div>
              <h3 className="text-xl font-semibold">{t('approach.cutTitle')}</h3>
              <p className="mt-3 leading-relaxed text-zinc-600">{t('approach.cutBody')}</p>
              <Link href="/services" className="mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:text-zinc-600">{t('services')}</Link>
            </div>
            <div>
              <h3 className="text-xl font-semibold">{t('approach.colourTitle')}</h3>
              <p className="mt-3 leading-relaxed text-zinc-600">{t('approach.colourBody')}</p>
              <Link href="/services" className="mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:text-zinc-600">{t('services')}</Link>
            </div>
            <div>
              <h3 className="text-xl font-semibold">{t('approach.teamTitle')}</h3>
              <p className="mt-3 leading-relaxed text-zinc-600">{t('approach.teamBody')}</p>
              <Link href="/stylists" className="mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:text-zinc-600">{t('approach.teamLink')}</Link>
            </div>
          </div>
        </div>
      </section>

      <section id="salon-tour" aria-labelledby="salon-tour-heading" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <h2 id="salon-tour-heading" className="text-3xl font-serif sm:text-4xl">{t('tour.heading')}</h2>
            <p className="mt-3 leading-relaxed text-zinc-600">{t('tour.intro')}</p>
          </div>
          <Link href="/book" className="inline-flex min-h-12 items-center justify-center bg-black px-6 py-3 font-semibold text-white hover:bg-zinc-800">{t('book')}</Link>
        </div>
        <SalonTour
          locale={locale}
          title={t('tour.frameTitle')}
          previewAlt={t('tour.previewAlt')}
          startLabel={t('tour.start')}
          closeLabel={t('tour.close')}
          controls={t('tour.controls')}
        />
        <p className="mt-3 text-sm leading-relaxed text-zinc-500">{t('tour.note')}</p>
      </section>

      <section className="border-t border-zinc-200 bg-zinc-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-16 lg:px-8">
          <div>
            <h2 className="text-3xl font-serif sm:text-4xl">{t('visit.heading')}</h2>
            <p className="mt-4 max-w-md leading-relaxed text-zinc-600">{t('visit.address')}</p>
            <Link href="/hair-salon-leeds-city-centre" className="mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-4 hover:text-zinc-600">{t('visit.directions')}</Link>
          </div>
          <div>
            <p className="max-w-md text-lg leading-relaxed text-zinc-700">{t('visit.body')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/book" className="inline-flex min-h-12 items-center justify-center bg-black px-7 py-3 font-semibold text-white hover:bg-zinc-800">{t('book')}</Link>
              <Link href="/services" className="inline-flex min-h-12 items-center justify-center border border-zinc-300 px-7 py-3 font-semibold hover:bg-white">{t('services')}</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
