'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useLocale } from './client';
import { localizeHref } from './paths';

/**
 * next/navigation's router, keeping the visitor in their language:
 * `router.push('/appointments')` goes to /zh-hk/appointments on Chinese pages.
 */
export function useLocalizedRouter() {
  const router = useRouter();
  const locale = useLocale();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(localizeHref(locale, href), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(localizeHref(locale, href), options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(localizeHref(locale, href), options),
  }), [router, locale]);
}
