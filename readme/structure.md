# Project Structure

## Overview
This document tracks the architectural structure of the Harbour Hair Salon project.

## Directories
- `app/`: Next.js App Router routes and pages.
- `components/`: Reusable UI components.
- `lib/`: Shared utilities and Prisma client.
- `services/`: Business logic and service layer.
- `types/`: Shared TypeScript definitions.
- `prisma/`: Database schema and migrations.
- `readme/`: Project documentation.

## Key Components

### Try-Color (Virtual Hair Color Try-On)
- `src/app/try-color/page.tsx` — Server page with metadata
- `src/app/try-color/TryColorClient.tsx` — Main client orchestrator. Modes: `upload` (photo) and `video`; live camera is retained but disabled behind the `ENABLE_LIVE_CAMERA = false` flag. Holds the `bleachState` ('pre'/'post') state and threads it into every recolor request via `buildRecolorRequest`.
- `src/components/try-color/CameraView.tsx` — Camera feed (currently flag-disabled, code retained)
- `src/components/try-color/VideoTryOn.tsx` — Video-clip try-on: uploads a short clip, extracts/segments frames (`segmentStill`), recolors each frame with the engine, and plays them back with scrub + download-still. Guardrails: `VIDEO_MAX_SECONDS`, `VIDEO_MAX_DIM`, `VIDEO_TARGET_FPS`, `VIDEO_MAX_FRAMES`, `VIDEO_MAX_FILE_BYTES`, plus a slow-device fallback.
- `src/components/try-color/PreviewCanvas.tsx` — Preview surface for upload mode
- `src/components/try-color/segmentation.worker.ts` — Worker: MediaPipe segmentation (used by the flag-disabled live path)
- `src/components/try-color/HairSegmentation.ts` — Singleton ImageSegmenter + `segmentStill()` for photos and video frames
- `src/components/try-color/colorMath.ts` — Recolor engine. `bleachState` master mode: **漂前 ('pre')** = deposit-only (base-dominated, vivid shades mute on dark hair, warm-pigment bleed, lift capped); **漂後上色 ('post')** = pre-bleached canvas, target shown vivid/true via luminance (gray-level) mapping, original colour ignored. Key fns: `resolveRecolorContext`, `buildModeBaseColor`, `applyRecolorToImageDataWithAlpha`, `analyzeHair`.
- `src/components/try-color/constants.ts` — `BleachState` type, `RecolorRequest`, preset colors, hair-level/underlying-pigment tables, MediaPipe + video constants
- `src/components/try-color/ColorPalette.tsx` — Color swatches, custom picker, intensity slider, and the 漂前/漂後 method toggle
- `src/components/try-color/UploadDropzone.tsx` — Photo upload flow and validation
- `src/components/try-color/ResultActions.tsx` — Download button

### Colour Booking Gate (Consultation & Patch Test)
Colour services (`Service.requiresPatchTest`) require a COMPLETED Consultation & Patch Test (`Service.isPatchTest`) appointment ≥48h before and within 6 months of the colour date.
- `src/app/services/patch-test-eligibility.ts` — Pure logic: `evaluatePatchTestEligibility(tests, colourDate)` → `{ ok, testDate, reason }`; constants `PATCH_TEST_MIN_LEAD_HOURS` (48), `PATCH_TEST_VALIDITY_DAYS` (183). Unit-tested in `patch-test-eligibility.test.ts`.
- `src/app/services/booking-service.ts` — `getValidPatchTest(userId, colourDate)` queries the user's patch-test appointments and delegates to the pure function.
- `src/app/actions/booking.ts` — `submitBooking` and `rescheduleAppointment` enforce the gate server-side; `checkColourEligibility(serviceId, dateIso)` powers the wizard UX.
- `src/components/booking/BookingWizard.tsx` — Shows a blocking gate panel + "book Consultation & Patch Test first" CTA at the CONFIRM step; disables submit when ineligible.
- `src/app/actions/admin.ts` — `updateAppointmentStatus(appointmentId, status)` (admin-only) marks appointments COMPLETED — the signal that unlocks colour booking.
- `src/components/admin/ScheduleCalendar.tsx` — "Mark completed" control on CONFIRMED appointments.
- `src/components/admin/ServiceForm.tsx` + `src/app/actions/admin-services.ts` — manage `requiresPatchTest`/`isPatchTest` per service.

## Services
- `booking-service.ts` — slot availability, booking creation, patch-test eligibility query
- `offers-service.ts` — `hasActiveOffers()`: React-`cache()`d active-offer flag shared by Header + Footer (one count query per request)
- `email-service.ts` — Resend + React Email templates
- `patch-test-eligibility.ts` — pure colour-gate eligibility logic
- `consultation-routing.ts` — `resolveConsultationTarget(service, all)`: decides whether a service books directly or routes to a consultation target (colour → £10 Consultation & Patch Test, others → free Consultation, direct-bookable → null)
- `timesheet-calc.ts` — pure fns: `segmentWorkedMinutes`, `totalWorkedHours`, `splitRegularOvertime`; unit-tested
- `payroll-calc.ts` — pure fns: `computeGross` (HOURLY/SALARY/COMMISSION/HYBRID), `round2`; unit-tested
- `kiosk-state.ts` — pure fn: `nextClockAction(openEntry)` → `CLOCK_IN` or `CLOCK_OUT`; unit-tested
- `payroll-csv.ts` — `generatePayrollCsv(rows)` → RFC-4180 CSV string; unit-tested
- `payroll-service.ts` — server-only: `runPayroll(year, month)`, `updateAdjustment`, `finalizePayroll`; queries Prisma and delegates to calc modules
- `treatwell-ical.ts` — pure: `parseIcalBusyIntervals(icsText, opts)` → busy intervals from an iCal feed (node-ical); skips recurring/past/out-of-window; unit-tested
- `external-busy.ts` — `loadExternalBusy(db, stylistIds, window)` + `toBookedInterval`/`toSlotAppointment` converters; merges `ExternalBusyBlock` into the booking conflict checks; unit-tested
- `treatwell-sync-service.ts` — `syncTreatwellFeeds(deps?)`: fetch each stylist's Treatwell iCal → upsert `ExternalBusyBlock` → prune stale; fail-safe (no prune on fetch error); unit-tested
- `treatwell-api.ts` — provider-neutral Phase 2 contract, API environment readiness, stable booking command builder and queue-status rules; unit-tested. The official HTTP/auth adapter is intentionally deferred until Treatwell supplies its private API contract.
- `treatwell-api-worker.ts` — durable outbound queue processor. Accepts an injected official adapter, maps `PENDING` appointments to upsert/cancel commands, and records `SYNCED`/`FAILED` state for Admin retry; unit-tested.
- `integration-readiness.ts` — also `getTreatwellSyncCoverage()` (3 cheap counts) for the dashboard banner; admin-only, secret-safe readiness summary for Treatwell mappings/queue, Resend environment and Vercel ISR; also `listOutboundIcalFeeds(siteUrl)` → per-stylist outbound busy-feed URLs (secret — admin panel only).
- `stylist-ical-feed.ts` — `buildStylistIcalFeed(stylistId, token, deps?)`: token-guarded (timing-safe, uniform 404) per-stylist busy iCal for Treatwell Connect's "External Calendar" import; UTC VEVENTs, fixed `Busy` summary, no customer PII; unit-tested.
- `treatwell-sync-coverage.ts` — pure `evaluateSyncCoverage({totalStylists, inboundConfigured, outboundConfigured})` → whether BOTH sync directions cover every stylist, plus an operator warning. Drives the double-booking banner on the admin dashboard and Integrations page; unit-tested
- `booking-confirmation-copy.ts` — plain-text fallback for the branded Resend confirmation email; unit-tested.

## API Routes
- `src/app/api/cron/reminders/route.ts` — daily appointment-reminder cron (Bearer `CRON_SECRET`)
- `src/app/api/cron/treatwell-sync/route.ts` — Treatwell inbound iCal sync, protected by `CRON_SECRET`. `vercel.json` currently uses the Hobby-compatible daily `0 6 * * *` schedule; Admin can trigger extra test syncs manually. After upgrading to Pro, change the expression to `*/5 * * * *` and redeploy. The schedule is Vercel project configuration and cannot be controlled by an app environment variable.
- `src/app/api/session/route.ts` — private/no-store cosmetic header session state, split from shared marketing HTML so public pages can use Vercel ISR. Now only the fallback when the `session_hint` cookie is absent (pre-hint sessions); back-fills the hint so it runs at most once per browser. Protected pages still verify the session server-side.
- `src/app/api/ical/[stylistId]/route.ts` — outbound busy feed (`?token=` secret) that Treatwell Connect subscribes to per employee; thin adapter over `stylist-ical-feed.ts`.

## Lib
- `pin.ts` — `isValidPin`, `hashPin`, `verifyPin` (bcryptjs); unit-tested
- `session.ts` — existing JWT session helpers + `createKioskSession`/`getKioskSession`/`deleteKioskSession` for PIN-authenticated kiosk sessions
- `phone.ts` — `toTelHref(phone)`: pure, prisma-free — normalizes an admin-editable `SiteSettings.phone` value (strips spaces, leading `0` → `+44`) into a `tel:` URI; used by the Footer, contact page and `NewsletterWelcome` email so the displayed/dialable number follows Settings instead of being hardcoded; unit-tested
- `register-gate.ts` — `decideRegistration(existing)` → `CREATE` / `CLAIM_GUEST` / `REJECT`: pure rule deciding what `/auth/register` may do with an email. Treats a row as a claimable guest placeholder ONLY when it has no password AND no linked OAuth provider — a password-less Google account is NOT claimable (closes the account-takeover hole); unit-tested
- `sliding-window.ts` — `SlidingWindow`: pure, dependency-free in-process sliding-window counter with bounded key eviction; the fallback backing `rate-limit.ts`; unit-tested
- `rate-limit.ts` — server-only `createRateLimiter(policy)` + shared policies (`loginLimiter`, `registerLimiter`, `bookingLimiter`, `discountLimiter`, `newsletterLimiter`, `clockLimiter`, `passwordResetLimiter`). Uses Upstash Redis when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set and otherwise degrades to `SlidingWindow` — an unset env can no longer silently disable limiting, and a Redis outage falls back rather than failing open
- `password-reset.ts` — `generateResetToken`, `hashResetToken` (SHA-256; only the hash is stored), `evaluateResetToken`, `RESET_TOKEN_TTL_MS` (1h), shared enumeration-safe copy; unit-tested
- `session-hint.ts` — `SESSION_HINT_COOKIE` + `parseSessionHint(cookieString)`: pure parser for the non-httpOnly, role-only `session_hint` cookie set/cleared alongside the real session (createSession/deleteSession, middleware sliding refresh, `/api/session` back-fill) so the header shows account state instantly without a network request; cosmetic only — protected routes still verify the JWT; unit-tested

## Actions
- `employees.ts` — admin CRUD for Employee records (create, update, delete); validates PIN via `pin.ts`
- `kiosk.ts` — `clockToggle` (employee clock-in/out with PIN + rate-limit), `enableKioskMode`, `disableKioskMode`
- `timesheets.ts` — admin timesheet management: create/edit/delete TimesheetEntry rows
- `payroll.ts` — `runPayrollAction(year, month)`, `updateAdjustmentAction`, `finalizePayrollAction`; delegates to `payroll-service.ts`
- `password-reset.ts` — `requestPasswordReset` (enumeration-safe: identical response whether or not the email exists) and `resetPassword` (single-use token redeemed in a transaction, bumps `sessionVersion` to sign out every existing session)
- `admin-integrations.ts` — admin-only manual iCal sync, failed Treatwell outbound queue retry, and per-stylist busy-feed token generate/rotate.

## Pages
- `src/app/admin/employees/page.tsx` — admin employee list with create/edit/delete via `EmployeeForm`
- `src/app/admin/timesheets/page.tsx` — admin timesheet browser and manual entry editor
- `src/app/admin/payroll/page.tsx` — admin payroll runner: period picker, computed gross lines, CSV export, finalize
- `src/app/admin/integrations/page.tsx` — Treatwell/Resend/CDN readiness dashboard. Shows only booleans, counts and timestamps; never secret values.
- `src/app/auth/forgot-password/page.tsx` — request a reset link; always shows the same confirmation so accounts cannot be enumerated
- `src/app/auth/reset-password/page.tsx` — redeem `?token=` and set a new password; handles missing/invalid/expired links
- `src/app/kiosk/page.tsx` — PIN kiosk screen: employee roster with clock-in/out via `KioskClock`

## Components (new — payroll / kiosk build)
- `src/components/layout/SocialLinks.tsx` — renders IG/Treatwell/Google icon links from `social-links-data.ts`
- `src/components/layout/social-links-data.ts` — `getSocialLinks(settings)` → filtered, ordered `SocialLink[]`; unit-tested
- `src/components/home/VisitFollowBlock.tsx` — "Visit & follow us" homepage section wrapping `SocialLinks`
- `src/components/admin/EmployeeForm.tsx` — create/edit employee form (pay type, rates, overtime toggle, PIN, stylist link)
- `src/components/admin/KioskModeButton.tsx` — toggle button for enabling/disabling kiosk mode from admin
- `src/components/admin/PayrollAdjustmentForm.tsx` — inline form to edit adjustment amount and note on a payroll line
- `src/components/kiosk/KioskClock.tsx` — kiosk roster grid: shows clock-in/out status, PIN entry, triggers `clockToggle`

## Database Models
- User
- OAuthAccount — links a user to a verified external provider identity (currently Google)
- Stylist — includes private `treatwellIcalUrl` (inbound) and `treatwellExternalId` (future API mapping)
- Service — includes `requiresPatchTest` (colour services) and `isPatchTest` (the £10 Consultation & Patch Test service) booleans; also `requiresConsultation` (services that must route to a consultation before they can be booked directly) and `isConsultation` (the separate free £0 Consultation service). Gated colour services route to the £10 Consultation & Patch Test; other gated services route to the free Consultation. `treatwellExternalId` maps it to the future API.
- Appointment (status: PENDING / CONFIRMED / COMPLETED / CANCELLED) — also stores Treatwell provider booking id, durable sync status/error and last sync timestamp.
- Availability
- PasswordResetToken — single-use, 1-hour password reset grants. Stores only the SHA-256 `tokenHash` (never the raw token), plus `expiresAt`/`usedAt`; cascade-deleted with the user
- ExternalBusyBlock — busy times imported from Treatwell (per-stylist iCal); `Stylist.treatwellIcalUrl` holds the feed URL

## Email templates
- `src/components/emails/BookingRequestReceived.tsx` — customer acknowledgement sent the moment a PENDING request is created (explicitly NOT a confirmation); monochrome brand
- `src/components/emails/NewBookingAlert.tsx` — internal salon alert that a request needs approving; includes customer contact details (staff-only recipient)
- `src/components/emails/PasswordReset.tsx` — reset link email; monochrome brand
- Note: the older templates (BookingConfirmation, BookingCancellation, BookingReschedule, AppointmentReminder, ReviewRequest, NewsletterWelcome) still use the legacy blue/gold palette and have not been migrated to the monochrome brand.

## Components (auth)
- `src/components/auth/PasswordVisibilityToggle.tsx` — eye / eye-off button overlaid on password inputs (used by signin + register pages)
- `src/components/auth/GoogleAuthButton.tsx` — shared Google sign-in/register button that preserves safe post-auth redirects
- `src/app/api/auth/google/route.ts` — starts Google OAuth using signed state, nonce, and PKCE
- `src/app/api/auth/google/callback/route.ts` — verifies Google identity, links by verified email, creates new users, and issues the existing JWT session

## CDN / Public shell
- `src/components/layout/Header.tsx` — static server wrapper for public offer state.
- `src/components/layout/HeaderClient.tsx` — shared-cache-safe marketing header; account links read the `session_hint` cookie on hydration and on every navigation (survives soft navs in the root layout), with `/api/session` as one-time fallback for pre-hint sessions; sign-out flips the UI optimistically via `useTransition` before the server action clears cookies and redirects.
- Public pages export route revalidation intervals and are delivered through Vercel ISR. Homepage output is static with a one-hour revalidation interval; Admin and API routes remain dynamic.

## Components (responsive shell)
- `src/components/admin/AdminSidebar.tsx` — admin nav shell: hamburger top bar + slide-in drawer < lg, sticky sidebar ≥ lg; closes on backdrop/✕/Escape/route change
- `src/components/layout/FooterSwitcher.tsx` — client-side gate (usePathname) that hides the marketing footer+book bar on /auth pages (which get no footer at all), so soft navigation swaps chrome correctly
