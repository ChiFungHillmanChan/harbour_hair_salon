import type { Metadata } from 'next';
import prisma from '@/app/lib/prisma';
import { OG_BASE } from '@/app/lib/og-defaults';
import Image from 'next/image';
import { BookingWizard } from '@/components/booking/BookingWizard';
import { getAggregateRating } from '@/app/services/review-service';
import { redirect } from 'next/navigation';
import { isBookingEnabled } from '@/app/lib/booking-maintenance';
import { activeMarketplaces } from '@/app/services/marketplace-channels';
import { getSession } from '@/app/lib/session';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { getPublicCatalog } from '@/app/services/pricing/public-catalog';
import { loadPublishedTranslations, overlay } from '@/app/services/content/translations';
import { getLocale, getT } from '@/i18n/server';
import { ClientMessages } from '@/i18n/ClientMessages';
import { alternatesFor, ogLocale } from '@/i18n/metadata';
import { localizeHref } from '@/i18n/paths';
import { rich } from '@/i18n/rich';
import Link from '@/i18n/link';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('booking')]);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: alternatesFor(locale, '/book'),
    robots: { index: false, follow: true },
    openGraph: {
      ...OG_BASE,
      ...ogLocale(locale),
      title: t('meta.ogTitle'),
      description: t('meta.ogDescription'),
    },
  };
}

// Whether booking is open now lives in the database and the signed-in check
// moved here from middleware, so this route reads per-request state and cannot
// be ISR-cached.
//
// The cost of that is NOT negligible, and an earlier version of this comment
// claimed it was on the grounds that "SiteSettings is still cached" — which is
// wrong, because `isBookingEnabled()` on the very next line routes to
// `assertOnlineBookingReady`, which bypasses that cache by design. Every hit
// here used to be three or four uncached Neon queries, on a route linked from
// every page's footer and the sticky mobile bar. `isBookingEnabled()` is now
// cached for 60s and invalidated by the admin toggle; see booking-maintenance.ts
// for why that is safe. Keep it that way — and note the gate MUST stay above the
// session check below, because a signed-out visitor is supposed to see the
// marketplace/phone page when booking is closed, not a sign-in redirect. The
// same order holds on /zh-hk/book.
export const dynamic = 'force-dynamic';

async function getStylists(locale: Awaited<ReturnType<typeof getLocale>>) {
  // Only public-safe fields — the full row includes the secret treatwellIcalUrl,
  // which must never reach this client component / the RSC payload.
  const stylists = await prisma.stylist.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, role: true, imageUrl: true },
  });
  const translations = await loadPublishedTranslations(prisma, 'STYLIST', stylists.map((s) => s.id), locale);
  // Names are never translated; only the role line is.
  return stylists.map((stylist) => {
    const { translated: _translated, ...localized } = overlay(stylist, translations.get(stylist.id), ['role']);
    void _translated;
    return localized;
  });
}

export default async function BookPage() {
  const [locale, t] = await Promise.all([getLocale(), getT('booking')]);

  if (!(await isBookingEnabled())) {
    // Phone and marketplace links come from SiteSettings so the salon can change
    // them from the admin panel without a redeploy — including removing one
    // entirely, which a hardcoded fallback used to make impossible.
    const settings = await getSiteSettings();
    const marketplaces = activeMarketplaces(settings);

    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-16">
        <div className="max-w-xl w-full bg-white rounded-lg shadow border border-zinc-200 p-8 md:p-12 text-center">
          <div className="w-12 h-[2px] bg-zinc-300 mx-auto mb-6" />
          {/* Every "Book Now" on the site lands here, so this page has to read
              like the salon's booking page — not like an apology for one that
              is missing. It used to say "Online booking is on its way", which
              told every visitor on the landing page that the site was
              unfinished, when in fact both routes below take a real booking
              today. Copy stays marketplace-agnostic: the names come from
              settings, so clearing a URL in the admin panel removes it here. */}
          <h1 className="text-3xl md:text-4xl font-serif text-zinc-900 mb-4 tracking-tight">
            {marketplaces.length > 0 ? t('closed.titleWithPartners') : t('closed.titlePhoneOnly')}
          </h1>
          <p className="text-zinc-600 leading-relaxed mb-8">
            {marketplaces.length > 0 ? t('closed.bodyWithPartners') : t('closed.bodyPhoneOnly')}
          </p>

          {/* Phone first and equally prominent: a phone booking costs the salon
              no marketplace commission, so it should never look like a fallback. */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={`tel:${settings.phone.replace(/\s+/g, '')}`}
              className="inline-block bg-zinc-900 text-white px-8 py-3 rounded-md font-medium hover:bg-zinc-700 transition-colors"
            >
              {t('closed.call', { phone: settings.phone })}
            </a>
            {marketplaces.map((m) => (
              <a
                key={m.name}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block border border-zinc-900 text-zinc-900 px-8 py-3 rounded-md font-medium hover:bg-zinc-100 transition-colors"
              >
                {t('closed.bookOn', { name: m.name })}
              </a>
            ))}
          </div>

          {marketplaces.length === 0 && (
            <p className="mt-5 text-sm text-zinc-500 leading-relaxed">
              {t('closed.phoneHours')}
            </p>
          )}

          <p className="mt-6 text-sm text-zinc-500">
            {rich(t('closed.alreadyBooked'), {
              link: (text) => <Link href="/appointments" className="underline hover:text-zinc-900">{text}</Link>,
            })}
          </p>
        </div>
      </div>
    );
  }

  // Booking is open — it requires an account, so send anonymous visitors to
  // sign in (this gate used to live in middleware). Both hops stay in the
  // visitor's language, and the return target is still a relative path that
  // sanitizeRedirect accepts.
  const session = await getSession();
  if (!session?.userId) {
    redirect(localizeHref(locale, `/auth/signin?redirect=${encodeURIComponent(localizeHref(locale, '/book'))}`));
  }

  const [catalog, stylists, aggregateRating] = await Promise.all([
    getPublicCatalog(locale),
    getStylists(locale),
    getAggregateRating(),
  ]);

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Hero Section */}
      <section className="relative py-14 md:py-24 bg-zinc-900 text-white overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/hero-salon.webp"
            alt={t('hero.heroAlt')}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
        </div>
        <div className="relative z-10 container mx-auto px-4 text-center">
          <div className="w-12 h-[2px] bg-white/50 mx-auto mb-6" />
          <h1 className="text-4xl md:text-6xl font-serif mb-6 tracking-tight">
            {t('hero.titleStart')} <span className="text-zinc-400">{t('hero.titleEnd')}</span>
          </h1>
          <p className="text-base md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed">
            {t('hero.subtitle')}
          </p>
          {aggregateRating.count > 0 && (
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-zinc-300">
              <span className="text-zinc-300" aria-hidden="true">★</span>
              <span className="font-semibold text-white">{aggregateRating.average.toFixed(1)}</span>
              <span aria-hidden="true">·</span>
              <span>{t('hero.verifiedReviews', { count: aggregateRating.count })}</span>
            </p>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <ClientMessages namespaces={['pricing']} sections={{ booking: ['steps', 'service', 'gate', 'stylist', 'date', 'confirm', 'done'] }}>
          <BookingWizard
            services={catalog.services}
            offerings={catalog.offerings}
            categories={catalog.categories}
            stylists={stylists}
          />
        </ClientMessages>
      </div>
    </div>
  );
}
