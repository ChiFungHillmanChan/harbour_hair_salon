'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import type { Locale } from './config';
import { useLocale } from './client';
import { localizeHref } from './paths';

type LinkProps = ComponentProps<typeof NextLink> & {
  /** Force a language (the language switcher); defaults to the page's own. */
  locale?: Locale;
};

/**
 * Drop-in replacement for next/link that keeps visitors in their language:
 * `/services` becomes `/zh-hk/services` on Chinese pages. External, API,
 * file and `#anchor` hrefs pass through unchanged.
 */
export default function Link({ href, locale, ...props }: LinkProps) {
  const current = useLocale();
  const target = locale ?? current;
  const localized = typeof href === 'string'
    ? localizeHref(target, href)
    : href.pathname
      ? { ...href, pathname: localizeHref(target, href.pathname) }
      : href;
  return <NextLink href={localized} {...props} />;
}
