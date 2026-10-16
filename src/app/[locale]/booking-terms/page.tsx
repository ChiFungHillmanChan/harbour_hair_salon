import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from '@/i18n/link';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { CONSULTATION_CREDIT_MONTHS, LATE_ARRIVAL_CANCEL_MINUTES, MIN_BOOKING_NOTICE_MINUTES } from '@/app/lib/booking-constants';
import { PATCH_TEST_MIN_LEAD_HOURS } from '@/app/services/patch-test-eligibility';
import { toTelHref } from '@/app/lib/phone';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { formatCalendarDay } from '@/i18n/dates';
import { rich } from '@/i18n/rich';
import { OfferTerms } from '@/components/legal/OfferTerms';

/** Change this, and the wording in the `legal.bookingTerms` dictionary, together. */
const LAST_UPDATED = '2026-10-16';

// Static copy plus the salon phone from the day-cached settings, so the page is
// served from the ISR cache and never reads the database per request (CLAUDE.md,
// Neon compute budget). Admin → Settings → Save revalidates every page, so a
// new phone number shows at once; a day is only the safety net.
export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('legal')]);
  return {
    title: t('bookingTerms.meta.title'),
    description: t('bookingTerms.meta.description'),
    alternates: alternatesFor(locale, '/booking-terms'),
  };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-serif text-2xl text-zinc-900 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default async function BookingTermsPage() {
  const [settings, locale, t] = await Promise.all([getSiteSettings(), getLocale(), getT('legal')]);
  const phone = settings.phone.trim() || '07831 830898';
  const linkClass = 'text-zinc-900 underline';
  const text = (message: string) => rich(message, {
    bookings: (chunk) => <Link href="/appointments" className={linkClass}>{chunk}</Link>,
    tel: (chunk) => <a href={toTelHref(phone)} className={linkClass}>{chunk}</a>,
    contact: (chunk) => <Link href="/contact" className={linkClass}>{chunk}</Link>,
    privacy: (chunk) => <Link href="/privacy" className={linkClass}>{chunk}</Link>,
  });

  return (
    <div className="min-h-screen bg-white">
      <section className="bg-zinc-900 text-white py-20">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="w-12 h-[2px] bg-white/50 mb-6" />
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight">{t('bookingTerms.title')}</h1>
          <p className="mt-4 text-zinc-300">
            {t('bookingTerms.lastUpdated', { date: formatCalendarDay(locale, LAST_UPDATED, { day: 'numeric', month: 'long', year: 'numeric' }) })}
          </p>
        </div>
      </section>

      <main className="container mx-auto px-4 py-14 max-w-3xl space-y-10 text-zinc-700 leading-7">
        <p>{t('bookingTerms.intro')}</p>

        <Section id="requests" title={t('bookingTerms.requests.title')}>
          <p>{t('bookingTerms.requests.request')}</p>
          <p>{t('bookingTerms.requests.notice', { count: MIN_BOOKING_NOTICE_MINUTES / 60 })}</p>
          <p>{t('bookingTerms.requests.account')}</p>
        </Section>

        <Section id="deposits" title={t('bookingTerms.deposits.title')}>
          <p>{t('bookingTerms.deposits.amount')}</p>
          <p>{t('bookingTerms.deposits.hold')}</p>
          <p>{t('bookingTerms.deposits.price')}</p>
          <p>{t('bookingTerms.deposits.card')}</p>
        </Section>

        <Section id="not-confirmed" title={t('bookingTerms.notConfirmed.title')}>
          <p>{t('bookingTerms.notConfirmed.released')}</p>
          <p>{t('bookingTerms.notConfirmed.inTime')}</p>
          <p>{t('bookingTerms.notConfirmed.bank')}</p>
        </Section>

        <Section id="cancelling" title={t('bookingTerms.cancelling.title')}>
          <p>{text(t('bookingTerms.cancelling.request'))}</p>
          <p>{text(t('bookingTerms.cancelling.confirmed'))}</p>
          <p>{t('bookingTerms.cancelling.late')}</p>
          <p>{t('bookingTerms.cancelling.lateOrNoShow')}</p>
          <p>{t('bookingTerms.cancelling.lateArrival', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</p>
          <p>{t('bookingTerms.cancelling.salon')}</p>
        </Section>

        <Section id="refunds" title={t('bookingTerms.refunds.title')}>
          <p>{t('bookingTerms.refunds.body')}</p>
        </Section>

        <Section id="changes" title={t('bookingTerms.changes.title')}>
          <p>{text(t('bookingTerms.changes.request'))}</p>
          <p>{t('bookingTerms.changes.pending')}</p>
          <p>{t('bookingTerms.changes.deposit')}</p>
        </Section>

        <Section id="offers" title={t('bookingTerms.offers.title')}>
          <OfferTerms t={t} />
        </Section>

        <Section id="patch-tests" title={t('bookingTerms.patchTests.title')}>
          <p>{t('bookingTerms.patchTests.body', { hours: PATCH_TEST_MIN_LEAD_HOURS })}</p>
          <p>{t('bookingTerms.patchTests.credit', { months: CONSULTATION_CREDIT_MONTHS })}</p>
        </Section>

        <Section id="rights" title={t('bookingTerms.rights.title')}>
          <p>{t('bookingTerms.rights.body', { minutes: LATE_ARRIVAL_CANCEL_MINUTES })}</p>
        </Section>

        {/* Not "contact": the site footer already uses that id. */}
        <Section id="questions" title={t('bookingTerms.contact.title')}>
          <p>{text(t('bookingTerms.contact.body', { phone }))}</p>
          <p>{text(t('bookingTerms.contact.privacy'))}</p>
        </Section>
      </main>
    </div>
  );
}
