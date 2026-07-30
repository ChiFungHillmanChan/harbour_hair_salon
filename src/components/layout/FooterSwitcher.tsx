'use client';

import { usePathname } from 'next/navigation';

/**
 * Shows the booking promotion strip only on the homepage and hides all
 * footer chrome on auth pages, per route, on the client — so soft navigation
 * swaps the chrome correctly. The server root layout renders the chrome once
 * and passes it down; App Router
 * layouts don't re-render on soft navigation, so a server-side x-pathname
 * check would go stale the moment the visitor client-navigates away from an
 * auth page. Auth pages get no footer at all (owner request 2026-07-07).
 */
export function FooterSwitcher({
  homePromotions,
  footer,
  mobileBookBar,
}: {
  homePromotions: React.ReactNode;
  footer: React.ReactNode;
  mobileBookBar: React.ReactNode;
}) {
  const pathname = usePathname();
  const hidden = pathname?.startsWith('/auth') || pathname?.startsWith('/admin') || pathname?.startsWith('/kiosk');

  if (hidden) return null;

  return (
    <>
      {pathname === '/' && homePromotions}
      {footer}
      {mobileBookBar}
    </>
  );
}
