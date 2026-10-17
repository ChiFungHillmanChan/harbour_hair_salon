'use client';

import Link from '@/i18n/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { clearLocalAccountState } from '@/app/lib/sign-out';
import { SIGN_OUT_PATH } from '@/app/lib/sign-out-policy';
import { splitLocalePath, stripLocale } from '@/i18n/paths';
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
}

/** Disables itself once the sign-out POST has left so it can't be re-clicked. */
function SignOutButton({ pending }: { pending: boolean }) {
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
export function AdminSidebar({ userId }: AdminSidebarProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
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
    const drawer = drawerRef.current;
    const menuButton = menuButtonRef.current;
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([type="hidden"])') ?? [])
      .filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (e.shiftKey && (document.activeElement === first || !drawer?.contains(document.activeElement))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !drawer?.contains(document.activeElement))) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (menuButton?.getClientRects().length) menuButton.focus();
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
      <div className="sticky top-0 z-30 flex min-h-16 items-center gap-1.5 bg-zinc-900 px-3 py-2 text-white lg:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('sidebar.openMenu')}
          aria-expanded={open}
          aria-controls="admin-navigation-drawer"
          className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-zinc-800 transition-colors"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h2 className="min-w-0 flex-1 font-serif text-sm font-bold leading-tight tracking-wide sm:text-lg">{t('sidebar.title')}</h2>
        <LanguageSwitcher tone="dark" className="ml-auto shrink-0" />
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
        ref={drawerRef}
        id="admin-navigation-drawer"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={t('sidebar.navLabel')}
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-72 max-w-[85vw] flex-col bg-zinc-900 text-white transition-transform duration-200 ease-in-out motion-reduce:transition-none lg:sticky lg:top-0 lg:z-auto lg:w-64 lg:shrink-0 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full invisible lg:visible'
        }`}
      >
        <div className="shrink-0 border-b border-zinc-800 px-6 pb-2 pt-4 lg:pt-6">
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

        <nav aria-label={t('sidebar.navLabel')} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-4">
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

        <div className="shrink-0 border-t border-zinc-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-4 px-4">
            <p className="text-xs uppercase text-zinc-500">{t('sidebar.loggedInAs')}</p>
            <p className="truncate text-sm font-medium">{userId}</p>
          </div>
          {/* A plain POST: the route ends every session of this admin and
              clears the site's cache and storage. Unsaved drafts kept for a
              language switch belong to this session only; they go first. */}
          <form
            method="post"
            action={SIGN_OUT_PATH}
            onSubmit={() => {
              clearLocalAccountState();
              setSigningOut(true);
            }}
          >
            <input type="hidden" name="locale" value={splitLocalePath(pathname).locale} />
            <SignOutButton pending={signingOut} />
          </form>
        </div>
      </aside>
    </>
  );
}
