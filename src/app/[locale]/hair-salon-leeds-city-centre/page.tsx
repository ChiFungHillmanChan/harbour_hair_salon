import type { Metadata } from 'next';
import Image from 'next/image';
import Link from '@/i18n/link';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';
import { OG_BASE } from '@/app/lib/og-defaults';
import { SITE_URL } from '@/app/lib/site-url';
import { jsonLdScript } from '@/app/lib/json-ld';
import { buildHairSalonSchema } from '@/app/lib/hair-salon-schema';
import { dayKey, dayRangeLabel, formatRange, groupedOpeningHours } from '@/app/lib/opening-hours-public';
import { toTelHref } from '@/app/lib/phone';
import { buildSameAsArray, getSiteSettings } from '@/app/services/site-settings-service';
import { BookingQuickLinks } from '@/components/home/BookingQuickLinks';

// Shares the existing settings cache; no additional database lookup or expiry.
export const revalidate = 3600;
const PAGE_PATH = '/hair-salon-leeds-city-centre';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('local')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, PAGE_PATH),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.description'),
      url: localizeHref(locale, PAGE_PATH),
    },
  };
}

// Local facts checked against Visit Leeds (Central Arcade / Corn Exchange)
// and Leeds City Council's markets.leeds.gov.uk on 1 October 2026. No journey
// times or building-access facilities are inferred from the map.
export default async function LeedsCityCentreSalon() {
  const [locale, t, tc, settings] = await Promise.all([
    getLocale(), getT('local'), getT('common'), getSiteSettings(),
  ]);
  const phoneHref = toTelHref(settings.phone);
  const pageUrl = `${SITE_URL}${localizeHref(locale, PAGE_PATH)}`;
  const homePath = localizeHref(locale, '/');
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      buildHairSalonSchema(settings, { locale, description: t('hero.intro'), sameAs: buildSameAsArray(settings) }),
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: t('meta.ogTitle'),
        description: t('meta.description'),
        inLanguage: locale,
        about: { '@id': `${SITE_URL}/#salon` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: `${SITE_URL}${homePath === '/' ? '' : homePath}` },
          { '@type': 'ListItem', position: 2, name: t('breadcrumb.local'), item: pageUrl },
        ],
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(schema) }} />

      <section className="bg-zinc-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-16">
          <nav aria-label={t('breadcrumb.local')} className="mb-8 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <Link href="/" className="hover:text-white">{t('breadcrumb.home')}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-zinc-200">{t('breadcrumb.local')}</span>
          </nav>
          <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">{t('hero.eyebrow')}</p>
              <h1 className="max-w-2xl font-serif text-4xl leading-tight tracking-tight sm:text-5xl lg:text-6xl">{t('hero.title')}</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg">{t('hero.intro')}</p>
              <div className="mt-7">
                <BookingQuickLinks settings={settings} source="location_page" />
              </div>
            </div>
            <div className="relative hidden aspect-[4/5] overflow-hidden lg:block">
              <Image src="/images/hero-salon.webp" alt={t('hero.imageAlt')} fill sizes="(min-width: 1024px) 42vw, 1px" className="object-cover" />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
        <section aria-labelledby="local-visit" className="grid gap-10 border-b border-zinc-200 pb-14 md:grid-cols-[1.3fr_1fr] md:gap-16">
          <div>
            <h2 id="local-visit" className="font-serif text-3xl tracking-tight sm:text-4xl">{t('visit.title')}</h2>
            <p className="mt-5 leading-7 text-zinc-600">{t('visit.arrival')}</p>
            <p className="mt-4 leading-7 text-zinc-600">{t('visit.access')}</p>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
              {settings.googleBusinessUrl && <a href={settings.googleBusinessUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-zinc-600">{t('visit.directions')}</a>}
              <Link href="/contact" className="underline underline-offset-4 hover:text-zinc-600">{t('visit.contact')}</Link>
            </div>
          </div>
          <div className="border border-zinc-200 bg-zinc-50 p-6 sm:p-8">
            <address lang="en-GB" className="not-italic leading-7 text-zinc-700">
              <p className="font-semibold text-zinc-900">Harbour Hair Salon</p>
              <p>Upper Floor, Unit 15</p>
              <p>Central Arcade, Central Rd</p>
              <p>Leeds, LS1 6DX</p>
            </address>
            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">{t('visit.hours')}</h3>
            <ul className="mt-2 space-y-1 text-sm text-zinc-700">
              {groupedOpeningHours().map(({ days, opens, closes }) => (
                <li key={days[0]} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <span>{dayRangeLabel(days, (day) => tc.dynamic(`days.${dayKey(day)}`, undefined, day), (from, to) => tc('days.range', { from, to }))}</span>
                  <span>{formatRange(opens, closes)}</span>
                </li>
              ))}
            </ul>
            <a href={phoneHref} className="mt-5 inline-block text-sm font-semibold underline underline-offset-4 hover:text-zinc-600">{t('booking.call', { phone: settings.phone })}</a>
          </div>
        </section>

        <section aria-labelledby="local-nearby" className="py-14">
          <h2 id="local-nearby" className="max-w-3xl font-serif text-3xl tracking-tight sm:text-4xl">{t('nearby.title')}</h2>
          <p className="mt-5 max-w-3xl leading-7 text-zinc-600">{t('nearby.intro')}</p>
          <div className="mt-9 grid gap-8 md:grid-cols-3">
            {(['briggate', 'market', 'corn'] as const).map((landmark) => (
              <article key={landmark} className="border-t border-zinc-300 pt-5">
                <h3 className="font-semibold">{t(`nearby.${landmark}Title`)}</h3>
                <p className="mt-3 text-sm leading-7 text-zinc-600">{t(`nearby.${landmark}`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="local-expertise" className="border-t border-zinc-200 py-14">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{t('expertise.eyebrow')}</p>
          <h2 id="local-expertise" className="mt-4 max-w-3xl font-serif text-3xl tracking-tight sm:text-4xl">{t('expertise.title')}</h2>
          <p className="mt-5 max-w-3xl leading-7 text-zinc-600">{t('expertise.body')}</p>
          <div className="mt-8 grid gap-7 md:grid-cols-3">
            {(['cuts', 'colour', 'perms'] as const).map((service) => (
              <div key={service}>
                <h3 className="font-semibold">{t(`expertise.${service}Title`)}</h3>
                <p className="mt-3 text-sm leading-7 text-zinc-600">{t(`expertise.${service}`)}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-4 text-sm font-semibold">
            <Link href="/services" className="underline underline-offset-4 hover:text-zinc-600">{t('expertise.services')}</Link>
            <Link href="/stylists" className="underline underline-offset-4 hover:text-zinc-600">{t('expertise.stylists')}</Link>
            <Link href="/about" className="underline underline-offset-4 hover:text-zinc-600">{t('expertise.about')}</Link>
          </div>
        </section>

        <section className="bg-zinc-100 px-6 py-10 sm:px-10">
          <h2 className="font-serif text-3xl tracking-tight">{t('booking.title')}</h2>
          <p className="mt-4 max-w-2xl leading-7 text-zinc-600">{t('booking.body')}</p>
          <div className="mt-6 flex flex-wrap items-center gap-5">
            <Link href="/book" className="inline-flex min-h-11 items-center justify-center bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700">{t('booking.button')}</Link>
            <a href={phoneHref} className="text-sm font-semibold underline underline-offset-4 hover:text-zinc-600">{t('booking.call', { phone: settings.phone })}</a>
          </div>
        </section>
      </div>
    </div>
  );
}
