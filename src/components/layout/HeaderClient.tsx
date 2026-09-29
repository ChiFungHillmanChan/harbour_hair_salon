'use client';

import Link from '@/i18n/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { logout } from '@/app/actions/auth';
import { parseSessionHint } from '@/app/lib/session-hint';
import { MobileNav } from './MobileNav';
import { useT } from '@/i18n/client';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { clearAllDrafts } from '@/i18n/draft-store';
import { stripLocale } from '@/i18n/paths';

/** Signed-in role, null when signed out, undefined before the first client read. */
type HeaderRole = string | null | undefined;

export function HeaderClient({ hasOffers }: { hasOffers: boolean }) {
  const pathname = usePathname();
  const businessPath = stripLocale(pathname);
  const t = useT('common');
  const [role, setRole] = useState<HeaderRole>(undefined);
  const [isSigningOut, startSignOut] = useTransition();

  // Instant, network-free auth state from the non-httpOnly session_hint
  // cookie. Re-read on every navigation: this component lives in the root
  // layout and survives soft navigations, so login/logout redirects must
  // trigger a re-read rather than relying on a remount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs header with the cookie the server just set/cleared; same idiom as AdminSidebar
    setRole(parseSessionHint(document.cookie));
  }, [pathname]);

  // Fallback for sessions created before the hint cookie existed: one fetch
  // per full page load; /api/session back-fills the hint so this runs once.
  useEffect(() => {
    if (parseSessionHint(document.cookie) !== null) return;
    const controller = new AbortController();
    fetch('/api/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<{ session: { role: string } | null }> : { session: null })
      .then((body) => {
        if (body.session?.role) setRole(body.session.role);
      })
      .catch(() => {
        // Signed-out default already rendered; nothing to roll back.
      });
    return () => controller.abort();
  }, []);

  const handleSignOut = () => {
    if (isSigningOut) return;
    // Optimistic flip: the header switches to signed-out immediately, so the
    // click has a visible effect and the button can't be pressed repeatedly.
    setRole(null);
    // Unsaved drafts (and any one-time MFA result) belong to this account only.
    clearAllDrafts();
    startSignOut(async () => {
      try {
        await logout();
      } catch {
        // Action failed before clearing the session — restore the true state.
        setRole(parseSessionHint(document.cookie));
      }
    });
  };

  // Admin and kiosk provide their own full-screen navigation shells.
  if (businessPath.startsWith('/admin') || businessPath.startsWith('/kiosk')) return null;

  return (
    <header className="bg-black text-white sticky top-0 z-50 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-white [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-white">
      <div className="mx-auto max-w-[1536px] min-h-18 sm:min-h-20 px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center gap-4 xl:gap-6">
        <Link href="/" className="group flex shrink-0 items-center min-h-11" aria-label={t('nav.homeLabel')}>
          <span className="whitespace-nowrap text-xl sm:text-2xl font-serif tracking-wider font-bold">
            HARBOUR <span className="text-zinc-400">HAIR</span>
          </span>
        </Link>

        {/* The full signed-in navigation needs more room than the tablet breakpoint. */}
        <nav aria-label={t('nav.main')} className="hidden xl:flex shrink-0 gap-5 2xl:gap-8 whitespace-nowrap text-sm uppercase tracking-widest items-center [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center">
          <Link href="/services" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.services')}</Link>
          {hasOffers && <Link href="/offers" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.offers')}</Link>}
          <Link href="/#team" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.team')}</Link>
          <Link href="/contact" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.contact')}</Link>
          <Link href="/try-color" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.tryColor')}</Link>
          <Link href="/3d" prefetch={false} aria-current={businessPath === '/3d' ? 'page' : undefined} className="hover:text-zinc-300 transition-colors duration-300 aria-[current=page]:text-sky-200">{t('nav.threeD')}</Link>

          {role === undefined ? (
            // Pre-hydration placeholder: reserves the slot without flashing
            // the wrong state before the cookie has been read.
            <span className="opacity-0 select-none" aria-hidden="true">{t('nav.signIn')}</span>
          ) : role !== null ? (
            <>
              {role === 'ADMIN' ? (
                <Link href="/admin" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.dashboard')}</Link>
              ) : (
                <Link href="/appointments" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.myBookings')}</Link>
              )}
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="min-h-11 hover:text-zinc-300 transition-colors duration-300 uppercase disabled:opacity-50"
              >
                {t('nav.signOut')}
              </button>
            </>
          ) : (
            <Link href="/auth/signin" className="hover:text-zinc-300 transition-colors duration-300">{t('nav.signIn')}</Link>
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          {/* Fixed-size slot so the header never reflows when the language changes.
              Hidden by a wrapper: the switcher sets its own `inline-flex`, which
              beats a `hidden` passed in className, and put it on phones where
              it pushed the page wider than the screen. Below xl it lives in
              the menu overlay. */}
          <div className="hidden xl:flex">
            <LanguageSwitcher />
          </div>
          <Link href="/book" className="hidden sm:inline-flex min-h-11 items-center justify-center whitespace-nowrap bg-white text-zinc-900 px-5 2xl:px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-200 transition-colors duration-300">
            {t('nav.bookNow')}
          </Link>
          <MobileNav key={pathname} role={role ?? null} onSignOut={handleSignOut} hasOffers={hasOffers} />
        </div>
      </div>
    </header>
  );
}
