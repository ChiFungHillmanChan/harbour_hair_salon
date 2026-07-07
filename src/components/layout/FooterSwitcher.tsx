'use client';

import { usePathname } from 'next/navigation';

/**
 * Hides the marketing footer + book bar on auth pages, per route, on the
 * client — so soft navigation swaps the chrome correctly. The server root
 * layout renders the marketing chrome once and passes it down; App Router
 * layouts don't re-render on soft navigation, so a server-side x-pathname
 * check would go stale the moment the visitor client-navigates away from an
 * auth page. Auth pages get no footer at all (owner request 2026-07-07).
 */
export function FooterSwitcher({ marketing }: { marketing: React.ReactNode }) {
  const pathname = usePathname();
  return pathname?.startsWith('/auth') ? null : marketing;
}
