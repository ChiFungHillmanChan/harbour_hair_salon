'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the overlay with SSR disabled to avoid hydration mismatch
// and to isolate the Portal logic which requires document.body
const MobileMenuOverlay = dynamic(() => import('./MobileMenuOverlay'), { ssr: false });

interface MobileNavProps {
  /** Signed-in role, or null when signed out. */
  role: string | null;
  onSignOut: () => void;
  hasOffers?: boolean;
}

export function MobileNav({ role, onSignOut, hasOffers = false }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    // Match the header's xl breakpoint, including browser zoom and rotation.
    const desktop = window.matchMedia('(min-width: 80rem)');
    const closeOnDesktop = () => {
      if (desktop.matches) setIsOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  const openMenu = () => setIsOpen(true);
  const closeMenu = () => setIsOpen(false);

  return (
    <div className="xl:hidden flex items-center">
      {/* Trigger Button (Hamburger) - Visible when closed */}
      <button
        onClick={openMenu}
        type="button"
        className="text-white min-h-11 min-w-11 inline-flex items-center justify-center p-2 z-50 relative hover:bg-zinc-800 rounded-md transition-colors"
        aria-label="Open menu"
        aria-expanded={isOpen}
        aria-controls="mobile-navigation"
        aria-haspopup="dialog"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Mobile Menu Overlay - Loaded dynamically */}
      <MobileMenuOverlay isOpen={isOpen} onClose={closeMenu} role={role} onSignOut={onSignOut} hasOffers={hasOffers} />
    </div>
  );
}
