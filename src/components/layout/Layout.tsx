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
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-serif text-xl md:text-2xl font-medium text-center sm:text-left">
            {t('footer.promoTitle')}
          </p>
          <Link
            href="/book"
            className="bg-black text-white px-8 py-3 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-800 transition-colors"
          >
            {t('nav.bookAppointment')}
          </Link>
        </div>
      </div>
    </aside>
  );
}

export async function Footer() {
  const [hasOffers, settings, t] = await Promise.all([
    hasActiveOffers(),
    getSiteSettings(),
    getT('common'),
  ]);
  const phoneDisplay = settings.phone.trim() || '07831 830898';

  return (
    <footer className="bg-zinc-900 text-white" id="contact">
      {/* Main footer */}
      <div className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <h3 className="text-2xl font-serif mb-4">
              {t('footer.brandFirst')} <span className="text-zinc-400">{t('footer.brandSecond')}</span>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              {t('footer.tagline')}
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-zinc-300">{t('footer.quickLinks')}</h4>
            <ul className="space-y-3 text-sm text-zinc-400">
              <li><Link href="/services" className="hover:text-white transition-colors">{t('footer.servicesPricing')}</Link></li>
              {hasOffers && (
                <li><Link href="/offers" className="hover:text-white transition-colors">{t('footer.specialOffers')}</Link></li>
              )}
              <li><Link href="/stylists" className="hover:text-white transition-colors">{t('footer.ourStylists')}</Link></li>
              <li><Link href="/reviews" className="hover:text-white transition-colors">{t('footer.clientReviews')}</Link></li>
              <li><Link href="/blog" className="hover:text-white transition-colors">{t('footer.journal')}</Link></li>
              <li><Link href="/book" className="hover:text-white transition-colors">{t('footer.bookOnline')}</Link></li>
              <li><Link href="/contact" className="hover:text-white transition-colors">{t('footer.contactUs')}</Link></li>
              <li>
                <a
                  href="https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Treatwell
                </a>
              </li>
            </ul>
          </div>

          {/* Visit Us */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-zinc-300">{t('footer.visitUs')}</h4>
            <address className="text-zinc-400 text-sm not-italic space-y-1">
              <p>{t('footer.addressLine1')}</p>
              <p>{t('footer.addressLine2')}</p>
              <p>{t('footer.addressLine3')}</p>
              <p className="text-xs text-zinc-500 mt-3">{t('footer.locatedInside')}</p>
            </address>
            <div className="mt-4">
              <a href={toTelHref(phoneDisplay)} className="text-sm text-zinc-300 hover:text-white transition-colors">
                {phoneDisplay}
              </a>
            </div>
          </div>

          {/* Hours */}
          <div>
            <h4 className="text-sm uppercase tracking-widest font-bold mb-6 text-zinc-300">{t('footer.hours')}</h4>
            <ul className="text-zinc-400 text-sm space-y-2">
              {groupedOpeningHours().map((group) => (
                <li key={group.days[0]} className="flex justify-between">
                  <span>{dayRangeLabel(group.days, (day) => t.dynamic(`days.${dayKey(day)}`), (from, to) => t('days.range', { from, to }))}</span>
                  <span>{formatRange(group.opens, group.closes)}</span>
                </li>
              ))}
            </ul>

            {/* Social */}
            <div className="mt-6">
              <SocialLinks settings={settings} tone="dark" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-800 py-6 text-center text-zinc-500 text-xs">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>{t('footer.rights', { year: new Date().getFullYear() })}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>{t('footer.paymentLanguages')}</span>
            <Link href="/privacy" className="hover:text-zinc-300 transition-colors">{t('footer.privacy')}</Link>
            <Link href="/unsubscribe" className="hover:text-zinc-300 transition-colors">{t('footer.unsubscribe')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
