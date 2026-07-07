# Responsive Mobile & iPad Retrofit — Admin Panel, Auth Pages, Booking Wizard

**Date:** 2026-07-07
**Status:** Approved by owner (approach + all UX decisions confirmed in session)
**Branch:** `feat/responsive-mobile-ipad` (off `feat/password-eye-toggle`, PR #22)

## Problem

The site is desktop-only in three areas:

1. **Admin panel** (`src/app/admin/layout.tsx`): a hard-coded `w-64` sidebar is always
   visible with no toggle. On a 375px phone it consumes 256px, leaving ~120px for
   content, and cannot be closed. With 16 nav links the sidebar also pushes
   "Sign Out" off-screen on short viewports even on desktop (no `overflow-y-auto`).
2. **Admin data tables**: 10 pages (`users`, `services`, `categories`, `stylists`,
   `discounts`, `blog`, `employees`, `payroll`, `shifts`, `timesheets`) render
   `<table>` inside an `overflow-hidden` card — columns get crushed/clipped on
   mobile and iPad portrait with no way to scroll.
3. **Auth pages** (`/auth/signin`, `/auth/register`): the site-wide fixed
   `MobileBookBar` ("Book Appointment") excludes `/book` and `/admin` but not
   `/auth/*`, so it floats over the sign-in screen on mobile. The full marketing
   footer (booking CTA strip + newsletter + link columns) also renders below the
   auth card. Card padding (`p-10`) is heavy on small phones.
4. **Booking wizard** (`src/components/booking/BookingWizard.tsx`): partially
   responsive but rough on phones/iPad — heavy `p-8` card padding, `min-h-[600px]`
   forced on all sizes, single-column stylist list on phones, `scale-105` selected
   states that clip/jitter inside scroll containers, no scroll-snap on the 14-day
   date strip, `grid-cols-2` confirm summary squeezed on phones, no safe-area
   padding on sticky footer buttons. Book page hero (`py-24`, `text-5xl`) pushes
   the form far below the fold on phones.

## Decisions (confirmed with owner)

- **Admin nav on mobile / iPad portrait:** slide-in drawer over content with dimmed
  backdrop, opened from a hamburger top bar; fixed sidebar unchanged on `lg:`+
  (desktop / iPad landscape).
- **Admin tables:** keep table layout on all devices; wrap in horizontal touch
  scroll. No card conversion.
- **Auth pages:** remove the floating Book bar AND swap the marketing footer for a
  one-line slim footer (copyright + Privacy link). Header stays.
- **Approach:** full retrofit without restructuring into route groups. Root layout
  keeps its pathname-based shell switching (extended to auth).

## Design

### 1. Admin shell — `AdminSidebar` client component

New `src/components/admin/AdminSidebar.tsx` (`'use client'`). The existing server
`admin/layout.tsx` keeps `verifySession()` + role check and renders
`<AdminSidebar userId={session.userId} logoutAction={logout} />` — server actions
are passable to client components as props.

Behaviour:

- **`lg:`+ (≥1024px):** static `w-64` sidebar, exactly as today.
- **<`lg:`:** sidebar off-canvas (`-translate-x-full`, `transition-transform`),
  rendered as `fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]`. A sticky top bar
  (`lg:hidden`, dark to match sidebar) shows a ☰ button (≥44px target,
  `aria-expanded`, `aria-label`) and the "ADMIN PANEL" title.
- **Backdrop:** `fixed inset-0 bg-black/50 z-40` shown while open; tap closes.
- **Close triggers:** backdrop tap, ✕ button in drawer header, route change
  (`usePathname` effect), Escape key.
- **Body scroll lock** while the drawer is open (`document.body.style.overflow`).
- **Nav list:** `overflow-y-auto` so all 16 links + Sign Out are reachable on any
  viewport height (fixes the desktop overflow too). Link touch targets ≥44px
  (`py-2.5`+).
- Layout wrapper changes from `flex` to `lg:flex` with the top bar stacked above
  content on small screens; `<main>` becomes full-width under `lg:`.

### 2. Admin pages — scrollable tables + padding

On each of the 10 table pages:

- Table card container: `overflow-hidden` → `overflow-x-auto` (rounded card look
  preserved; `whitespace-nowrap` cells keep columns tidy so the table scrolls
  sideways as one unit on touch).
- Page wrapper: `p-8` → `p-4 sm:p-6 lg:p-8`.
- Page `h1`: `text-3xl` → `text-2xl sm:text-3xl`.

No table markup or column changes. Non-table admin pages (settings, offers, faqs,
reviews, schedule) get the same wrapper padding/heading treatment where they use
`p-8` — nothing structural.

### 3. Auth pages — clean shell

- **`src/middleware.ts`:** add `'/auth/:path*'` to `config.matcher`. Auth paths hit
  no protection branch; the middleware just sets `x-pathname` (and may refresh a
  sliding session, which is harmless). This lets the root layout detect auth pages
  server-side, same mechanism admin/kiosk already use.
- **`src/app/layout.tsx`:** new `authShell` condition (`pathname.startsWith('/auth')`):
  render `<Header />` + children + slim footer; skip `<Footer />` and
  `<MobileBookBar />`.
- **Slim footer:** one-line server component (inline in layout or
  `src/components/layout/SlimFooter.tsx`): `© {year} Harbour Hair Salon · Privacy`
  on a dark strip matching the brand. No DB queries.
- **`MobileBookBar.tsx`:** add `pathname?.startsWith('/auth')` to the exclusion
  list as a client-side safety net (covers any route the middleware matcher
  misses).
- **Card polish** (signin + register): card `p-10` → `p-6 sm:p-10`; heading
  `text-3xl` → `text-2xl sm:text-3xl`; outer wrapper `py-12 px-4` → `py-8 sm:py-12`
  so the card sits comfortably above the keyboard on small phones. Inputs already
  have ≥44px targets (`py-3`) — unchanged.

### 4. Booking wizard — responsive pass

`src/app/book/page.tsx`:

- Hero: `py-24` → `py-14 md:py-24`; `text-5xl md:text-6xl` → `text-4xl md:text-6xl`;
  subtitle `text-lg md:text-xl` → `text-base md:text-xl`.
- Wizard container: `px-4 py-12` → `px-4 py-8 md:py-12`.

`src/components/booking/BookingWizard.tsx`:

- Card: `p-8 min-h-[600px]` → `p-4 sm:p-6 md:p-8 md:min-h-[600px]`.
- Service cards: `p-6` → `p-4 sm:p-6`; on stacked (mobile) layout the price moves
  into the flow under the name rather than floating right.
- Stylist step: `grid-cols-1 sm:grid-cols-3` → `grid-cols-2 md:grid-cols-3`;
  avatar `w-24 h-24` → `w-16 h-16 sm:w-24 sm:h-24`; card `p-6` → `p-4 sm:p-6`.
- Date strip (mobile horizontal scroll): add `snap-x snap-mandatory` on the
  scroller and `snap-start` on items; replace selected `scale-105` with
  `ring-2 ring-zinc-900 ring-offset-2` (scale clips inside the scroll container).
  `lg:` vertical list unchanged.
- Time slots: keep `grid-cols-3 sm:grid-cols-4`; `min-h-[44px]`; selected state
  ring instead of `scale-105`.
- Step DATE sticky footer: add safe-area padding
  (`pb-[max(0.5rem,env(safe-area-inset-bottom))]`).
- Confirm step: summary `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` (full-width
  rows keep `sm:col-span-2`); discount code row stacks under `sm:`
  (`flex-col sm:flex-row`) so the input isn't squeezed.
- Step indicator: `w-12` segments → `w-8 sm:w-12` so 4 segments fit tiny screens.

### 5. Out of scope

- No route-group restructuring; no DB/schema changes; no new dependencies.
- No card-style table conversion.
- Kiosk, appointments, marketing pages untouched (beyond the shared layout logic).
- `ScheduleCalendar` month grid is usable at iPad sizes; only inherits page-padding
  changes, no calendar redesign.

## Error handling

Pure presentational work — no new failure modes. The drawer is client-state only;
if JS fails, `lg:`+ still shows the full sidebar and small screens show the top bar
(links unreachable only in the no-JS + mobile corner case, same class of degradation
as the existing site-wide `MobileNav`). Middleware matcher addition changes no auth
behaviour: `/auth` paths hit no protection branch.

## Testing & verification

1. `npx tsc --noEmit`, `pnpm lint`, and the repo's existing test runner
   (`--conditions=react-server` script) must pass.
2. Live visual verification against `pnpm dev` in Chrome at:
   - 375×812 (phone): admin drawer open/close/navigate, tables swipe, auth pages
     (no Book bar, slim footer), full booking flow through all 4 steps.
   - 768×1024 (iPad portrait): drawer behaviour, tables, wizard two-column layouts.
   - 1280×800 (desktop / iPad landscape): sidebar static, no regressions.
3. `readme/structure.md` updated with `AdminSidebar` (and `SlimFooter` if a
   separate file).

## Amendments (post final review, 2026-07-07)

- **Auth footer swap is client-side.** The x-pathname/server-layout approach went
  stale across soft navigation (App Router layouts don't re-render client-side),
  leaking the slim footer onto marketing pages. `FooterSwitcher` (client,
  usePathname) now picks between the server-rendered `Footer`+`MobileBookBar`
  and `SlimFooter`. The `/auth/:path*` middleware matcher entry was reverted.
- **Desktop sidebar is intentionally sticky + viewport-height** with an
  internally scrolling nav (uses `h-dvh`). Earlier "desktop unchanged" wording
  was imprecise: keeping Sign Out reachable on short viewports was an explicit
  goal of this design.
- **Selected date/time states use the filled style only** (no outer
  `ring-offset` ring): outer rings are clipped by the date strip's scroll
  container and halo against the zinc-50 panel. This supersedes the earlier
  ring-2 wording.
- **Closed drawer is `invisible` below lg** so its controls are unreachable by
  keyboard while off-canvas.
