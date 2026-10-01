import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';
import { getT } from '@/i18n/server';
import Link from '@/i18n/link';

export default async function VisitFollowBlock() {
  const [settings, t, tl] = await Promise.all([getSiteSettings(), getT('home'), getT('local')]);
  return (
    <section className="bg-zinc-50 py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="font-serif text-3xl text-zinc-900 mb-3">{t('visit.title')}</h2>
        <p className="text-zinc-600 mb-6">
          {t('visit.body')}
        </p>
        <div className="flex justify-center mb-6">
          <SocialLinks settings={settings} />
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/hair-salon-leeds-city-centre" className="inline-flex min-h-11 items-center border border-zinc-900 px-6 py-3 text-sm font-semibold hover:bg-zinc-900 hover:text-white transition-colors">
            {tl('links.guide')}
          </Link>
          {settings.treatwellUrl && (
            <a
              href={settings.treatwellUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-zinc-300 text-zinc-900 px-6 py-3 uppercase tracking-[0.15em] text-sm font-bold hover:bg-zinc-900 hover:text-white hover:border-zinc-900 transition-colors"
            >
              {t('visit.bookOnTreatwell')}
            </a>
          )}
          {settings.googleBusinessUrl && (
            <a
              href={settings.googleBusinessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-900 underline hover:text-zinc-600 transition-colors self-center"
            >
              {t('visit.directions')}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
