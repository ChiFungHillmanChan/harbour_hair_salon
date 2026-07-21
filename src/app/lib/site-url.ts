// Single source of truth for the site's canonical base URL.
// Used in JSON-LD, sitemap, robots, OG images, email links, and canonical tags.
//
// Override via NEXT_PUBLIC_SITE_URL in Vercel — otherwise defaults to the
// canonical custom domain (www; the apex 308-redirects to it).
const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();

// The Vercel project enforces the sensitive env-var policy, so in external CI
// builds (GitHub Actions `vercel build`) this variable materializes as the
// literal placeholder "[SENSITIVE]" instead of a URL. Fall back unless the
// value actually parses; at runtime on Vercel the real value is decrypted.
export function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export const SITE_URL = (raw && isParseableUrl(raw) ? raw : 'https://www.harbourhair.co.uk').replace(
  /\/+$/,
  ''
);
