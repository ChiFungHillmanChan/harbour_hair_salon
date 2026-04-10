import Link from 'next/link';
import { getSession } from '@/app/lib/session';
import { logout } from '@/app/actions/auth';
import { MobileNav } from './MobileNav';
import prisma from '@/app/lib/prisma';

export async function Header() {
  const [session, activeOffersCount] = await Promise.all([
    getSession(),
    prisma.offer.count({ where: { isActive: true } }),
  ]);
  const hasOffers = activeOffersCount > 0;

  return (
    <header className="bg-black text-white sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="group flex items-center gap-3">
          <span className="text-2xl font-serif tracking-wider font-bold">
            HARBOUR <span className="text-accent">HAIR</span>
          </span>
        </Link>

        <nav className="hidden md:flex space-x-8 text-sm uppercase tracking-widest items-center">
          <Link href="/services" className="hover:text-accent transition-colors duration-300">Services</Link>
          {hasOffers && (
            <Link href="/offers" className="hover:text-accent transition-colors duration-300">Offers</Link>
          )}
          <Link href="/#team" className="hover:text-accent transition-colors duration-300">Team</Link>
          <Link href="/contact" className="hover:text-accent transition-colors duration-300">Contact</Link>
          <Link href="/try-color" className="hover:text-accent transition-colors duration-300">Try Color</Link>

          {session?.userId ? (
            <>
              {session.role === 'ADMIN' && (
                <Link href="/admin" className="hover:text-accent transition-colors duration-300">Dashboard</Link>
              )}
              {session.role !== 'ADMIN' && (
                <Link href="/appointments" className="hover:text-accent transition-colors duration-300">My Bookings</Link>
              )}
              <form action={logout}>
                <button className="hover:text-accent transition-colors duration-300 uppercase">Sign Out</button>
              </form>
            </>
          ) : (
            <Link href="/auth/signin" className="hover:text-accent transition-colors duration-300">Sign In</Link>
          )}
        </nav>

        <div className="flex items-center gap-4">
          <Link
            href="/book"
            className="hidden md:block bg-accent text-black px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-accent-light transition-colors duration-300"
          >
            Book Now
          </Link>

          <MobileNav session={session} hasOffers={hasOffers} />
        </div>
      </div>
    </header>
  );
}
