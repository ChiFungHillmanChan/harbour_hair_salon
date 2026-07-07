# Mobile & iPad Responsive Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin panel (slide-in drawer sidebar), admin data tables (horizontal touch scroll), auth pages (slim footer, no floating Book bar), and booking wizard fully usable on phones and iPads.

**Architecture:** Pure presentational retrofit — no schema, route, or dependency changes. The admin sidebar becomes a client component (`AdminSidebar`) owning drawer state, rendered by the existing server layout which keeps auth checks and passes the `logout` server action as a prop. Auth pages are detected server-side via the existing `x-pathname` middleware header (matcher extended to `/auth/:path*`) so the root layout can swap in a slim footer. Everything else is Tailwind class adjustments to existing markup.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS v4, TypeScript. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-07-responsive-mobile-ipad-design.md`

## Global Constraints

- Tailwind CSS only for styling; monochrome brand (black/white/zinc greys) — do not introduce colour.
- Touch targets ≥44px on interactive mobile controls.
- Never access env vars at module level.
- `pnpm build` fails locally (no DB) — verify with `npx tsc --noEmit`, `pnpm lint`, `pnpm test` instead.
- These are presentational changes with no unit-testable logic; each task's gate is tsc + lint clean, plus the final live visual verification task (which uses the repo's existing test runner too).
- Commit after every task. Branch: `feat/responsive-mobile-ipad`.

---

### Task 1: AdminSidebar client component + admin layout rewrite

**Files:**
- Create: `src/components/admin/AdminSidebar.tsx`
- Modify: `src/app/admin/layout.tsx` (full rewrite of the returned JSX; keep session logic)

**Interfaces:**
- Consumes: `logout` server action from `@/app/actions/auth` (signature `() => Promise<void>` when used as a form action), `verifySession()` from `@/app/lib/session`.
- Produces: `AdminSidebar({ userId, logoutAction }: { userId: string; logoutAction: () => Promise<void> })` — named export, client component. Later tasks don't consume it; the layout is its only caller.

- [ ] **Step 1: Create `src/components/admin/AdminSidebar.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV_LINKS = [
  { href: '/admin', label: 'Schedule' },
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
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-zinc-900 text-white transition-transform duration-200 ease-in-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
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
            <button className="w-full rounded bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700">
              Sign Out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Rewrite `src/app/admin/layout.tsx`**

Replace the entire file body with (session logic unchanged, JSX replaced):

```tsx
import { verifySession } from '@/app/lib/session';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  if (session.role !== 'ADMIN') {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-zinc-50 lg:flex">
      <AdminSidebar userId={session.userId} logoutAction={logout} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
```

Note: the `Link` import disappears from the layout (moved into `AdminSidebar`); don't leave it behind or lint fails on unused imports.

- [ ] **Step 3: Verify types and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0, no output errors. (Passing a server action as a client-component prop is supported; if tsc complains about the `logoutAction` prop type, check the `logout` signature in `src/app/actions/auth.ts` and mirror it exactly in `AdminSidebarProps`.)

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminSidebar.tsx src/app/admin/layout.tsx
git commit -m "feat(admin): responsive sidebar — slide-in drawer on mobile/iPad portrait"
```

---

### Task 2: Admin tables horizontal scroll + page padding/heading tuning

**Files:**
- Modify: `src/app/admin/users/page.tsx`, `src/app/admin/discounts/page.tsx`, `src/app/admin/categories/page.tsx`, `src/app/admin/blog/page.tsx`, `src/app/admin/stylists/page.tsx`, `src/app/admin/services/page.tsx`, `src/app/admin/employees/page.tsx`, `src/app/admin/shifts/page.tsx`, `src/app/admin/timesheets/page.tsx`, `src/app/admin/payroll/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/offers/page.tsx`, `src/app/admin/faqs/page.tsx`, `src/app/admin/reviews/page.tsx`, `src/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (independent of Task 1).
- Produces: nothing consumed later — self-contained class edits.

All edits are exact string replacements. Line numbers are as of branch point (verify with grep if drifted).

- [ ] **Step 1: Card-wrapped tables — make the card the scroll container**

In these files, on the given line, replace the container class ending `overflow-hidden` with `overflow-x-auto`:

| File | Line | Old class | New class |
|---|---|---|---|
| `users/page.tsx` | 24 | `bg-white rounded-lg shadow border border-zinc-200 overflow-hidden` | `bg-white rounded-lg shadow border border-zinc-200 overflow-x-auto` |
| `discounts/page.tsx` | 21 | `bg-white rounded-lg shadow border border-zinc-200 overflow-hidden` | `bg-white rounded-lg shadow border border-zinc-200 overflow-x-auto` |
| `categories/page.tsx` | 42 | `bg-white border border-zinc-200 rounded-lg overflow-hidden` | `bg-white border border-zinc-200 rounded-lg overflow-x-auto` |
| `blog/page.tsx` | 68 | `bg-white border border-zinc-200 rounded-lg overflow-hidden` | `bg-white border border-zinc-200 rounded-lg overflow-x-auto` |
| `stylists/page.tsx` | 52 | `bg-white border border-zinc-200 rounded-lg overflow-hidden` | `bg-white border border-zinc-200 rounded-lg overflow-x-auto` |
| `services/page.tsx` | 82 | `bg-white border border-zinc-200 rounded-lg overflow-hidden` | `bg-white border border-zinc-200 rounded-lg overflow-x-auto` |

Do NOT touch `faqs/page.tsx:91` (`overflow-hidden` there wraps the FAQ editor sections, not a table).

- [ ] **Step 2: Bare tables — wrap in a scroll div**

In `employees/page.tsx` (line 24), `shifts/page.tsx` (line 30), `timesheets/page.tsx` (line 78), `payroll/page.tsx` (line 48), wrap the whole `<table className="w-full text-sm border-collapse">…</table>` element:

```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm border-collapse">
    …existing table content unchanged…
  </table>
</div>
```

(One table per file. Indent the table body one level; JSX only, no logic changes.)

- [ ] **Step 3: Page wrapper padding**

Exact replacements:

| File | Line | Old | New |
|---|---|---|---|
| `page.tsx` (Schedule) | 10 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `users/page.tsx` | 16 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `services/page.tsx` | 27 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `categories/page.tsx` | 20 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `stylists/page.tsx` | 21 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `discounts/page.tsx` | 13 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `blog/page.tsx` | 22 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `offers/page.tsx` | 20 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `faqs/page.tsx` | 41 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `reviews/page.tsx` | 43 | `className="p-8"` | `className="p-4 sm:p-6 lg:p-8"` |
| `settings/page.tsx` | 11 | `className="p-8 max-w-4xl mx-auto"` | `className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto"` |
| `employees/page.tsx` | 13 | `className="p-6 space-y-8"` | `className="p-4 sm:p-6 space-y-8"` |
| `shifts/page.tsx` | 20 | `className="p-6 space-y-8"` | `className="p-4 sm:p-6 space-y-8"` |
| `payroll/page.tsx` | 36 | `className="p-6 space-y-6"` | `className="p-4 sm:p-6 space-y-6"` |
| `timesheets/page.tsx` | 71 | `className="p-6 space-y-6"` | `className="p-4 sm:p-6 space-y-6"` |

- [ ] **Step 4: Page `h1` headings scale down on phones**

Replace only the page-title `h1` classes (NOT the `text-3xl font-bold … mt-1` stat numbers):

- In `page.tsx`, `users`, `services`, `categories`, `stylists`, `discounts`, `blog`, `offers`, `faqs`, `reviews`, `settings` pages:
  `text-3xl font-serif font-bold text-zinc-900` → `text-2xl sm:text-3xl font-serif font-bold text-zinc-900`
- In `employees`, `shifts`, `payroll`, `timesheets` pages:
  `font-serif text-3xl text-zinc-900` → `font-serif text-2xl sm:text-3xl text-zinc-900`

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin
git commit -m "feat(admin): touch-scrollable tables + mobile padding across admin pages"
```

---

### Task 3: Auth shell — middleware matcher, slim footer, no Book bar

**Files:**
- Modify: `src/middleware.ts:113` (matcher)
- Modify: `src/app/layout.tsx:75-88` (shell switching)
- Create: `src/components/layout/SlimFooter.tsx`
- Modify: `src/components/layout/MobileBookBar.tsx:13` (exclusion list)

**Interfaces:**
- Consumes: existing `x-pathname` header mechanism set by middleware.
- Produces: `SlimFooter()` — named export, server component, no props, no DB queries. Only the root layout uses it.

- [ ] **Step 1: Extend the middleware matcher**

In `src/middleware.ts`, replace:

```ts
export const config = {
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*', '/reviews/new', '/kiosk/:path*'],
};
```

with:

```ts
export const config = {
  // /auth is matched only so x-pathname gets set (root layout renders a slim
  // footer there); auth paths hit none of the protection branches above.
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*', '/reviews/new', '/kiosk/:path*', '/auth/:path*'],
};
```

- [ ] **Step 2: Create `src/components/layout/SlimFooter.tsx`**

```tsx
import Link from 'next/link';

/**
 * One-line footer for focused flows (auth pages) where the full marketing
 * footer — booking CTA, newsletter, link columns — would compete with the task.
 */
export function SlimFooter() {
  return (
    <footer className="bg-zinc-900 py-6 text-center text-xs text-zinc-500">
      <div className="container mx-auto flex flex-col items-center justify-center gap-2 px-4 sm:flex-row sm:gap-4">
        <p>&copy; {new Date().getFullYear()} Harbour Hair Salon. All rights reserved.</p>
        <Link href="/privacy" className="hover:text-zinc-300 transition-colors">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Swap the footer on auth pages in `src/app/layout.tsx`**

Add the import:

```ts
import { SlimFooter } from "@/components/layout/SlimFooter";
```

Replace the shell block:

```tsx
  const pathname = (await headers()).get("x-pathname") ?? "";
  const bareShell =
    pathname.startsWith("/admin") || pathname.startsWith("/kiosk");

  return (
    <html lang="en-GB" className="scroll-smooth">
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        {!bareShell && <Header />}
        <main className="min-h-screen">
          {children}
        </main>
        {!bareShell && <Footer />}
        {!bareShell && <MobileBookBar />}
```

with:

```tsx
  const pathname = (await headers()).get("x-pathname") ?? "";
  const bareShell =
    pathname.startsWith("/admin") || pathname.startsWith("/kiosk");
  // Auth pages keep the header but swap the marketing footer + floating Book
  // bar for a one-line footer, so nothing competes with signing in.
  const authShell = pathname.startsWith("/auth");

  return (
    <html lang="en-GB" className="scroll-smooth">
      <body className="antialiased bg-zinc-50 text-zinc-900 font-sans">
        {!bareShell && <Header />}
        <main className="min-h-screen">
          {children}
        </main>
        {!bareShell && (authShell ? (
          <SlimFooter />
        ) : (
          <>
            <Footer />
            <MobileBookBar />
          </>
        ))}
```

(The `<Analytics />` / `<SpeedInsights />` lines after this block stay unchanged.)

- [ ] **Step 4: Client-side safety net in `MobileBookBar.tsx`**

Replace:

```tsx
  if (pathname?.startsWith('/book') || pathname?.startsWith('/admin')) return null;
```

with:

```tsx
  if (
    pathname?.startsWith('/book') ||
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/auth')
  ) {
    return null;
  }
```

Also update the component doc comment's "Hidden on…" sentence to mention auth pages.

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/app/layout.tsx src/components/layout/SlimFooter.tsx src/components/layout/MobileBookBar.tsx
git commit -m "feat(auth): slim footer on auth pages, remove floating Book bar there"
```

---

### Task 4: Auth card mobile polish (signin + register)

**Files:**
- Modify: `src/app/auth/signin/page.tsx:17-20`
- Modify: `src/app/auth/register/page.tsx:16-19`

**Interfaces:** none — self-contained class edits.

- [ ] **Step 1: Identical replacements in BOTH files**

Outer wrapper (signin:17, register:16):

```
flex min-h-[80vh] items-center justify-center bg-zinc-50 py-12 px-4 sm:px-6 lg:px-8
```
→
```
flex min-h-[80vh] items-center justify-center bg-zinc-50 py-8 sm:py-12 px-4 sm:px-6 lg:px-8
```

Card (signin:18, register:17):

```
w-full max-w-md space-y-8 bg-white p-10 shadow-xl rounded-xl
```
→
```
w-full max-w-md space-y-8 bg-white p-6 sm:p-10 shadow-xl rounded-xl
```

Heading `h2` (signin:20, register:19):

```
mt-6 text-3xl font-serif font-bold tracking-tight text-zinc-900
```
→
```
mt-2 sm:mt-6 text-2xl sm:text-3xl font-serif font-bold tracking-tight text-zinc-900
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth
git commit -m "feat(auth): mobile-friendly card sizing on signin/register"
```

---

### Task 5: Booking wizard + book page responsive pass

**Files:**
- Modify: `src/app/book/page.tsx:51-81`
- Modify: `src/components/booking/BookingWizard.tsx` (class-only edits at the lines below)

**Interfaces:** none — self-contained class edits, no state or handler changes.

- [ ] **Step 1: `src/app/book/page.tsx` hero + container**

| Line | Old | New |
|---|---|---|
| 51 | `className="relative py-24 bg-zinc-900 text-white overflow-hidden"` | `className="relative py-14 md:py-24 bg-zinc-900 text-white overflow-hidden"` |
| 64 | `className="text-5xl md:text-6xl font-serif mb-6 tracking-tight"` | `className="text-4xl md:text-6xl font-serif mb-6 tracking-tight"` |
| 67 | `className="text-lg md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed"` | `className="text-base md:text-xl text-zinc-300 max-w-2xl mx-auto font-light leading-relaxed"` |
| 81 | `className="container mx-auto px-4 py-12"` | `className="container mx-auto px-4 py-8 md:py-12"` |

- [ ] **Step 2: `BookingWizard.tsx` — card, step indicator, service cards**

| Line | Old (substring) | New |
|---|---|---|
| 256 | `max-w-4xl mx-auto bg-white shadow-xl p-8 min-h-[600px] rounded-xl border border-zinc-100` | `max-w-4xl mx-auto bg-white shadow-xl p-4 sm:p-6 md:p-8 md:min-h-[600px] rounded-xl border border-zinc-100` |
| 220 | `h-2 w-12 rounded-full` | `h-2 w-8 sm:w-12 rounded-full` |
| 366 | `border border-zinc-200 p-6 rounded-lg flex flex-col sm:flex-row justify-between` | `border border-zinc-200 p-4 sm:p-6 rounded-lg flex flex-col sm:flex-row justify-between` (rest of the class string unchanged) |

- [ ] **Step 3: `BookingWizard.tsx` — stylist step (2 columns on phones, smaller avatars)**

| Line | Old | New |
|---|---|---|
| 410 | `grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8` | `grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6 mb-8` |
| 414 ("Anyone" button) | `border border-dashed border-zinc-300 p-6 rounded-lg` | `border border-dashed border-zinc-300 p-4 sm:p-6 rounded-lg` (rest unchanged) |
| 416 ("Anyone" avatar) | `w-24 h-24 bg-zinc-100 rounded-full` | `w-16 h-16 sm:w-24 sm:h-24 bg-zinc-100 rounded-full` (rest unchanged) |
| 428 (stylist card) | `border border-zinc-200 p-6 rounded-lg text-center` | `border border-zinc-200 p-4 sm:p-6 rounded-lg text-center` (rest unchanged) |
| 430 (stylist avatar) | `w-24 h-24 bg-zinc-200 rounded-full` | `w-16 h-16 sm:w-24 sm:h-24 bg-zinc-200 rounded-full` (rest unchanged) |

- [ ] **Step 4: `BookingWizard.tsx` — date strip scroll-snap, drop scale jitter**

Line 466 (scroller): add snap classes —

```
flex lg:flex-col space-x-3 lg:space-x-0 lg:space-y-3 overflow-x-auto lg:overflow-visible pb-4 lg:pb-0 scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent
```
→
```
flex lg:flex-col space-x-3 lg:space-x-0 lg:space-y-3 overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none pb-4 lg:pb-0 scrollbar-thin scrollbar-thumb-zinc-300 scrollbar-track-transparent
```

Line 474 (date button base): `flex-shrink-0 w-20 lg:w-full p-3 rounded-lg border` → `flex-shrink-0 snap-start w-20 lg:w-full p-3 rounded-lg border` (rest unchanged)

Line 476 (selected state): `border-zinc-900 bg-zinc-900 text-white shadow-md transform scale-105` → `border-zinc-900 bg-zinc-900 text-white shadow-md ring-2 ring-zinc-900 ring-offset-2` (ring replaces the scale per spec — scale clips/jitters inside the scroll container)

- [ ] **Step 5: `BookingWizard.tsx` — time slots, sticky footer, confirm step**

| Line | Old | New |
|---|---|---|
| 747 (TimeSlotButton base) | `py-3 px-2 text-sm font-medium border rounded-lg transition-all relative overflow-hidden` | `min-h-[44px] py-3 px-2 text-sm font-medium border rounded-lg transition-all relative overflow-hidden` |
| 749 (TimeSlotButton selected) | `bg-zinc-900 text-white border-zinc-900 shadow-md scale-105 z-10` | `bg-zinc-900 text-white border-zinc-900 shadow-md ring-2 ring-zinc-900 ring-offset-2 z-10` |
| 577 (DATE sticky footer) | `flex justify-between items-center pt-6 border-t border-zinc-100 sticky bottom-0 bg-white pb-2 z-10` | `flex justify-between items-center pt-6 border-t border-zinc-100 sticky bottom-0 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] z-10` |
| 606 (confirm summary grid) | `grid grid-cols-2 gap-6 text-sm` | `grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 text-sm` |
| 612 (consultation row) | `className="col-span-2"` | `className="sm:col-span-2"` |
| 629 (total price row) | `col-span-2 border-t border-zinc-200 pt-4 mt-2` | `sm:col-span-2 border-t border-zinc-200 pt-4 mt-2` |
| 653 (discount row) | `className="flex gap-2"` | `className="flex flex-col sm:flex-row gap-2"` |

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/book/page.tsx src/components/booking/BookingWizard.tsx
git commit -m "feat(booking): mobile/iPad responsive pass on book page and wizard"
```

---

### Task 6: Registry update, full gates, live visual verification

**Files:**
- Modify: `readme/structure.md` (add new components)
- No code changes expected — fixes only if verification finds issues.

**Interfaces:** none.

- [ ] **Step 1: Register new components in `readme/structure.md`**

Append under the components sections (match the existing one-line style):

```markdown
- `src/components/admin/AdminSidebar.tsx` — admin nav shell: hamburger top bar + slide-in drawer < lg, sticky sidebar ≥ lg; closes on backdrop/✕/Escape/route change
- `src/components/layout/SlimFooter.tsx` — one-line footer (© + Privacy) used on /auth pages instead of the marketing footer
```

- [ ] **Step 2: Run all gates**

Run: `npx tsc --noEmit && pnpm lint && pnpm test`
Expected: all exit 0 (test runner: `node --conditions=react-server --import tsx --test`).

- [ ] **Step 3: Live visual verification (dev server + Chrome)**

Start `pnpm dev`, then check in Chrome at three window sizes:

1. **375×812 (phone):**
   - `/admin` (as admin): top bar with ☰; drawer opens, backdrop dims content; closes via backdrop tap, ✕, Escape, and after tapping a nav link; content full-width; body doesn't scroll behind open drawer.
   - `/admin/users`, `/admin/payroll`: tables swipe horizontally inside their card; page padding comfortable.
   - `/auth/signin`, `/auth/register`: NO floating "Book Appointment" bar, NO marketing footer/newsletter; slim one-line footer; card fits without horizontal scroll.
   - `/book` (signed in): hero compact; all 4 wizard steps usable — service cards, 2-column stylists, snap-scrolling date strip, ≥44px time slots, stacked confirm summary, discount input stacked; no horizontal page scroll anywhere.
2. **768×1024 (iPad portrait):** `/admin` still shows drawer pattern (below lg); tables fit or scroll; wizard uses sm: layouts sensibly.
3. **1280×800 (desktop/iPad landscape):** `/admin` sidebar static and always visible exactly as before, Sign Out reachable (nav scrolls internally if short window); marketing pages unchanged; auth pages show slim footer.

Expected: all checks pass; fix regressions before committing.

- [ ] **Step 4: Commit**

```bash
git add readme/structure.md
git commit -m "docs: register AdminSidebar and SlimFooter in structure.md"
```
