// Single source of truth for the site's canonical base URL.
// Used in JSON-LD, sitemap, robots, OG images, email links, and canonical tags.
//
// Override via NEXT_PUBLIC_SITE_URL in Vercel if you ever attach a custom
// domain — otherwise defaults to the Vercel production URL.
const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const SITE_URL = (raw && raw.length > 0 ? raw : 'https://harbourhairsalon.vercel.app').replace(
  /\/+$/,
  ''
);
