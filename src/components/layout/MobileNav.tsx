'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { logout } from '@/app/actions/auth';

interface MobileNavProps {
  session: {
    userId?: string;
    role?: string;
  } | null;
}

export function MobileNav({ session }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const openMenu = () => setIsOpen(true);
  const closeMenu = () => setIsOpen(false);

  return (
    <div className="md:hidden flex items-center">
      {/* Trigger Button (Hamburger) - Visible when closed */}
      <button
        onClick={openMenu}
        className="text-white p-2 focus:outline-none z-50 relative hover:bg-zinc-800 rounded-md transition-colors"
        aria-label="Open menu"
        aria-expanded={isOpen}
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
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Mobile Menu Overlay */}
      {mounted && createPortal(
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
              onClick={closeMenu}
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
                onClick={closeMenu}
              >
                Services
              </Link>
              <Link
                href="/offers"
                className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
                onClick={closeMenu}
              >
                Offers
              </Link>
              <Link
                href="/#team"
                className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
                onClick={closeMenu}
              >
                Team
              </Link>
              <Link
                href="/contact"
                className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
                onClick={closeMenu}
              >
                Contact
              </Link>

              <div className="border-t border-zinc-800 my-4 w-full"></div>

              {session?.userId ? (
                <>
                  {session.role === 'ADMIN' && (
                    <Link
                      href="/admin"
                      className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
                      onClick={closeMenu}
                    >
                      Dashboard
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
                  onClick={closeMenu}
                >
                  Sign In
                </Link>
              )}
            </nav>
            
            <div className="mt-auto pb-8">
              <Link
                href="/book"
                className="block w-full bg-white text-black py-4 text-center text-lg uppercase tracking-widest font-bold hover:bg-zinc-200 transition-colors rounded-sm"
                onClick={closeMenu}
              >
                Book Now
              </Link>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
