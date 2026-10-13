import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from '@/i18n/link';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { formatCalendarDay } from '@/i18n/dates';
import { rich } from '@/i18n/rich';

/** Change this, and the wording in the `legal.privacy` dictionary, together. */
const LAST_UPDATED = '2026-10-13';

// Each list's items, in the order the page shows them (keys of legal.privacy.*).
const COLLECTED = ['account', 'google', 'bookings', 'payments', 'patchTests', 'staffBookings', 'emails', 'reviews', 'marketing', 'security', 'visits', 'tryColour'] as const;
const USES = ['service', 'payments', 'safety', 'reviewRequests', 'reviewsPublished', 'marketing', 'security', 'improvement', 'records'] as const;
const PROVIDERS = ['vercel', 'neon', 'resend', 'upstash', 'square', 'google', 'marketplaces'] as const;
const RETENTION = ['account', 'bookings', 'payments', 'security', 'reviews', 'emails', 'rateLimits', 'links', 'marketing'] as const;
const RIGHTS = ['access', 'rectification', 'erasure', 'restriction', 'objection', 'portability', 'consent'] as const;
const COOKIES = ['session', 'sessionHint', 'loginDevice', 'googleState', 'locale'] as const;

const ICO_COMPLAINTS_URL = 'https://ico.org.uk/make-a-complaint/';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('legal')]);
  return {
    title: t('privacy.meta.title'),
    description: t('privacy.meta.description'),
    alternates: alternatesFor(locale, '/privacy'),
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

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-zinc-400">
      {items.map((item, index) => <li key={index}>{item}</li>)}
    </ul>
  );
}

export default async function PrivacyPage() {
  const [settings, locale, t] = await Promise.all([getSiteSettings(), getLocale(), getT('legal')]);
  const phone = settings.phone.trim() || '07831 830898';
  const linkClass = 'text-zinc-900 underline';
  const text = (message: string) => rich(message, {
    b: (chunk) => <strong className="font-semibold text-zinc-900">{chunk}</strong>,
    link: (chunk) => <Link href="/contact" className={linkClass}>{chunk}</Link>,
    unsubscribe: (chunk) => <Link href="/unsubscribe" className={linkClass}>{chunk}</Link>,
    terms: (chunk) => <Link href="/booking-terms" className={linkClass}>{chunk}</Link>,
    ico: (chunk) => <a href={ICO_COMPLAINTS_URL} className={linkClass} target="_blank" rel="noopener noreferrer">{chunk}</a>,
  });

  return (
    <div className="min-h-screen bg-white">
      <section className="bg-zinc-900 text-white py-20">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="w-12 h-[2px] bg-white/50 mb-6" />
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight">{t('privacy.title')}</h1>
          <p className="mt-4 text-zinc-300">
            {t('privacy.lastUpdated', { date: formatCalendarDay(locale, LAST_UPDATED, { day: 'numeric', month: 'long', year: 'numeric' }) })}
          </p>
        </div>
      </section>

      <main className="container mx-auto px-4 py-14 max-w-3xl space-y-10 text-zinc-700 leading-7">
        <p>{t('privacy.intro')}</p>

        <Section id="who" title={t('privacy.who.title')}>
          <p>{t('privacy.who.body')}</p>
        </Section>

        <Section id="collect" title={t('privacy.collect.title')}>
          <p>{t('privacy.collect.intro')}</p>
          <List items={COLLECTED.map((key) => text(t(`privacy.collect.${key}`)))} />
          <p>{t('privacy.collect.required')}</p>
        </Section>

        <Section id="use" title={t('privacy.use.title')}>
          <p>{t('privacy.use.intro')}</p>
          <List items={USES.map((key) => text(t(`privacy.use.${key}`)))} />
        </Section>

        <Section id="share" title={t('privacy.share.title')}>
          <p>{t('privacy.share.intro')}</p>
          <List items={PROVIDERS.map((key) => text(t(`privacy.share.${key}`)))} />
          <p>{t('privacy.share.cdn')}</p>
          <p>{t('privacy.share.law')}</p>
        </Section>

        <Section id="transfers" title={t('privacy.transfers.title')}>
          <p>{t('privacy.transfers.body')}</p>
        </Section>

        <Section id="retention" title={t('privacy.retention.title')}>
          <List items={RETENTION.map((key) => text(t(`privacy.retention.${key}`)))} />
        </Section>

        <Section id="rights" title={t('privacy.rights.title')}>
          <p>{t('privacy.rights.intro')}</p>
          <List items={RIGHTS.map((key) => t(`privacy.rights.${key}`))} />
          <p>{t('privacy.rights.limits')}</p>
          <p>{text(t('privacy.rights.complain'))}</p>
        </Section>

        {/* Not "contact": the site footer already uses that id. */}
        <Section id="contact-us" title={t('privacy.contact.title')}>
          <p>{text(t('privacy.contact.body', { phone }))}</p>
        </Section>

        <Section id="cookies" title={t('privacy.cookies.title')}>
          <p>{t('privacy.cookies.intro')}</p>
          <List items={COOKIES.map((key) => text(t(`privacy.cookies.${key}`)))} />
          <p>{t('privacy.cookies.staff')}</p>
          <p>{t('privacy.cookies.map')}</p>
          <p>{t('privacy.cookies.square')}</p>
        </Section>

        <Section id="automated" title={t('privacy.automated.title')}>
          <p>{t('privacy.automated.body')}</p>
        </Section>

        <Section id="changes" title={t('privacy.changes.title')}>
          <p>{t('privacy.changes.body')}</p>
        </Section>
      </main>
    </div>
  );
}
