/** A root-relative path to a file in public/ (not a protocol-relative `//host`). */
export function isLocalImagePath(src: string): boolean {
  return src.startsWith('/') && !src.startsWith('//');
}

/** Absolute URL for structured data / social cards: local paths get the site origin. */
export function absoluteImageUrl(src: string, siteUrl: string): string {
  return isLocalImagePath(src) ? `${siteUrl}${src}` : src;
}
