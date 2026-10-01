import { activeMarketplaces } from '@/app/services/marketplace-channels';
import { toTelHref } from '@/app/lib/phone';
import type { SiteSettings } from '@/app/services/site-settings-service';
import { getT } from '@/i18n/server';
import { BookingIntentLink } from './BookingIntentLink';

/** Uses the homepage's cached settings; no live booking-readiness/database check. */
export async function BookingQuickLinks({ settings, source = 'home_hero' }: {
  settings: Pick<SiteSettings, 'phone' | 'freshaUrl' | 'treatwellUrl' | 'booksyUrl'>;
  source?: 'home_hero' | 'location_page' | 'about_page';
}) {
  const t = await getT('home');
  const marketplaces = activeMarketplaces(settings);

  return (
    <div className="mx-auto max-w-2xl" aria-labelledby={`${source}-booking-title`}>
      <h2 id={`${source}-booking-title`} className="text-lg font-semibold text-white">
        {t('booking.title')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-zinc-200">
        {t(marketplaces.length > 0 ? 'booking.withPartners' : 'booking.phoneOnly')}
      </p>
      <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
        <BookingIntentLink
          href={toTelHref(settings.phone)}
          channel="phone"
          source={source}
          className="inline-flex min-h-12 items-center justify-center bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          {t('booking.call', { phone: settings.phone })}
        </BookingIntentLink>
        {marketplaces.map(({ name, url }) => (
          <BookingIntentLink
            key={name}
            href={url}
            channel={name}
            source={source}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center justify-center border border-white/75 bg-black/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {t('booking.bookOn', { name })}
          </BookingIntentLink>
        ))}
      </div>
    </div>
  );
}
