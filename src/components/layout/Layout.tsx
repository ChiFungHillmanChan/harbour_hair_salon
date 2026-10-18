import React from 'react';
import Link from '@/i18n/link';
import { getT } from '@/i18n/server';
import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { hasActiveOffers } from '@/app/services/offers-service';
import { toTelHref } from '@/app/lib/phone';
import { dayKey, dayRangeLabel, formatRange, groupedOpeningHours } from '@/app/lib/opening-hours-public';

export async function FooterPromotions() {
  const t = await getT('common');
  return (
    <aside aria-label={t('footer.promoLabel')}>
      {/* Booking CTA strip */}
      <div className="bg-zinc-100 text-zinc-900 py-6">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <p className="font-serif text-xl md:text-2xl font-medium text-center sm:text-left">
            {t('footer.promoTitle')}
          </p>
          <Link
            href="/book"
            className="inline-flex min-h-11 items-center justify-center bg-black text-white px-5 py-2.5 sm:px-8 sm:py-3 text-sm sm:uppercase sm:tracking-[0.2em] font-bold hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-900"
          >
            {t('nav.bookAppointment')}
          </Link>
        </div>
      </div>
    </aside>
  );
}

export async function Footer() {
  const [hasOffers, settings, t, tl] = await Promise.all([
    hasActiveOffers(),
    getSiteSettings(),
    getT('common'),
    getT('local'),
  ]);
  const phoneDisplay = settings.phone.trim() || '07831 830898';

  return (
    <footer className="scroll-mt-16 sm:scroll-mt-20 bg-zinc-900 text-white [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-4 [&_a]:focus-visible:outline-white" id="contact">
      {/* Main footer */}
      <div className="container mx-auto px-4 py-10 md:py-16">
        <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 md:gap-12">
          {/* Brand */}
          <div className="min-[400px]:col-span-2 md:col-span-1">
            <h3 className="text-2xl font-serif mb-4">
              {t('footer.brandFirst')} <span className="text-zinc-400">{t('footer.brandSecond')}</span>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              {t('footer.tagline')}
            </p>
          </div>

          {/* Quick links */}
          <div className="min-[400px]:col-span-2 md:col-span-1">
            <h4 className="text-sm md:uppercase md:tracking-widest font-bold mb-3 md:mb-6 text-zinc-300">{t('footer.quickLinks')}</h4>
            <ul className="grid grid-cols-2 gap-x-4 md:block md:space-y-1 text-sm text-zinc-400 [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:py-2 [&_a]:break-words">
              <li><Link href="/services" className="hover:text-white transition-colors">{t('footer.servicesPricing')}</Link></li>
              <li><Link href="/about" className="hover:text-white transition-colors">{t('nav.about')}</Link></li>
              <li><Link href="/hair-salon-leeds-city-centre" className="hover:text-white transition-colors">{tl('links.guide')}</Link></li>
              {hasOffers && (
                <li><Link href="/offers" className="hover:text-white transition-colors">{t('footer.specialOffers')}</Link></li>
              )}
              <li><Link href="/stylists" className="hover:text-white transition-colors">{t('footer.ourStylists')}</Link></li>
              <li><Link href="/reviews" className="hover:text-white transition-colors">{t('footer.clientReviews')}</Link></li>
              <li><Link href="/blog" className="hover:text-white transition-colors">{t('footer.journal')}</Link></li>
              <li><Link href="/book" className="hover:text-white transition-colors">{t('footer.bookOnline')}</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">{t('footer.contactUs')}</Link></li>
              {/* Marketplace links come only from Admin → Settings (SocialLinks
                  below), so clearing a URL there removes it everywhere. */}
            </ul>
          </div>

          {/* Visit Us */}
          <div>
            <h4 className="text-sm md:uppercase md:tracking-widest font-bold mb-3 md:mb-6 text-zinc-300">{t('footer.visitUs')}</h4>
            <address className="text-zinc-400 text-sm not-italic space-y-1">
              <p>{t('footer.addressLine1')}</p>
              <p>{t('footer.addressLine2')}</p>
              <p>{t('footer.addressLine3')}</p>
              <p className="text-xs text-zinc-400 mt-3">{t('footer.locatedInside')}</p>
            </address>
            <div className="mt-2 md:mt-4">
              <a href={toTelHref(phoneDisplay)} className="inline-flex min-h-11 items-center text-sm text-zinc-300 hover:text-white transition-colors">
                {phoneDisplay}
              </a>
            </div>
          </div>

          {/* Hours */}
          <div>
            <h4 className="text-sm md:uppercase md:tracking-widest font-bold mb-3 md:mb-6 text-zinc-300">{t('footer.hours')}</h4>
            <ul className="text-zinc-400 text-sm space-y-2">
              {groupedOpeningHours().map((group) => (
                <li key={group.days[0]} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                  <span>{dayRangeLabel(group.days, (day) => t.dynamic(`days.${dayKey(day)}`), (from, to) => t('days.range', { from, to }))}</span>
                  <span className="whitespace-nowrap">{formatRange(group.opens, group.closes)}</span>
                </li>
              ))}
            </ul>

            {/* Social */}
            <div className="mt-4 md:mt-6">
              <SocialLinks settings={settings} tone="dark" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800 py-4 sm:py-6 text-center text-zinc-400 text-xs">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>{t('footer.rights', { year: new Date().getFullYear() })}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_a]:justify-center">
            <span className="w-full sm:w-auto">{t('footer.paymentLanguages')}</span>
            <Link href="/privacy" className="hover:text-white transition-colors">{t('footer.privacy')}</Link>
            <Link href="/booking-terms" className="hover:text-white transition-colors">{t('footer.bookingTerms')}</Link>
            <Link href="/unsubscribe" className="hover:text-white transition-colors">{t('footer.unsubscribe')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
