'use client';

import { usePathname } from 'next/navigation';

/**
 * Hides footer chrome on auth pages, per route, on the client — so soft navigation
 * swaps the chrome correctly. The server root layout renders the chrome once
 * and passes it down; App Router
 * layouts don't re-render on soft navigation, so a server-side x-pathname
 * check would go stale the moment the visitor client-navigates away from an
 * auth page. Auth pages get no footer at all (owner request 2026-07-07).
 */
export function FooterSwitcher({
  footer,
  mobileBookBar,
}: {
  footer: React.ReactNode;
  mobileBookBar: React.ReactNode;
}) {
  const pathname = usePathname();
  const hidden = pathname?.startsWith('/auth') || pathname?.startsWith('/admin') || pathname?.startsWith('/kiosk');

  if (hidden) return null;

  return (
    <>
      {footer}
      {mobileBookBar}
    </>
  );
}
