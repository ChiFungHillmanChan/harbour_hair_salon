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

      {/* Mobile Menu Overlay - Loaded dynamically */}
      <MobileMenuOverlay isOpen={isOpen} onClose={closeMenu} role={role} onSignOut={onSignOut} hasOffers={hasOffers} />
    </div>
  );
}
