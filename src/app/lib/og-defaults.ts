/**
 * The share card every public page inherits.
 *
 * Next.js REPLACES a parent's `openGraph` object when a page declares its own —
 * it does not deep-merge. Every page here sets a page-specific title and
 * description, which silently dropped the site's image, name and locale: as of
 * September 2026 not one public page emitted an `og:image`, so every link shared
 * on WhatsApp, Facebook or Instagram appeared as bare text. For a salon, whose
 * work is the reason anyone shares the link, that is the whole point of the card.
 *
 * Spread this FIRST in a page's `openGraph`, then add that page's own fields.
 */

export const OG_IMAGE = {
  url: '/images/og-image.png',
  width: 1200,
  height: 630,
  alt: 'Harbour Hair Salon — Expert Hair Styling in Leeds',
};

// Not `as const`: Next's OpenGraph type wants a mutable OGImage[].
export const OG_BASE = {
  siteName: 'Harbour Hair Salon',
  locale: 'en_GB',
  images: [OG_IMAGE],
};
