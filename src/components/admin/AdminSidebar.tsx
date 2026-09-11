'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

const NAV_LINKS = [
  { href: '/admin', label: 'Schedule' },
  { href: '/admin/opening-hours', label: 'Opening Hours' },
  { href: '/admin/services', label: 'Services & Pricing' },
  { href: '/admin/categories', label: 'Category Pages' },
  { href: '/admin/stylists', label: 'Stylists' },
  { href: '/admin/faqs', label: 'FAQs' },
  { href: '/admin/discounts', label: 'Discounts' },
  { href: '/admin/offers', label: 'Offers' },
  { href: '/admin/reviews', label: 'Reviews' },
  { href: '/admin/blog', label: 'Journal' },
  { href: '/admin/users', label: 'Admin Users' },
  { href: '/admin/settings', label: 'Site Settings' },
  { href: '/admin/integrations', label: 'Integrations' },
  { href: '/admin/operations', label: 'Operations' },
  { href: '/admin/employees', label: 'Employees' },
  { href: '/admin/timesheets', label: 'Timesheets' },
  { href: '/admin/shifts', label: 'Shifts' },
  { href: '/admin/payroll', label: 'Payroll' },
  { href: '/kiosk', label: 'Kiosk' },
];

interface AdminSidebarProps {
  userId: string;
  logoutAction: () => Promise<void>;
}

/** Disables itself while the logout action runs so it can't be re-clicked. */
function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="w-full rounded bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
    >
      {pending ? 'Signing Out…' : 'Sign Out'}
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
          aria-label="Open admin menu"
          aria-expanded={open}
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded hover:bg-zinc-800 transition-colors"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h2 className="text-lg font-serif font-bold tracking-wider">ADMIN PANEL</h2>
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
        <div className="flex items-center justify-between border-b border-zinc-800 p-6">
          <h2 className="text-xl font-serif font-bold tracking-wider">ADMIN PANEL</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close admin menu"
            className="-mr-3 flex h-11 w-11 items-center justify-center rounded hover:bg-zinc-800 transition-colors lg:hidden"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded px-4 py-2.5 hover:bg-zinc-800 transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-zinc-800 p-4">
          <div className="mb-4 px-4">
            <p className="text-xs uppercase text-zinc-500">Logged in as</p>
            <p className="truncate text-sm font-medium">{userId}</p>
          </div>
          <form action={logoutAction}>
            <SignOutButton />
          </form>
        </div>
      </aside>
    </>
  );
}
