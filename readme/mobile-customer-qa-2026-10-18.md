# Customer mobile UI verification — 18 October 2026

Branch: `codex/mobile-home-booking-polish`.

## Changes

- Home: compact header/menu, smaller section gaps, phone action above side-by-side booking partners, readable service prices, two-column mobile stylist cards and safe-area spacing below the fixed booking bar.
- Full landing-page follow-up: full-width FAQ question targets and tighter answer spacing; 44 × 44px social icons; compact booking promotion; two-column footer quick links; contact/hours side by side from 400px (stacked on narrower phones); clearer footer contrast and 44px legal links. Services/team/contact anchors clear the sticky header.
- Booking: shorter mobile banner; compact service/stylist choices; horizontal dates contained inside the card; 44px time/action targets; selected time visible above Continue; full-width mobile deposit action. Steps and consultation notices receive focus and scroll into view after a choice.
- My Bookings: wrapping actions and smaller card padding. Rescheduling uses a native modal with background scroll locking, keyboard focus containment, Escape dismissal and visible actions on short screens.
- Closed booking: the same compact phone/partner layout. Booking, deposit, cancellation, locale and access rules are unchanged.

## Checks

- `pnpm test`: 2,366 passed, none failed.
- `pnpm lint`, `pnpm exec tsc --noEmit`, `git diff --check`: passed.
- `pnpm build`: passed with the existing migrations applied to a disposable local PostgreSQL 18 `salon_test` database. No production or preview database was used. Local runtime: Node 22.22.0 (the project targets Node 24).
- Final targeted closed-booking, booking-link and footer-routing tests passed.
- Chrome: 320, 375, 390, 430, 768 and 1440px; English and Traditional Chinese at each width.
- WebKit: 320 and 390px; both languages.
- Checked home, services, team, menu, service options, stylists, unavailable dates, available times, review/deposit, completion, appointments and rescheduling. No document overflow or runtime errors. Step focus/visibility, modal background isolation, Escape and scroll restoration passed.
- Extra checks in both engines/languages: closed booking at 320px, long consultation service names and price notes, and fully visible reschedule actions at 844 × 390px. Signed-in menu checked at 320/390px in Chrome.
- Complete landing-page follow-up: all sections through the footer rendered in Chrome at 320/375/390/430/768/1440px and WebKit at 320/390/430px, both languages (18 combinations). FAQ edge taps and Enter/Space toggling, mobile/tablet target dimensions, anchor clearance, document overflow and footer clearance above the fixed booking bar passed. No runtime errors. Fourteen targeted home/footer/social/brand/translation checks passed; the independent follow-up review found no actionable findings.

## Scope of browser verification

Browser checks rendered the actual UI components with sample catalogue/appointment data. Server actions, Next navigation/image adapters and Square card mounting were stubbed locally; these checks do not represent a real sign-in or card transaction. Viewports were emulated, not physical devices. Screenshots and fixture scripts are local working artifacts under `output/playwright/mobile-polish/`.

An independent code review found no remaining actionable findings. No deployment was performed.
