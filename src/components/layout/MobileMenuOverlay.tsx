'use client';

import Link from '@/i18n/link';
import { useT } from '@/i18n/client';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface MobileMenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** Signed-in role, or null when signed out. */
  role: string | null;
  onSignOut: () => void;
  hasOffers?: boolean;
}

export default function MobileMenuOverlay({ isOpen, onClose, role, onSignOut, hasOffers = false }: MobileMenuOverlayProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = useT('common');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Native modal behavior contains keyboard focus and restores it on close.
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  // No need for mounted state check since this component is dynamically imported with { ssr: false }
  // It will only ever render on the client where document.body is available
  
  return createPortal(
    <dialog
      ref={dialogRef}
      id="mobile-navigation"
      aria-label={t('nav.menu')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-black text-white p-0 open:flex open:flex-col [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-white [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-4 [&_button:focus-visible]:outline-white"
    >
      {/* Close Button inside Overlay */}
      <div className="flex shrink-0 items-center justify-between px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <LanguageSwitcher className="text-sm" />
         <button
          type="button"
          onClick={onClose}
          className="text-white min-h-11 min-w-11 inline-flex items-center justify-center p-2 hover:bg-zinc-800 rounded-md transition-colors"
          aria-label={t('nav.closeMenu')}
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 px-6 sm:px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col gap-6 overflow-y-auto overscroll-contain">
        <nav aria-label={t('nav.main')} className="flex flex-col gap-3 sm:gap-4 mt-2 sm:mt-6 [&>a]:flex [&>a]:items-center [&>a]:min-h-11 [&>button]:min-h-11">
          <Link
            href="/services"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            {t('nav.services')}
          </Link>
          {hasOffers && (
            <Link
              href="/offers"
              className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
              onClick={onClose}
            >
              {t('nav.offers')}
            </Link>
          )}
          <Link
            href="/#team"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            {t('nav.team')}
          </Link>
          <Link
            href="/contact"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            {t('nav.contact')}
          </Link>
          <Link
            href="/try-color"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            {t('nav.tryColor')}
          </Link>
          <Link
            href="/about"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            {t('nav.about')}
          </Link>

          <div className="border-t border-zinc-800 my-4 w-full"></div>

          {role !== null ? (
            <>
              {role === 'ADMIN' && (
                <Link
                  href="/admin"
                  className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
                  onClick={onClose}
                >
                  {t('nav.dashboard')}
                </Link>
              )}
              {role !== 'ADMIN' && (
                <Link
                  href="/appointments"
                  className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
                  onClick={onClose}
                >
                  {t('nav.myBookings')}
                </Link>
              )}
              <button
                onClick={() => {
                  // Flips the header to signed-out immediately (optimistic);
                  // closing the menu reveals that state as instant feedback.
                  onSignOut();
                  onClose();
                }}
                className="text-zinc-400 hover:text-white text-xl tracking-wide uppercase w-full text-left transition-colors"
              >
                {t('nav.signOut')}
              </button>
            </>
          ) : (
            <Link
              href="/auth/signin"
              className="text-zinc-400 hover:text-white text-xl tracking-wide transition-colors"
              onClick={onClose}
            >
              {t('nav.signIn')}
            </Link>
          )}
        </nav>
        
        <div className="mt-auto shrink-0 pt-2">
          <Link
            href="/book"
            className="block w-full bg-white text-zinc-900 py-4 text-center text-lg uppercase tracking-widest font-bold hover:bg-zinc-200 transition-colors rounded-sm"
            onClick={onClose}
          >
            {t('nav.bookNow')}
          </Link>
        </div>
      </div>
    </dialog>,
    document.body
  );
}
