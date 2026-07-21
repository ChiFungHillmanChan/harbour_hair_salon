'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { logout } from '@/app/actions/auth';
import { parseSessionHint } from '@/app/lib/session-hint';
import { MobileNav } from './MobileNav';

/** Signed-in role, null when signed out, undefined before the first client read. */
type HeaderRole = string | null | undefined;

export function HeaderClient({ hasOffers }: { hasOffers: boolean }) {
  const pathname = usePathname();
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
  if (pathname?.startsWith('/admin') || pathname?.startsWith('/kiosk')) return null;

  return (
    <header className="bg-black text-white sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="group flex items-center gap-3">
          <span className="text-2xl font-serif tracking-wider font-bold">
            HARBOUR <span className="text-zinc-400">HAIR</span>
          </span>
        </Link>

        <nav className="hidden md:flex space-x-8 text-sm uppercase tracking-widest items-center">
          <Link href="/services" className="hover:text-zinc-300 transition-colors duration-300">Services</Link>
          {hasOffers && <Link href="/offers" className="hover:text-zinc-300 transition-colors duration-300">Offers</Link>}
          <Link href="/#team" className="hover:text-zinc-300 transition-colors duration-300">Team</Link>
          <Link href="/contact" className="hover:text-zinc-300 transition-colors duration-300">Contact</Link>
          <Link href="/try-color" className="hover:text-zinc-300 transition-colors duration-300">Try Color</Link>

          {role === undefined ? (
            // Pre-hydration placeholder: reserves the slot without flashing
            // the wrong state before the cookie has been read.
            <span className="opacity-0 select-none" aria-hidden="true">Sign In</span>
          ) : role !== null ? (
            <>
              {role === 'ADMIN' ? (
                <Link href="/admin" className="hover:text-zinc-300 transition-colors duration-300">Dashboard</Link>
              ) : (
                <Link href="/appointments" className="hover:text-zinc-300 transition-colors duration-300">My Bookings</Link>
              )}
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="hover:text-zinc-300 transition-colors duration-300 uppercase disabled:opacity-50"
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link href="/auth/signin" className="hover:text-zinc-300 transition-colors duration-300">Sign In</Link>
          )}
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/book" className="hidden md:block bg-white text-zinc-900 px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-200 transition-colors duration-300">
            Book Now
          </Link>
          <MobileNav role={role ?? null} onSignOut={handleSignOut} hasOffers={hasOffers} />
        </div>
      </div>
    </header>
  );
}
