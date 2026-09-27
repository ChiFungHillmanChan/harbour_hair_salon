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
- `src/components/admin/AppointmentDialog.tsx` — create/edit bookings; an explicit, confirmed "Cancel booking" action releases pending/confirmed bookings through the existing authenticated status action, audit trail, notification outbox and feed invalidation.
- `src/components/admin/ServiceForm.tsx` + `src/app/actions/admin-services.ts` — manage `requiresPatchTest`/`isPatchTest` per service.

### Opening Hours (Admin → Opening Hours)
The hours the booking engine sells from. Before this, `Availability` was written only by `prisma/seed.ts` — production had no way to change it.
- `src/app/services/opening-hours.ts` — pure, dependency-free: `validateWeek(days)` (structure, time format, close-after-open, normalises closed days), `countSlots(start, end, duration)` and `DAY_NAMES`. Unit-tested in `opening-hours.test.ts`; `countSlots` is pinned against the booking engine's own `buildSlotsForWindow` so the two cannot drift.
- `src/app/actions/admin-availability.ts` — `updateStylistAvailability` replaces one stylist's whole week in a `$transaction` of upserts. Admin-gated and validated before any write (locked by `opening-hours-schema.test.ts`).
- `src/app/admin/opening-hours/page.tsx` — pads stylists with fewer than seven rows to a full week; explicit `select` so the secret `treatwellIcalUrl`/`icalToken` never reach the client.
- `src/components/admin/OpeningHoursForm.tsx` — stylist tabs, per-day open/closed + time inputs, live slot-count preview, copy-hours-to-all-open-days.

### Admin schedule board — colours & drag (Admin → Schedule, Day view)
Per-stylist colour fill + per-service stripe, and drag-to-move/resize on a stylist-column
day grid. Admin-only: the public site stays monochrome and no public query selects
`calendarColor`. Resizing writes `Appointment.durationAtBooking`, which every consumer
already reads as the effective duration (clash checks, outbound iCal feed, the customer's
appointments page, email snapshots).
- `src/app/lib/calendar-colors.ts` — the fixed palette: 10 swatches as **literal** Tailwind class strings (a name built at runtime is invisible to the v4 scanner and ships unstyled). `resolveCalendarColor(key)` falls back to zinc for null/retired keys. Unit-tested in `calendar-colors.test.ts`, which also guards against interpolated class names.
- `src/app/lib/calendar-geometry.ts` — pure, DOM-free drag maths: `minutesToOffset`/`offsetToMinutes`, `snapToStep` (half-steps round up in both directions), `applyMove`, `applyResizeTop`, `applyResizeBottom`; `SNAP_MINUTES`/`MIN_DURATION_MINUTES` (15). Unit-tested in `calendar-geometry.test.ts`.
- `src/app/services/admin-move-clashes.ts` — `describeAdminMoveClashes(db, target)` **returns** clashes (`OVERLAP` / `OUTSIDE_HOURS` / `EXTERNAL_BUSY` / `PATCH_TEST`) instead of throwing, so the UI can name what it collides with. Shares `fitsWithinAvailability`, `loadExternalBusy` and `overlaps` with `assertAppointmentSlotAvailable` so admin warnings and customer rules cannot drift. Unit-tested in `admin-move-clashes.test.ts`.
- `src/app/actions/admin-schedule.ts` — `moveAppointmentByAdmin(input)`: admin-gated, Zod-validated, salon-local `dateStr`+`time` strings, runs in `runSerializableWithRetry` with an `updatedAt` optimistic guard. Clashes warn (`overrideClashes`) rather than refuse; the check runs inside the transaction on **both** paths. Deliberately skips the 24-hour customer policy and `assertOnlineBookingReady`. Emails only when the start time or stylist changes on a CONFIRMED booking. Locked by `admin-schedule.test.ts`.
- `src/components/admin/ScheduleDayGrid.tsx` — the stylist-column time grid: pointer-event drag/resize, 15-minute snapping, live clash highlighting, hatched non-draggable external busy blocks, inline clash-confirm panel. `sm:`+ only; phones keep the list `DayView`.
- `src/app/services/public-service-select.ts` — `publicServiceSelect` + `PublicService` / `ClientPublicService` types. Public pages render services through client components, so every selected column reaches the browser in the RSC payload; a bare `service.findMany()` published `treatwellExternalId`, `calendarColor` and the timestamps. Used by `/`, `/services`, `/services/[slug]` and `/book`. Mirrors `publicStylistSelect` in `app/stylists/slug.ts`. **Add a column only after deciding the public may read it.**
- `src/components/admin/CalendarColorPicker.tsx` — swatch radio group; posts a palette key (empty = no colour). Used by `StylistForm` and `ServiceForm`; validated server-side in `admin-stylists.ts` / `admin-services.ts`.
- `src/app/services/admin-calendar-range.ts` — `resolveAdminCalendarRange`: validates date/view query parameters and computes the visible London day/month/year interval, including DST and adjacent month cells.
- `src/app/admin/page.tsx`, `src/components/admin/ScheduleCalendar.tsx` — URL-driven navigation reloads the requested period; pending requests are queried and shown independently across all dates. Regression coverage in `src/app/admin/calendar-navigation.test.ts` includes distant requests and confirmation actions.
- `prisma/{dev,prod,vercel}/migrations/20260916153000_calendar_colours/migration.sql` — nullable service/stylist palette columns, preserving existing rows and default colours.

### Marketplace channels
Public booking buttons come from the URLs in Admin → Site Settings. Calendar readiness is configured separately per stylist/provider in Admin → Integrations.
- `src/app/services/marketplace-channels.ts` — pure `activeMarketplaces(settings)` → `{name, url}[]` for any non-empty `freshaUrl` / `treatwellUrl` / `booksyUrl`. Unit-tested.
- `/book` renders one CTA per configured public marketplace while booking is closed. Clearing a public URL removes its button; it does not change a calendar connection's `receivesBookings` flag or remove readiness requirements.
- `evaluateSyncCoverage` checks Fresha and Treatwell ICS connections for every stylist/provider marked `receivesBookings`: valid weekly hours, a successful inbound attempt within 90 minutes with no latest error, and confirmed subscription to the matching website Busy feed. ICS polling reduces conflicts but cannot guarantee an atomic cross-platform reservation.
- `booking-maintenance.ts` deliberately contains **no** marketplace name or URL; `booking-maintenance-copy.test.ts` locks that, because the old hardcoded `TREATWELL_BOOKING_URL` fallback made the Treatwell button impossible to switch off from the admin panel.

## Services
- `deposit-policy.ts` — pure GBP/pence deposit calculation from explicit server-owned policy and net price; no deposit terms are enabled automatically.
- `square-gateway.ts` — disabled-by-default, server-only Square REST adapter for authorization, capture, cancellation, retrieval and refunds. No booking flow is connected yet; see `docs/square-payments-setup.md` and `pnpm test:square`.
- `booking-service.ts` — slot availability, booking creation, patch-test eligibility query
- `opening-hours.ts` — pure opening-hours validation and slot counting (see Opening Hours above)
- `marketplace-channels.ts` — pure `activeMarketplaces(settings)` (see Marketplace channels above)
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
- `src/app/api/cron/treatwell-sync/route.ts` — Treatwell inbound iCal sync, protected by `CRON_SECRET`. **No cron runs it**: the `*/5` schedule was removed in PR #38 because it held the Neon compute awake 24/7 (Neon bills idle compute, and its free tier suspends after 5 minutes). The route is additionally gated behind `TREATWELL_SYNC_ENABLED`, checked **above** the first DB call. Admin → Integrations can still trigger a sync manually (it calls the service directly). See "Neon compute budget" in CLAUDE.md before re-adding any schedule.
- `src/app/api/session/route.ts` — private/no-store cosmetic header session state, split from shared marketing HTML so public pages can use Vercel ISR. Now only the fallback when the `session_hint` cookie is absent (pre-hint sessions); back-fills the hint so it runs at most once per browser. Protected pages still verify the session server-side.
- `src/app/api/ical/[stylistId]/route.ts` — outbound busy feed (`?token=` secret) that Treatwell Connect subscribes to per employee; thin adapter over `stylist-ical-feed.ts`.

## Lib
- `square-config.ts` — runtime-only Square configuration with explicit enablement, environment validation and secret-safe errors.
- `square-webhook.ts` — constant-time HMAC verification using the exact registered URL and raw body; foundation helper only, no webhook route yet.
- `pin.ts` — `isValidPin`, `hashPin`, `verifyPin` (bcryptjs); unit-tested
- `session.ts` — existing JWT session helpers + `createKioskSession`/`getKioskSession`/`deleteKioskSession` for PIN-authenticated kiosk sessions
- `phone.ts` — `toTelHref(phone)`: pure, prisma-free — normalizes an admin-editable `SiteSettings.phone` value (strips spaces, leading `0` → `+44`) into a `tel:` URI; used by the Footer and contact page so the displayed/dialable number follows Settings instead of being hardcoded; unit-tested
- `register-gate.ts` — `decideRegistration(existing)` → `CREATE` / `CLAIM_GUEST` / `REJECT`: pure rule deciding what `/auth/register` may do with an email. Treats a row as a claimable guest placeholder ONLY when it has no password AND no linked OAuth provider — a password-less Google account is NOT claimable (closes the account-takeover hole); unit-tested
- `sliding-window.ts` — `SlidingWindow`: pure, dependency-free in-process sliding-window counter with bounded key eviction; the fallback backing `rate-limit.ts`; unit-tested
- `redis-credentials.ts` — pure `resolveRedisCredentials(env)`: accepts BOTH the hand-set `UPSTASH_REDIS_REST_URL`/`_TOKEN` pair and the Vercel Marketplace `KV_REST_API_URL`/`KV_REST_API_TOKEN` pair that `vercel integration add upstash/upstash-kv` injects (UPSTASH_* wins). Requires both halves; rejects the read-only token since rate limiting writes; unit-tested
- `rate-limit.ts` — server-only `createRateLimiter(policy)` + shared policies (`loginLimiter`, `registerLimiter`, `bookingLimiter`, `discountLimiter`, `clockLimiter`, `passwordResetLimiter`). Uses Upstash Redis when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set and otherwise degrades to `SlidingWindow` — an unset env can no longer silently disable limiting, and a Redis outage falls back rather than failing open
- `password-reset.ts` — `generateResetToken`, `hashResetToken` (SHA-256; only the hash is stored), `evaluateResetToken`, `RESET_TOKEN_TTL_MS` (1h), shared enumeration-safe copy; unit-tested
- `session-hint.ts` — `SESSION_HINT_COOKIE` + `parseSessionHint(cookieString)`: pure parser for the non-httpOnly, role-only `session_hint` cookie set/cleared alongside the real session (createSession/deleteSession, middleware sliding refresh, `/api/session` back-fill) so the header shows account state instantly without a network request; cosmetic only — protected routes still verify the JWT; unit-tested

## Actions
- `employees.ts` — admin CRUD for Employee records (create, update, delete); validates PIN via `pin.ts`
- `kiosk.ts` — `clockToggle` (employee clock-in/out with PIN + rate-limit), `enableKioskMode` (current-admin check, kiosk cookie, clear user session/hint, redirect to `/kiosk`), `disableKioskMode`; handoff regression tests in `kiosk-session.test.ts`.
- `timesheets.ts` — admin timesheet management: create/edit/delete TimesheetEntry rows
- `payroll.ts` — `runPayrollAction(year, month)`, `updateAdjustmentAction`, `finalizePayrollAction`; delegates to `payroll-service.ts`
- `password-reset.ts` — `requestPasswordReset` (enumeration-safe: identical response whether or not the email exists) and `resetPassword` (single-use token redeemed in a transaction, bumps `sessionVersion` to sign out every existing session)
- `admin-integrations.ts` — admin-only provider connection setup, bounded manual calendar sync, and per-stylist busy-feed token rotation with subscription invalidation.

## Pages
- `src/app/admin/employees/page.tsx` — admin employee list with create/edit/delete via `EmployeeForm`
- `src/app/admin/timesheets/page.tsx` — admin timesheet browser and manual entry editor
- `src/app/admin/payroll/page.tsx` — admin payroll runner: period picker, computed gross lines, CSV export, finalize
- `src/app/admin/integrations/page.tsx` — per-stylist Fresha/Treatwell setup and synchronization evidence. Inbound URLs stay masked; secret outbound subscription URLs are available only to administrators.
- `src/app/auth/forgot-password/page.tsx` — request a reset link; always shows the same confirmation so accounts cannot be enumerated
- `src/app/auth/reset-password/page.tsx` — redeem `?token=` and set a new password; handles missing/invalid/expired links
- `src/app/kiosk/page.tsx` — PIN kiosk screen: employee roster with clock-in/out via `KioskClock`

## Components (new — payroll / kiosk build)
- `src/components/layout/SocialLinks.tsx` — renders IG/Treatwell/Google icon links from `social-links-data.ts`
- `src/components/layout/social-links-data.ts` — `getSocialLinks(settings)` → filtered, ordered `SocialLink[]`; unit-tested
- `src/components/home/VisitFollowBlock.tsx` — "Visit & follow us" homepage section wrapping `SocialLinks`
- `src/components/admin/EmployeeForm.tsx` — create/edit employee form (pay type, rates, overtime toggle, PIN, stylist link)
- `src/components/admin/KioskModeButton.tsx` — sign-out-and-open-kiosk form plus disable control; successful enable follows the server redirect.
- `src/components/admin/PayrollAdjustmentForm.tsx` — inline form to edit adjustment amount and note on a payroll line
- `src/components/kiosk/KioskClock.tsx` — kiosk roster grid: shows clock-in/out status, PIN entry, triggers `clockToggle`

## Database Models
- User
- OAuthAccount — links a user to a verified external provider identity (currently Google)
- Stylist — `icalToken` protects the local busy feed; `treatwellIcalUrl` is retained only as a legacy migration source; `treatwellExternalId` is a future API mapping.
- Service — includes `requiresPatchTest` (colour services) and `isPatchTest` (the £10 Consultation & Patch Test service) booleans; also `requiresConsultation` (services that must route to a consultation before they can be booked directly) and `isConsultation` (the separate free £0 Consultation service). Gated colour services route to the £10 Consultation & Patch Test; other gated services route to the free Consultation. `treatwellExternalId` maps it to the future API.
- Appointment (status: PENDING / CONFIRMED / COMPLETED / CANCELLED) — also stores Treatwell provider booking id, durable sync status/error and last sync timestamp.
- Availability — per-stylist weekly opening hours (`dayOfWeek` 0-6 Sun-Sat, `startTime`/`endTime` `HH:mm`, `isOff`). `@@unique([stylistId, dayOfWeek])` so the editor can upsert one row per stylist-day; `getAvailableSlots` reads it with `findFirst`, so duplicates would make the hours the site sells depend on row order. Edited in Admin → Opening Hours
- PasswordResetToken — single-use, 1-hour password reset grants. Stores only the SHA-256 `tokenHash` (never the raw token), plus `expiresAt`/`usedAt`; cascade-deleted with the user
- ExternalBusyBlock — busy periods imported per source/stylist/UID from CalendarConnection; contains no customer title.

## Email templates
- `src/components/emails/BookingRequestReceived.tsx` — customer acknowledgement sent the moment a PENDING request is created (explicitly NOT a confirmation); monochrome brand
- `src/components/emails/NewBookingAlert.tsx` — internal salon alert that a request needs approving; includes customer contact details (staff-only recipient)
- `src/components/emails/PasswordReset.tsx` — reset link email; monochrome brand
- Note: the older templates (BookingConfirmation, BookingCancellation, BookingReschedule, AppointmentReminder, ReviewRequest) still use the legacy blue/gold palette and have not been migrated to the monochrome brand.

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
- `src/components/layout/HeaderClient.tsx`, `MobileNav.tsx`, `MobileMenuOverlay.tsx` — public header uses compact navigation below `xl` (1280px), with a direct booking button from `sm`; the native modal menu scrolls on short screens, supports Escape and keyboard focus isolation, and closes on navigation or resizing to desktop.
- `src/components/admin/AdminSidebar.tsx` — admin nav shell: hamburger top bar + slide-in drawer < lg, sticky sidebar ≥ lg; closes on backdrop/✕/Escape/route change
- `src/components/layout/FooterSwitcher.tsx` — client-side gate (usePathname) that hides the marketing footer+book bar on /auth pages (which get no footer at all), so soft navigation swaps chrome correctly


## Production readiness and calendar integration (September 2026)
- `src/app/services/calendar-feed-url.ts` — public HTTPS validation, DNS pinning, redirect rejection, bounded response size and deadline.
- `src/app/services/calendar-ical.ts` — discrete UTC/IANA/all-day events; rejects unsupported recurring appointments and malformed feeds atomically.
- `src/app/services/calendar-sync-service.ts` — per-connection leases and transactional reconciliation; preserves busy periods on failure.
- `src/app/services/integration-readiness.ts` — `checkCalendarBookingReadiness` uses caller transaction, current staff hours, successful sync freshness and confirmed outbound subscriptions.
- `src/app/services/booking-horizon.ts` — shared reservation horizon constrained by the imported calendar window and freshness margin.
- `src/app/services/booking-service.ts` — `assertAppointmentSlotAvailable` rechecks frozen duration, current hours, calendar horizon and internal/external conflicts.
- `src/app/lib/booking-maintenance.ts` — uncached master switch plus calendar/operational runtime prerequisites; cancellation stays available.
- `src/app/services/notification-outbox-service.ts` — transactional notification snapshots, stable event keys, leases, bounded retries and obsolete-message suppression. Customer messages to walk-in placeholder addresses are not queued; existing placeholder deliveries are skipped before rendering/sending, while salon alerts remain supported. Central dispatch returns before DB/render/send unless `NOTIFICATIONS_ENABLED === 'true'`; queued snapshots survive disabled periods. Password reset transport is separate.
- `src/app/services/notification-cron-service.ts` — reminder/review discovery and queue delivery with persisted job status.
- `src/app/services/email-service.ts` — renders frozen email requests and sends through the Resend API with abortable requests; password resets stay out of the queue.
- `src/app/services/operations-readiness.ts` — explicit read-only DB/Resend/Redis diagnostics, cached evidence and configuration fingerprints; runtime checks do not expire daily.
- `src/app/actions/admin-operations.ts`, `src/app/admin/operations/page.tsx` — diagnostic controls and safe cron/notification metadata; no recipient payloads displayed.
- `src/app/api/cron/calendar-sync/route.ts`, `src/app/api/cron/notifications/route.ts` — authenticated 30-minute schedules, disabled before database access unless explicitly enabled.
- `CalendarConnection` — provider sales activity, private inbound URL, inbound/outbound evidence, success/failure timestamps and lease.
- `NotificationDelivery` — durable appointment event; its customer snapshot is removed after delivery/obsolescence and expired after 30 days by the worker.
- `BackgroundJobState` — safe diagnostics and scheduler progress/lease records.
- `src/test/load-server-module.ts` — test-only source loader replacing explicit I/O dependencies.
- `scripts/verify-production-readiness.ts` — PostgreSQL concurrency/rollback/calendar integration checks, restricted to a disposable localhost database named `salon_test`.
- `scripts/verify-booking-lifecycle.ts` — disposable PostgreSQL create/confirm/reschedule/cancel, ownership and 24-hour guards, competing bookings, notification snapshots, private ICS output, Fresha import reconciliation and failure preservation; provider transport and framework boundaries are synthetic.
- `src/components/admin/CalendarSetupNotice.tsx` — compact schedule setup status with grouped, expandable blockers; distinguishes incomplete calendar evidence from detected appointment conflicts.
- `src/app/lib/calendar-busy-display.ts` — London-day clipping and provider/time/import-status labels for external busy periods; day/week grids retain overnight and all-day blocks, and week lanes include overlapping imported periods.
- `src/components/admin/ScheduleCalendar.tsx` — `BusyAgenda` includes provider busy periods in the mobile day/week lists, with stylist, London times and the last import timestamp.
- `readme/salon-visit-handover-cantonese.md` — owner access and business-data collection checklist.
- `readme/production-readiness-rollout-cantonese.md` — verified implementation, remaining external requirements and deployment acceptance sequence.

### Backend security and database readiness (2026-09-16)
- `src/app/lib/session-policy.ts` — fixed ADMIN8h/USER30d JWT lifetime and registered KIOSK30d policy; `session.ts` request-local `verifySession` and `requireAdmin` check current role/version/MFA, plus registered device expiry/revocation.
- `src/app/lib/admin-mfa.ts`, `mfa-crypto.ts`, `src/app/actions/admin-mfa.ts` — signed first-factor challenge, encrypted TOTP seeds, one-use recovery hashes, conditional redemption, durable per-account attempt budget; `/auth/mfa` and `/auth/mfa/setup` are the minimal auth flow.
- `src/app/lib/audit.ts`, `audited-write.ts` — sanitized append-only application API; sensitive mutations and their audit record share the transaction. This does not make the database itself tamper-proof.
- `src/app/lib/pagination.ts`, `src/components/admin/Pagination.tsx` — bounded page/search parsing, composite date cursor and reusable server-rendered navigation.
- `src/app/services/admin-calendar-data.ts` — authorized calendar DAL: one annual aggregate, selected period DTOs, day roster/busy data and cursor-paged all-date pending queue.
- `src/app/services/housekeeping-service.ts`, `/api/cron/housekeeping` — independent bounded retention and expired-notification-lease recovery; opt-in `HOUSEKEEPING_ENABLED`, daily03:15UTC.
- `src/components/admin/KioskSessions.tsx` — per-device/all-device revocation controls from registered safe session metadata.
- `blog-service.ts` — bounded public/admin summary pages, `getPublishedPostSlugs`, `getRelatedPublishedPosts`; full article getters retain request deduplication.
- `category-content-service.ts` — thin category listing, cached detail and batched `getRelatedCategories`; `app/stylists/slug.ts` — indexed/cached detail, `getStylistSlugs`, `getRelatedStylists` with safe projections.
- `prisma/seed-safety.ts` — explicit opt-in and canonical local disposable target validation before destructive seeding.
- `prisma/rotate-mfa-key.ts`, `prisma/reset-admin-mfa.ts`, `prisma/create-admin.ts` — explicitly confirmed operator maintenance; `mfa-maintenance.ts` includes `bootstrapAdminOffline`, factor reset and key rotation; no web endpoint bypasses MFA.
- `prisma/{dev,prod,vercel}/migrations/20260916230000_backend_security_readiness` — MFA/kiosk/audit/index additions and legacy provider catch-up; SQL Server requires staging validation.
- `scripts/verify-production-readiness.ts` — disposable PostgreSQL booking caps/concurrency, payroll transaction/snapshot rollback, calendar aggregation/reconciliation and notification invariants.
- `scripts/verify-backend-http.ts` — starts a production server against disposable synthetic data; checks admin authorization, data minimization, pagination/canonical URLs and actual MFA form submissions.
- `readme/backend-security-operations.md`, `readme/backend-remediation-2026-09-16-cantonese.md` — rollout, retention, recovery, verification and remaining SOC2 operational evidence.

### Opening-hours calendar sync (2026-09-20)
- `src/app/services/calendar-sync-window.ts` — shared London-time window check using active staff hours plus 15 minutes before/after; handles adjacent-day buffers. Also schedules visible admin refreshes after each half-hourly import, allowing its 90-second runtime.
- `src/app/services/calendar-sync-schedule.ts` — caches active-staff opening hours without timer expiry so closed-hours cron checks do not normally wake Neon. Admin hours edits and stylist deletion invalidate `calendar-sync-hours`. Direct database changes to hours/active staff must invalidate this tag too; a redeploy alone may retain the Data Cache.
- `/api/cron/calendar-sync` — authenticated, runtime-flagged 30-minute ticks on Vercel Pro (15 until 2026-09-22; halved for the Neon free-plan budget). Closed ticks skip import and job-state writes. Cold/evicted hours cache needs one database read. Manual integration tests remain available outside hours.
- `ScheduleCalendar` — half-hourly refreshes follow imports while visible (browser clock on both sides of the comparison); year totals refresh on demand. Displays the server-load timestamp and provides Refresh now. Mutation refreshes stay immediate.

### Neon free-plan budget and deploy source (2026-09-22)
- Neon Free = **100 CU-hours/project/month**; overrun suspends the database until next month. Compute is fixed at 0.25 CU with a 5-minute idle tail, so each separate wake costs ≥ ~0.02 CU-h. Measured 2026-09-18..21: ~3 CU-h/day (~90/month) — iCal feed cache expiry ~1.7, 15-minute calendar sync ~1.4, visitors/admin ~0.7.
- Fixes: iCal events cache safety net 30 min → 24 h (token cache: tag-invalidated only); calendar-sync `*/15` → `*/30`; notifications `*/30` → `*/30 8-19` (UTC). `src/app/services/neon-compute-budget.test.ts` pins all three.
- `refreshStaleCalendarFeeds()` (calendar-sync-service) — admin Confirm refreshes feeds older than one poll interval before the freshness check; Settings saves only run launch checks when turning booking ON.
- `scripts/production-build-guard.mjs` — first step of `vercel-build`; refuses production builds outside the GitHub Actions deploy job on `main`. `vercel.json` `git.deploymentEnabled: false` stops Vercel's own untested git builds.
- Final review follow-ups (2026-09-22): the guard compares real paths (spaces/accents/`#` in the checkout path used to skip it silently) and refuses a Vercel build with no `VERCEL_ENV` (unknown target); it logs "`<env>` build allowed" so deploy logs prove it ran. Token cache: 7-day safety net, cleared on token rotation **and** stylist deletion — rotate feed secrets only via Admin → Integrations, never by SQL. Admin Confirm/Decline show "Checking calendars…" and cannot be double-submitted; the board refreshes a Back/Forward-restored payload after the next import (`payloadArrival`).
