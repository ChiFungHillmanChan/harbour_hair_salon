'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { logout } from '@/app/actions/auth';

interface MobileMenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  session: {
    userId?: string;
    role?: string;
  } | null;
}

export default function MobileMenuOverlay({ isOpen, onClose, session }: MobileMenuOverlayProps) {
  // No need for mounted state check since this component is dynamically imported with { ssr: false }
  // It will only ever render on the client where document.body is available
  
  return createPortal(
    <div 
      className={`fixed inset-0 z-[100] bg-black flex flex-col transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        isOpen 
          ? 'opacity-100 translate-y-0 visible' 
          : 'opacity-0 -translate-y-full invisible'
      }`}
      aria-hidden={!isOpen}
    >
      {/* Close Button inside Overlay */}
      <div className="flex justify-end p-4">
         <button
          onClick={onClose}
          className="text-white p-2 focus:outline-none hover:bg-zinc-800 rounded-md transition-colors"
          aria-label="Close menu"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="px-6 pb-6 flex flex-col space-y-6 overflow-y-auto h-full">
        <nav className="flex flex-col space-y-6 mt-8">
          <Link
            href="/services"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            Services
          </Link>
          <Link
            href="/offers"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            Offers
          </Link>
          <Link
            href="/#team"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            Team
          </Link>
          <Link
            href="/contact"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            Contact
          </Link>
          <Link
            href="/try-color"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            Try Color
          </Link>

          <div className="border-t border-zinc-800 my-4 w-full"></div>

          {session?.userId ? (
            <>
              {session.role === 'ADMIN' && (
                <Link
                  href="/admin"
                  className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
                  onClick={onClose}
                >
                  Dashboard
                </Link>
              )}
              {session.role !== 'ADMIN' && (
                <Link
                  href="/appointments"
                  className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
                  onClick={onClose}
                >
                  My Bookings
                </Link>
              )}
              <form action={logout} className="w-full">
                <button className="text-zinc-400 hover:text-white text-xl tracking-wide uppercase w-full text-left transition-colors">
                  Sign Out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/auth/signin"
              className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
              onClick={onClose}
            >
              Sign In
            </Link>
          )}
        </nav>
        
        <div className="mt-auto pb-8">
          <Link
            href="/book"
            className="block w-full bg-accent text-black py-4 text-center text-lg uppercase tracking-widest font-bold hover:bg-accent-light transition-colors rounded-sm"
            onClick={onClose}
          >
            Book Now
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}
