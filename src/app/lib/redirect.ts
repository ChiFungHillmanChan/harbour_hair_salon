/**
 * Only allow same-origin relative paths as post-auth redirect targets. Rejects
 * absolute URLs, protocol-relative `//host`, backslash tricks (`/\host` and
 * `/\\host` normalise to `//host` in the WHATWG URL parser and in browsers),
 * and any control characters that could smuggle a second target.
 */
export function sanitizeRedirect(url: string | null): string {
  if (!url) return '/';
  if (!url.startsWith('/')) return '/';
  if (url.startsWith('//')) return '/';
  if (url.startsWith('/\\')) return '/';
  if (/[\x00-\x1F\\]/.test(url)) return '/';
  return url;
}
