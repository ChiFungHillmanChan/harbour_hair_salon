'use client';

import { usePathname, useRouter } from 'next/navigation';
import { LOCALE_COOKIE, LOCALE_LABEL, LOCALES, type Locale } from './config';
import { useLocale, useT } from './client';
import { announceLanguageSwitch } from './draft-store';
import { switchLocaleHref } from './paths';

/**
 * Remember a MANUAL choice for one year. Read only where a request carries no
 * language of its own (the OAuth callback); it never overrides a URL.
 */
function rememberLocale(target: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * "English｜繁體中文". Moves to the same page, query and #anchor in the other
 * language with a soft navigation, so the in-memory draft store (draft-store.ts)
 * can hand unsaved state to the remounted page. It never submits a form.
 *
 * `className` is for spacing and type size only. To hide it at some widths,
 * wrap it — its own `inline-flex` wins over a `hidden` passed in here.
 */
export function LanguageSwitcher({ className = '', tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const locale = useLocale();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const t = useT('common');

  const choose = (target: Locale) => {
    rememberLocale(target);
    if (target === locale) return;
    announceLanguageSwitch(pathname);
    router.push(switchLocaleHref(target, pathname, window.location.search, window.location.hash), { scroll: false });
  };

  const idle = tone === 'dark' ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900';
  const active = tone === 'dark' ? 'text-white' : 'text-zinc-900';
  return (
    <div role="group" aria-label={t('language.label')} className={`inline-flex items-center gap-1 text-xs tracking-wide ${className}`}>
      {LOCALES.map((option, index) => (
        <span key={option} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden="true" className="text-zinc-500">｜</span>}
          <button
            type="button"
            lang={option}
            onClick={() => choose(option)}
            aria-pressed={option === locale}
            className={`min-h-11 min-w-11 px-1 font-medium transition-colors ${option === locale ? active : idle}`}
          >
            {LOCALE_LABEL[option]}
          </button>
        </span>
      ))}
    </div>
  );
}
