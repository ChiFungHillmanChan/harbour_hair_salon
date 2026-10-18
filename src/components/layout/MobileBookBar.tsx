'use client';

import Link from '@/i18n/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/i18n/client';
import { stripLocale } from '@/i18n/paths';

/**
 * Persistent mobile "Book" call-to-action. Salon traffic is mostly mobile, where
 * "Book" otherwise hides behind the hamburger after the hero scrolls away.
 * Hidden on the booking flow, auth pages, admin and on desktop (md+).
 * The optional tour on About keeps this route to booking visible.
 */
export function MobileBookBar() {
  const pathname = stripLocale(usePathname());
  const t = useT('common');
  if (
    pathname.startsWith('/book') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/auth')
  ) {
    return null;
  }

  return (
    <>
      {/* Spacer so the fixed bar never covers the end of the footer on mobile. */}
      <div className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" aria-hidden="true" />
      <div className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-zinc-200 bg-white/95 backdrop-blur px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.25)]">
        <Link
          href="/book"
          className="flex min-h-11 w-full items-center justify-center bg-zinc-900 text-white text-center px-4 py-2.5 text-sm font-semibold hover:bg-black transition-colors rounded-sm"
        >
          {t('nav.bookAppointment')}
        </Link>
      </div>
    </>
  );
}
