'use client';

import Link from '@/i18n/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useT } from '@/i18n/client';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { clearAllDrafts } from '@/i18n/draft-store';
import { stripLocale } from '@/i18n/paths';
import type { Messages } from '@/i18n/messages/types-client';
import type { MessageKey } from '@/i18n/translator';

const NAV_LINKS: { href: string; label: MessageKey<Messages['admin']> }[] = [
  { href: '/admin', label: 'nav.schedule' },
  { href: '/admin/opening-hours', label: 'nav.openingHours' },
  { href: '/admin/services', label: 'nav.services' },
  { href: '/admin/categories', label: 'nav.categories' },
  { href: '/admin/stylists', label: 'nav.stylists' },
  { href: '/admin/faqs', label: 'nav.faqs' },
  { href: '/admin/discounts', label: 'nav.discounts' },
  { href: '/admin/offers', label: 'nav.offers' },
  { href: '/admin/reviews', label: 'nav.reviews' },
  { href: '/admin/blog', label: 'nav.journal' },
  { href: '/admin/users', label: 'nav.users' },
  { href: '/admin/settings', label: 'nav.settings' },
  { href: '/admin/integrations', label: 'nav.integrations' },
  { href: '/admin/operations', label: 'nav.operations' },
  { href: '/admin/employees', label: 'nav.employees' },
  { href: '/admin/timesheets', label: 'nav.timesheets' },
  { href: '/admin/shifts', label: 'nav.shifts' },
  { href: '/admin/payroll', label: 'nav.payroll' },
  { href: '/kiosk', label: 'nav.kiosk' },
];

/** The schedule lives at /admin itself, so it only matches exactly. */
function isActive(path: string, href: string): boolean {
  return path === href || (href !== '/admin' && path.startsWith(`${href}/`));
}

interface AdminSidebarProps {
  userId: string;
  logoutAction: () => Promise<void>;
}

/** Disables itself while the logout action runs so it can't be re-clicked. */
function SignOutButton() {
  const { pending } = useFormStatus();
  const t = useT('admin');
  return (
    <button
      disabled={pending}
      className="w-full rounded bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
    >
      {pending ? t('sidebar.signingOut') : t('sidebar.signOut')}
    </button>
  );
}

/**
 * Admin nav shell. Below lg it renders a sticky top bar with a hamburger that
 * opens the sidebar as a slide-in drawer (backdrop, Escape, tap-outside and
 * route-change all close it). From lg up it is the always-visible sidebar,
 * sticky and viewport-height so Sign Out stays reachable on short screens.
 */
export function AdminSidebar({ userId, logoutAction }: AdminSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const path = stripLocale(pathname);
  const t = useT('admin');

  // Close the drawer whenever the route changes (a nav link was tapped).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closes drawer on route change; new rule from eslint-config-next 16.2.10, same idiom as BookingWizard
    setOpen(false);
  }, [pathname]);

  // While open: Escape closes, and the page behind the drawer must not scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // If the viewport grows past lg while the drawer is open (e.g. iPad
  // rotation), the drawer becomes the static sidebar — reset state so the
  // scroll lock lifts and the backdrop doesn't reappear on the next shrink.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 bg-zinc-900 px-4 py-2.5 text-white lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('sidebar.openMenu')}
          aria-expanded={open}
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded hover:bg-zinc-800 transition-colors"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h2 className="text-lg font-serif font-bold tracking-wider">{t('sidebar.title')}</h2>
        <LanguageSwitcher tone="dark" className="ml-auto" />
      </div>

      {/* Backdrop while the drawer is open */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar: off-canvas drawer < lg, sticky viewport-height column ≥ lg */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-zinc-900 text-white transition-[transform,visibility] duration-200 ease-in-out lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-64 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full invisible lg:visible'
        }`}
      >
        <div className="border-b border-zinc-800 px-6 pb-2 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-bold tracking-wider">{t('sidebar.title')}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('sidebar.closeMenu')}
              className="-mr-3 flex h-11 w-11 items-center justify-center rounded hover:bg-zinc-800 transition-colors lg:hidden"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <LanguageSwitcher tone="dark" className="-ml-1" />
        </div>

        <nav aria-label={t('sidebar.navLabel')} className="flex-1 space-y-1 overflow-y-auto p-4">
          {NAV_LINKS.map(({ href, label }) => {
            const active = isActive(path, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`block rounded px-4 py-2.5 transition-colors hover:bg-zinc-800 ${active ? 'bg-zinc-800 font-semibold' : ''}`}
              >
                {t(label)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-800 p-4">
          <div className="mb-4 px-4">
            <p className="text-xs uppercase text-zinc-500">{t('sidebar.loggedInAs')}</p>
            <p className="truncate text-sm font-medium">{userId}</p>
          </div>
          {/* Unsaved drafts kept for a language switch belong to this admin
              session only; drop them before the account signs out. */}
          <form action={logoutAction} onSubmit={() => clearAllDrafts()}>
            <SignOutButton />
          </form>
        </div>
      </aside>
    </>
  );
}
