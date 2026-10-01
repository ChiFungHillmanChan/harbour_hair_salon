import type { Metadata } from 'next';
import { OG_BASE } from '@/app/lib/og-defaults';
import Image from 'next/image';
import Link from '@/i18n/link';
import { Faq } from '@/components/seo/Faq';
import SalonGallery from '@/components/contact/SalonGallery';
import { getFaqsByKey } from '@/app/services/faq-service';
import { SITE_URL } from '@/app/lib/site-url';
import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings, buildSameAsArray } from '@/app/services/site-settings-service';
import { toTelHref } from '@/app/lib/phone';
import { jsonLdScript } from '@/app/lib/json-ld';
import { buildHairSalonSchema } from '@/app/lib/hair-salon-schema';
import { PUBLIC_OPENING_HOURS, dayKey, formatRange } from '@/app/lib/opening-hours-public';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('contact')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/contact'),
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.ogDescription'),
    },
  };
}

export default async function ContactPage() {
  const locale = await getLocale();
  const [contactFaqs, settings, t, tc, tl] = await Promise.all([
    getFaqsByKey('contact', locale),
    getSiteSettings(),
    getT('contact'),
    getT('common'),
    getT('local'),
  ]);
  const phoneDisplay = settings.phone.trim() || '07831 830898';
  const phoneHref = toTelHref(phoneDisplay);
  const url = (path: string) => `${SITE_URL}${localizeHref(locale, path) === '/' ? '' : localizeHref(locale, path)}`;
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/hero-salon.webp"
            alt={t('hero.imageAlt')}
            fill
            loading="eager"
            fetchPriority="high"
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-5xl md:text-6xl font-serif mb-6 tracking-tight">{t('hero.titleStart')} <span className="text-zinc-400">{t('hero.titleEnd')}</span></h1>
          <p className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">{t('hero.subtitle')}</p>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: t('breadcrumb.home'), item: url('/') },
              { '@type': 'ListItem', position: 2, name: t('breadcrumb.contact'), item: url('/contact') },
            ],
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(buildHairSalonSchema(settings, {
            locale,
            description: t('meta.description'),
            sameAs: buildSameAsArray(settings),
          })),
        }}
      />

      <div className="container mx-auto px-4 py-12 md:py-20">
        <div className="grid md:grid-cols-2 gap-12 max-w-6xl mx-auto">
          
          {/* Contact Info */}
          <div className="space-y-12">
            {/* Address */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">{t('location.heading')}</h2>
              <address className="not-italic text-zinc-600 text-lg leading-relaxed">
                <p className="font-medium text-zinc-900 mb-2">Harbour Hair Salon</p>
                <p>Upper Floor, Unit 15</p>
                <p>Central Arcade, Central Rd</p>
                <p>Leeds, LS1 6DX</p>
                <p className="mt-4 text-sm text-zinc-500">
                  {t('location.note')}
                </p>
              </address>
              <Link href="/hair-salon-leeds-city-centre" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:text-zinc-600">
                {tl('links.guide')}
              </Link>
            </div>

            {/* Contact & Social */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">{t('touch.heading')}</h2>
              <div className="space-y-4 text-lg">
                <p>
                  <span className="block text-sm font-bold text-zinc-900 uppercase tracking-wider mb-1">{t('touch.phone')}</span>
                  <a href={phoneHref} className="text-zinc-600 hover:text-zinc-900 transition-colors">
                    {phoneDisplay}
                  </a>
                </p>
              </div>
            </div>

            {/* Opening Hours */}
            <div>
              <h2 className="text-2xl font-bold text-black mb-6 border-b-2 border-zinc-200 pb-2">{t('hours.heading')}</h2>
              <ul className="space-y-2 text-lg text-zinc-600">
                {PUBLIC_OPENING_HOURS.map(({ day, opens, closes }, index) => (
                  <li
                    key={day}
                    className={`flex justify-between${index < PUBLIC_OPENING_HOURS.length - 1 ? ' border-b border-zinc-100 pb-1' : ''}`}
                  >
                    <span className="font-medium text-zinc-900">{tc.dynamic(`days.${dayKey(day, 'long')}`, undefined, day)}</span>
                    <span>{formatRange(opens, closes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Map */}
          <div className="h-full min-h-[400px] bg-zinc-100 rounded-lg overflow-hidden relative shadow-lg">
            <iframe 
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2356.2!2d-1.544255!3d53.7965911!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x48795d7c1f30e4cf%3A0xad74be12e1f34d1a!2sHarbour%20Hair!5e0!3m2!1sen!2suk!4v1710000000000!5m2!1sen!2suk" 
              width="100%" 
              height="100%" 
              style={{ border: 0, minHeight: '500px' }} 
              allowFullScreen 
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={t('map.title')}
              className="transition-all duration-500"
            ></iframe>
          </div>
        </div>

        {/* Find & follow us */}
        <section className="mt-10">
          <h2 className="font-serif text-2xl text-zinc-900 mb-4">{t('follow.heading')}</h2>
          <SocialLinks settings={settings} className="mb-6" />
          <div className="flex flex-wrap gap-3">
            {settings.treatwellUrl && (
              <a
                href={settings.treatwellUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="border border-zinc-300 text-zinc-900 px-6 py-3 uppercase tracking-[0.15em] text-sm font-bold hover:bg-zinc-900 hover:text-white transition-colors"
              >
                {t('follow.bookOnTreatwell')}
              </a>
            )}
            {settings.googleBusinessUrl && (
              <a
                href={settings.googleBusinessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-900 underline hover:text-zinc-600 transition-colors self-center"
              >
                {t('follow.directions')}
              </a>
            )}
          </div>
        </section>

        {/* Our Space gallery */}
        <SalonGallery />

        {/* CTA Section */}
        <div className="mt-20 text-center bg-zinc-900 p-16">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-8" />
          <h2 className="text-3xl font-serif text-white mb-6">{t('cta.title')}</h2>
          <p className="text-zinc-400 mb-10 max-w-xl mx-auto font-light">
            {t('cta.body')}
          </p>
          <Link
            href="/book"
            className="inline-block bg-white text-zinc-900 px-12 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all"
          >
            {t('cta.button')}
          </Link>
        </div>
      </div>
      {contactFaqs.length > 0 && (
        <Faq
          title={t('faq.title')}
          intro={t('faq.intro')}
          items={contactFaqs.map((f) => ({ question: f.question, answer: f.answer, lang: locale !== 'en-GB' && !f.translated ? 'en' : undefined }))}
        />
      )}
    </div>
  );
}
