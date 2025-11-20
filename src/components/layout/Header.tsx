import Link from 'next/link';
import { getSession } from '@/app/lib/session';
import { logout } from '@/app/actions/auth';

export async function Header() {
  const session = await getSession();

  return (
    <header className="bg-black text-white sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-serif tracking-wider font-bold">
          HARBOUR HAIR
        </Link>
        
        <nav className="hidden md:flex space-x-8 text-sm uppercase tracking-widest items-center">
          <Link href="/#services" className="hover:text-gray-400 transition-colors">Services</Link>
          <Link href="/#team" className="hover:text-gray-400 transition-colors">Team</Link>
          <Link href="#contact" className="hover:text-gray-400 transition-colors">Contact</Link>
          
          {session?.userId ? (
            <>
              {session.role === 'ADMIN' && (
                <Link href="/admin" className="hover:text-gray-400 transition-colors">Dashboard</Link>
              )}
              <form action={logout}>
                <button className="hover:text-gray-400 transition-colors uppercase">Sign Out</button>
              </form>
            </>
          ) : (
            <Link href="/auth/signin" className="hover:text-gray-400 transition-colors">Sign In</Link>
          )}
        </nav>

        <Link 
          href="/book"
          className="bg-white text-black px-6 py-2 text-sm uppercase tracking-widest font-semibold hover:bg-gray-200 transition-colors ml-4"
        >
          Book Now
        </Link>
      </div>
    </header>
  );
}

