import type { Locale } from '@/i18n/config';
import { localizeHref } from '@/i18n/paths';
import { sanitizeRedirect } from '@/app/lib/redirect';

/**
 * Where a successful sign-in (password, registration or Google) lands, in the
 * language the visitor signed in with. Administrators always open the admin
 * panel; everyone else returns to the page that sent them to sign in, or the
 * home page (`/zh-hk` for Chinese).
 *
 * The requested target is sanitized, moved into `locale` (so switching
 * language on the sign-in page is honoured), then sanitized AGAIN: re-homing
 * `/zh-hk//evil.example` into English strips the prefix and would otherwise
 * leave the protocol-relative `//evil.example`.
 */
export function postSignInPath(locale: Locale, requested: string | null, role?: string): string {
  if (role === 'ADMIN') return localizeHref(locale, '/admin');
  return sanitizeRedirect(localizeHref(locale, sanitizeRedirect(requested)));
}
