import type { Metadata } from 'next';
import Link from '@/i18n/link';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { getLocale, getT } from '@/i18n/server';
import { alternatesFor } from '@/i18n/metadata';
import { formatCalendarDay } from '@/i18n/dates';
import { rich } from '@/i18n/rich';

/** Change this, and the wording in the `legal.privacy` dictionary, together. */
const LAST_UPDATED = '2026-07-03';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT('legal')]);
  return {
    title: t('privacy.meta.title'),
    description: t('privacy.meta.description'),
    alternates: alternatesFor(locale, '/privacy'),
  };
}

export default async function PrivacyPage() {
  const [settings, locale, t] = await Promise.all([getSiteSettings(), getLocale(), getT('legal')]);
  const contactLink = (text: string) => <Link href="/contact" className="text-zinc-900 underline">{text}</Link>;
  const unsubscribeLink = (text: string) => <Link href="/unsubscribe" className="text-zinc-900 underline">{text}</Link>;

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
        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">{t('privacy.whoTitle')}</h2>
          <p>{rich(t('privacy.whoBody', { phone: settings.phone }), { link: contactLink })}</p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">{t('privacy.collectTitle')}</h2>
          <p>{t('privacy.collectBody')}</p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">{t('privacy.useTitle')}</h2>
          <p>{t('privacy.useBody')}</p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">{t('privacy.providersTitle')}</h2>
          <p>{t('privacy.providersBody')}</p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">{t('privacy.marketingTitle')}</h2>
          <p>{rich(t('privacy.marketingBody'), { link: unsubscribeLink })}</p>
        </section>

        <section>
          <h2 className="font-serif text-2xl text-zinc-900 mb-3">{t('privacy.rightsTitle')}</h2>
          <p>{t('privacy.rightsBody')}</p>
        </section>
      </main>
    </div>
  );
}
