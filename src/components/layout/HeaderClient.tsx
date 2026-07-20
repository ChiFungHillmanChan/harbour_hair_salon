'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logout } from '@/app/actions/auth';
import { MobileNav } from './MobileNav';

type PublicSession = { userId: string; role: string } | null;

export function HeaderClient({ hasOffers }: { hasOffers: boolean }) {
  const pathname = usePathname();
  const [session, setSession] = useState<PublicSession>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<{ session: PublicSession }> : { session: null })
      .then((body) => setSession(body.session))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSession(null);
      });
    return () => controller.abort();
  }, []);

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

          {session?.userId ? (
            <>
              {session.role === 'ADMIN' ? (
                <Link href="/admin" className="hover:text-zinc-300 transition-colors duration-300">Dashboard</Link>
              ) : (
                <Link href="/appointments" className="hover:text-zinc-300 transition-colors duration-300">My Bookings</Link>
              )}
              <form action={logout}>
                <button className="hover:text-zinc-300 transition-colors duration-300 uppercase">Sign Out</button>
              </form>
            </>
          ) : (
            <Link href="/auth/signin" className="hover:text-zinc-300 transition-colors duration-300">Sign In</Link>
          )}
        </nav>

        <div className="flex items-center gap-4">
          <Link href="/book" className="hidden md:block bg-white text-zinc-900 px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-zinc-200 transition-colors duration-300">
            Book Now
          </Link>
          <MobileNav session={session} hasOffers={hasOffers} />
        </div>
      </div>
    </header>
  );
}
