import 'server-only';
import { cache } from 'react';
import prisma from '@/app/lib/prisma';

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
  };
}

// Wrapped in React cache() so the several callers that fire per render (root
// layout metadata, Header, Footer, page body) share ONE query per request
// instead of each hitting Neon.
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  try {
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
  } catch (error) {
    console.error('Failed to load site settings:', error);
    return DEFAULTS;
  }
});

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
