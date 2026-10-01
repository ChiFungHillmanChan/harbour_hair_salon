import type { SiteSettings } from '@/app/services/site-settings-service';
import type { Locale } from '@/i18n/config';
import { openingHoursSpecification } from './opening-hours-public';
import { toTelHref } from './phone';
import { SITE_URL } from './site-url';

/** One business identity across the homepage, contact and local visitor guide. */
export function buildHairSalonSchema(
  settings: Pick<SiteSettings, 'phone' | 'googleBusinessUrl'>,
  content: { locale: Locale; description: string; sameAs: string[] },
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${SITE_URL}/#salon`,
    name: 'Harbour Hair Salon',
    url: SITE_URL,
    image: `${SITE_URL}/images/hero-salon.webp`,
    description: content.description,
    inLanguage: content.locale,
    telephone: toTelHref(settings.phone).replace(/^tel:/, ''),
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Upper Floor, Unit 15 Central Arcade, Central Rd',
      addressLocality: 'Leeds',
      addressRegion: 'West Yorkshire',
      postalCode: 'LS1 6DX',
      addressCountry: 'GB',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 53.7965911,
      longitude: -1.5416801,
    },
    areaServed: [
      { '@type': 'City', name: 'Leeds' },
      { '@type': 'Place', name: 'Leeds city centre' },
    ],
    openingHoursSpecification: openingHoursSpecification(),
    knowsLanguage: ['en', 'zh-yue'],
    sameAs: content.sameAs,
    ...(settings.googleBusinessUrl ? { hasMap: settings.googleBusinessUrl } : {}),
  };
}
