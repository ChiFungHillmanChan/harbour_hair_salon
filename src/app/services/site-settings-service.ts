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
  /**
   * Square deposit policy, for the admin form and page copy only. Anything that
   * moves money reads the row directly (services/deposit-quote.ts), because this
   * cached copy can be up to a day old.
   */
  depositsEnabled: boolean;
  /** Whole percent of the quoted price, 0–100. */
  depositPercent: number;
  /** Services quoted below this many pence take no percentage deposit. */
  depositMinimumServicePence: number;
  /** ISO instant the late-arrival rule was switched on; null = off. */
  lateAutoCancelSince: string | null;
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
  // The column defaults: no deposit is taken until the salon sets one.
  depositsEnabled: false,
  depositPercent: 0,
  depositMinimumServicePence: 0,
  // Ships off: nothing is cancelled for lateness until the salon switches it on.
  lateAutoCancelSince: null,
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
  depositsEnabled: boolean;
  depositPercent: number;
  depositMinimumServicePence: number;
  lateAutoCancelSince: Date | null;
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
    depositsEnabled: row.depositsEnabled,
    depositPercent: row.depositPercent,
    depositMinimumServicePence: row.depositMinimumServicePence,
    lateAutoCancelSince: row.lateAutoCancelSince?.toISOString() ?? null,
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
async function readSiteSettingsRow(): Promise<SiteSettings> {
  // Read-first, create-on-miss. Using upsert races under concurrent
  // pre-rendering because two workers can both attempt INSERT.
  const existing = await prisma.siteSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return mapRow(existing);

  try {
    const created = await prisma.siteSettings.create({ data: { id: SINGLETON_ID } });
    return mapRow(created);
  } catch {
    // Someone else inserted it between our read and create. Read again. Never
    // return DEFAULTS from in here: unstable_cache would keep the fallback for
    // the whole revalidate period (CLAUDE.md) — throw and fall back outside.
    const row = await prisma.siteSettings.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) throw new Error('SiteSettings singleton missing after a create race');
    return mapRow(row);
  }
}

// A day, not an hour: every expiry made the next visit to /contact, /about etc.
// re-read settings, waking Neon overnight. Admin → Settings → Save drops the
// 'site-settings' tag, so edits there still show at once; a direct DB write
// needs that Save (or `vercel cache invalidate --tag site-settings`) to reach
// public pages.
const getSiteSettingsFromStore = unstable_cache(readSiteSettingsRow, ['site-settings'], { revalidate: 86400, tags: ['site-settings'] });

/**
 * The live row, never the cache and never DEFAULTS — for Admin → Settings,
 * whose Save writes back every field the form shows. Reading the day-long
 * cache there would let a stale copy (e.g. after a direct database write)
 * silently overwrite newer values, booking on/off included. Throws if the
 * database can't be read: an editable form must not show made-up values.
 */
export const getSiteSettingsForEditing = readSiteSettingsRow;

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
