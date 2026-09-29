import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import prisma from '@/app/lib/prisma';
import { isLocale, type Locale } from '@/i18n/config';
import { loadPublishedTranslations, overlay } from './content/translations';

export type SiteSettings = {
  phone: string;
  twitterHandle: string;
  gscVerification: string;
  googleBusinessUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  treatwellUrl: string;
  freshaUrl: string;
  booksyUrl: string;
  heroEyebrow: string;
  heroTitleLine1: string;
  heroTitleLine2: string;
  heroSubtitle: string;
  /** Online-booking master switch, toggled from Admin -> Settings. */
  bookingEnabled: boolean;
  /** Language of the salon's own notification mails (new booking alerts). */
  salonNotificationLocale: Locale;
};

const SINGLETON_ID = 'singleton';

const DEFAULTS: SiteSettings = {
  phone: '07831 830898',
  twitterHandle: '',
  gscVerification: '',
  googleBusinessUrl: 'https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111',
  facebookUrl: '',
  instagramUrl: 'https://www.instagram.com/harbourhair_leeds/',
  treatwellUrl: 'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/',
  freshaUrl: '',
  booksyUrl: '',
  heroEyebrow: 'Leeds City Centre',
  heroTitleLine1: 'Expert Hair',
  heroTitleLine2: 'Styling',
  heroSubtitle: 'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.',
  // Fail CLOSED: if settings cannot be read, booking stays off rather than
  // silently opening a booking flow that may double-book against Treatwell.
  bookingEnabled: false,
  salonNotificationLocale: 'zh-HK',
};

function mapRow(row: {
  phone: string;
  twitterHandle: string;
  gscVerification: string;
  googleBusinessUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  treatwellUrl: string;
  freshaUrl: string;
  booksyUrl: string;
  heroEyebrow: string;
  heroTitleLine1: string;
  heroTitleLine2: string;
  heroSubtitle: string;
  bookingEnabled: boolean;
  salonNotificationLocale: string;
}): SiteSettings {
  return {
    phone: row.phone,
    twitterHandle: row.twitterHandle,
    gscVerification: row.gscVerification,
    googleBusinessUrl: row.googleBusinessUrl,
    facebookUrl: row.facebookUrl,
    instagramUrl: row.instagramUrl,
    treatwellUrl: row.treatwellUrl,
    freshaUrl: row.freshaUrl,
    booksyUrl: row.booksyUrl,
    heroEyebrow: row.heroEyebrow,
    heroTitleLine1: row.heroTitleLine1,
    heroTitleLine2: row.heroTitleLine2,
    heroSubtitle: row.heroSubtitle,
    bookingEnabled: row.bookingEnabled,
    salonNotificationLocale: isLocale(row.salonNotificationLocale) ? row.salonNotificationLocale : DEFAULTS.salonNotificationLocale,
  };
}

// Wrapped in React cache() so the several callers that fire per render (root
// layout metadata, Header, Footer, page body) share ONE query per request
// instead of each hitting Neon.
// A failed read THROWS out of the cached function so it is never stored: the
// fallback used to be returned from inside it, which cached DEFAULTS for up to
// an hour site-wide whenever Neon was cold or briefly unreachable (seen in the
// production logs several times a day) — silently replacing whatever the salon
// had set in Admin → Settings. Now a failed revalidation keeps serving the last
// good settings, and DEFAULTS only cover a request with nothing cached yet.
const getSiteSettingsFromStore = unstable_cache(async (): Promise<SiteSettings> => {
  // Read-first, create-on-miss. Using upsert races under concurrent
  // pre-rendering because two workers can both attempt INSERT.
  const existing = await prisma.siteSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return mapRow(existing);

  try {
    const created = await prisma.siteSettings.create({ data: { id: SINGLETON_ID } });
    return mapRow(created);
  } catch {
    // Someone else inserted it between our read and create. Read again.
    const row = await prisma.siteSettings.findUnique({ where: { id: SINGLETON_ID } });
    return row ? mapRow(row) : DEFAULTS;
  }
}, ['site-settings'], { revalidate: 3600, tags: ['site-settings'] });

async function getSiteSettingsOrDefaults(): Promise<SiteSettings> {
  try {
    return await getSiteSettingsFromStore();
  } catch (error) {
    console.error('Failed to load site settings:', error);
    return DEFAULTS;
  }
}

// React cache deduplicates within one render; unstable_cache shares the safe,
// public singleton across requests and allows instant admin invalidation.
export const getSiteSettings = cache(getSiteSettingsOrDefaults);

export type HeroContent = Pick<SiteSettings, 'heroEyebrow' | 'heroTitleLine1' | 'heroTitleLine2' | 'heroSubtitle'> & { translated: boolean };

const HERO_KEYS = ['heroEyebrow', 'heroTitleLine1', 'heroTitleLine2', 'heroSubtitle'] as const;

/**
 * The homepage hero in `locale`: English from the settings row, Chinese from
 * its PUBLISHED translation. Cached per language under the same tag, so the
 * publish step (which revalidates 'site-settings') refreshes both at once.
 */
const getHeroFromStore = unstable_cache(async (locale: Locale): Promise<HeroContent> => {
  const settings = await getSiteSettingsFromStore();
  const hero = { heroEyebrow: settings.heroEyebrow, heroTitleLine1: settings.heroTitleLine1, heroTitleLine2: settings.heroTitleLine2, heroSubtitle: settings.heroSubtitle };
  if (locale === 'en-GB') return { ...hero, translated: true };
  try {
    const translations = await loadPublishedTranslations(prisma, 'SITE_SETTINGS', [SINGLETON_ID], locale);
    return overlay(hero, translations.get(SINGLETON_ID), [...HERO_KEYS]);
  } catch (error) {
    console.error('Failed to load hero translation:', error);
    return { ...hero, translated: false };
  }
}, ['site-settings-hero'], { revalidate: 3600, tags: ['site-settings'] });

export const getHeroContent = cache(getHeroFromStore);

export function buildSameAsArray(settings: SiteSettings): string[] {
  return [
    settings.instagramUrl,
    settings.googleBusinessUrl,
    settings.facebookUrl,
    settings.treatwellUrl,
    settings.freshaUrl,
    settings.booksyUrl,
  ].filter((url) => url && url.trim().length > 0);
}

export function normalizeTwitterHandle(handle: string): string | undefined {
  const trimmed = handle.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}
