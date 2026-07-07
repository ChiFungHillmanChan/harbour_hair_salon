'use client';

import { usePathname } from 'next/navigation';

/**
 * Chooses the footer per route on the client so soft navigation swaps the
 * chrome correctly. The server root layout renders both variants once and
 * passes them down — App Router layouts don't re-render on soft navigation,
 * so a server-side x-pathname check goes stale the moment the visitor
 * client-navigates away from an auth page.
 */
export function FooterSwitcher({
  marketing,
  slim,
}: {
  marketing: React.ReactNode;
  slim: React.ReactNode;
}) {
  const pathname = usePathname();
  return pathname?.startsWith('/auth') ? slim : marketing;
}
