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

## API Routes
- `src/app/api/cron/reminders/route.ts` — daily appointment-reminder cron (Bearer `CRON_SECRET`)
- `src/app/api/cron/treatwell-sync/route.ts` — Treatwell inbound iCal sync; called by AWS EventBridge→Lambda (see `infra/aws/treatwell-sync/`), Bearer `CRON_SECRET`

## Lib
- `pin.ts` — `isValidPin`, `hashPin`, `verifyPin` (bcryptjs); unit-tested
- `session.ts` — existing JWT session helpers + `createKioskSession`/`getKioskSession`/`deleteKioskSession` for PIN-authenticated kiosk sessions
- `phone.ts` — `toTelHref(phone)`: pure, prisma-free — normalizes an admin-editable `SiteSettings.phone` value (strips spaces, leading `0` → `+44`) into a `tel:` URI; used by the Footer and contact page so the displayed/dialable number follows Settings instead of being hardcoded; unit-tested

## Actions
- `employees.ts` — admin CRUD for Employee records (create, update, delete); validates PIN via `pin.ts`
- `kiosk.ts` — `clockToggle` (employee clock-in/out with PIN + rate-limit), `enableKioskMode`, `disableKioskMode`
- `timesheets.ts` — admin timesheet management: create/edit/delete TimesheetEntry rows
- `payroll.ts` — `runPayrollAction(year, month)`, `updateAdjustmentAction`, `finalizePayrollAction`; delegates to `payroll-service.ts`

## Pages
- `src/app/admin/employees/page.tsx` — admin employee list with create/edit/delete via `EmployeeForm`
- `src/app/admin/timesheets/page.tsx` — admin timesheet browser and manual entry editor
- `src/app/admin/payroll/page.tsx` — admin payroll runner: period picker, computed gross lines, CSV export, finalize
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
- Stylist
- Service — includes `requiresPatchTest` (colour services) and `isPatchTest` (the £10 Consultation & Patch Test service) booleans; also `requiresConsultation` (services that must route to a consultation before they can be booked directly) and `isConsultation` (the separate free £0 Consultation service). Gated colour services route to the £10 Consultation & Patch Test; other gated services route to the free Consultation
- Appointment (status: PENDING / CONFIRMED / COMPLETED / CANCELLED)
- Availability
- ExternalBusyBlock — busy times imported from Treatwell (per-stylist iCal); `Stylist.treatwellIcalUrl` holds the feed URL
