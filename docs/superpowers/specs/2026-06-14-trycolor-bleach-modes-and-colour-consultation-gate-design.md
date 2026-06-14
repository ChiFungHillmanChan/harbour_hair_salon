# Design: Try-Color Bleach Modes + Colour Consultation/Patch-Test Gate

- **Date:** 2026-06-14
- **Branch:** `feat/trycolor-bleach-modes-and-colour-gate`
- **Status:** Awaiting user review

## 1. Overview

Two client-requested changes to the Harbour Hair Salon site:

1. **Try Color** — restructure the virtual hair-colour try-on around an explicit
   **漂前 (colour over natural hair, no bleach)** vs **漂後上色 (colour on pre-bleached
   hair)** choice, and tune the result to be ~80% realistic based on the customer's
   **original** hair colour and the dye's real-world behaviour. Live camera is disabled;
   inputs become **photo upload** and **video upload** (recolour + playback).
2. **Booking gate** — when a logged-in customer books any **Colouring** service, require a
   **completed Consultation & Patch Test** appointment first (≥48h before the colour
   appointment, valid for 6 months).

Both build on existing code: the try-on engine already models dye physics (deposit/tone/lift
modes, base-level detection, an underlying-pigment chart); the booking system already has a
`Service.category` of `Colouring` and a £10 `Patch Test` service. This work makes the dye
model honest and mode-driven, and turns the patch test from an optional service into an
enforced prerequisite.

## 2. Goals / Non-Goals

**Goals**
- Explicit, user-selected 漂前 / 漂後 mode that materially changes the predicted result.
- Result accuracy grounded in real hair-colour science (see §4), targeting ~80% realism.
- Disable live camera; support photo upload + video-clip upload (recolour every frame, play back).
- Enforce Consultation & Patch Test before all Colouring bookings, server-side and in the UI.
- Add the missing admin ability to mark an appointment `COMPLETED`.

**Non-Goals**
- No paid AI image-generation/render API (explicit client decision). Engine stays 100% in-browser.
- No gating of Perms/Treatments (Colouring only — one-flag extension later if wanted).
- No full re-encoded video export/download in this phase (in-app playback + still-frame download
  only; WebCodecs/MediaRecorder export is a possible later add-on).
- No change to pricing, stylists, discounts, or auth.

## 3. Background: what exists today

**Try Color** (`src/app/try-color/`, `src/components/try-color/`)
- `landing` → `camera` (live, MediaPipe VIDEO mode, 8–12 FPS, auto-falls-back when slow) or
  `upload` (photo, MediaPipe IMAGE mode).
- `colorMath.ts` already converts sRGB↔linear, detects base level from luminance, and recolours
  per-pixel via three modes: `deposit` (multiply — dark deposits), `tone` (semi-transparent
  blend), `lift` (luminance-replace, bleach-like). It clamps achievable level with
  `maxLiftWithoutBleach` and emits an "expected result" notice.
- `constants.ts` holds `HAIR_LEVEL_REFERENCE_LUMINANCE` (1→0.07 … 10→0.88),
  `UNDERLYING_PIGMENT_HEX` (level 1 dark-red `#4f1f17` → level 10 pale-yellow `#f3e4a5`),
  and 22 presets each tagged with `targetLevel/targetTone/mode/maxLiftWithoutBleach`.

**Booking** (`src/app/actions/booking.ts`, `services/booking-service.ts`, `components/booking/BookingWizard.tsx`)
- `submitBooking()` requires login (`verifySession`), validates slot/availability, atomically
  claims any discount, creates an `Appointment` with `status: 'CONFIRMED'`, emails confirmation.
- `Appointment.status` supports `PENDING | CONFIRMED | CANCELLED | COMPLETED`, but **nothing
  writes `COMPLETED`** — admin `ScheduleCalendar` is read-only; `admin.ts` has no appointment
  status mutation. Customer-side `COMPLETED` only appears in display filters/badges.
- Services live in the DB (`Service` model), seeded by `prisma/seed.ts`. `Patch Test` (£10,
  5 min, category `Colouring`) exists but is just a normal bookable service — not enforced.

## 4. The colour-science model (Feature 1)

Web-verified basis (sources in §9). Levels 1–10 (1 = black → 10 = lightest blonde). Lifting any
dark hair always passes through warm underlying pigment in sequence **red → orange → yellow →
pale-yellow** — encoded already in `UNDERLYING_PIGMENT_HEX`.

### 4.1 漂前 — colour over natural hair (no bleach) — "deposit only"

Reality: dye **deposits**, it does not lift. Without bleach you get ≈1–2 levels of change at most;
**vivid/pastel colours cannot show** on dark hair; the darker the base, the **deeper and more
muted** the result; warmth/brassiness bleeds through. **Original colour matters.**

Model (per hair pixel; operates in linear RGB, preserving the source's own light/shadow texture):
1. **Base level** `B` = detected (or manual override).
2. **Achievable level** `La = min(targetLevel, B + MAX_LIFT_NO_BLEACH)` where
   `MAX_LIFT_NO_BLEACH ≈ 1` (global; up to ~2–3 only for shades flagged high-lift). If
   `targetLevel > La` → `constrained = true`, surface the "needs bleaching" notice.
3. **Lightness clamp:** the deposited result may not appear lighter than `refLuminance(La)`.
   Absolute lightness is driven by the (dark) base, not the target.
4. **Deposit blend:** `base = multiply(source, target)`, then mix a small amount toward
   `targetAtLuminance` — dark base dominates (this is the existing `deposit` path, applied
   globally under 漂前 regardless of the preset's own mode).
5. **Vividness suppression:** desaturate the deposited colour proportional to how far the target's
   natural level exceeds the base (`targetLevel − B`). A blue on level-2 hair collapses to a near-black
   tint.
6. **Warm bleed:** mix in `UNDERLYING_PIGMENT_HEX[B]` weighted by `targetLevel − B` (the brassiness
   real clients see when colour is put over un-lightened hair).

### 4.2 漂後上色 — colour on pre-bleached hair — "vivid / true"

Reality: once lifted to a pale level-9/10 base, deposited colour shows **close to the true
target**; **original colour is irrelevant**.

Model (per hair pixel):
1. **Ignore base level entirely.** Treat the canvas as pale (≈level 9.5).
2. **Gray-level mapping (ModiFace-style):** keep the source pixel's *relative* luminance (its
   highlight/shadow position within the hair) but drive *absolute* lightness + colour from the
   **target**: `result = withLuminance(target, targetRefLuminance × relativeSourceLuminance)`.
   Dark original pixels become the vivid target because lightness comes from the target, not the base.
3. **No lift cap** (you bleached — `maxLiftWithoutBleach` is bypassed).
4. **Residual undertone:** mix a *faint* pale-yellow (`UNDERLYING_PIGMENT_HEX[9/10]`) at low weight
   to mimic real bleached hair; a "toned" toggle removes it.

### 4.3 Why this is "accurate"

Accuracy = matching what really happens, not flattery. 漂後 genuinely resembles the swatch (reality
does too); 漂前 genuinely looks muted/warm/base-dominated. When a colour is unreachable without
bleach we show the realistic muted version **plus a notice**, instead of a fake vivid preview.

### 4.4 Retained behaviour

Base-level auto-detect + manual override, intensity slider (now = deposit/vividness strength),
22 presets + custom hex picker, download. The `deposit/tone/lift` per-preset `mode` becomes an
internal hint; the **master 漂前/漂後 toggle** is the primary driver.

## 5. Feature 1 — UX & architecture

**UX**
- Landing: remove the camera entry; offer **Upload Photo** and **Upload Video**.
- A prominent **漂前 / 漂後上色** segmented toggle near the palette, with one-line explanations and
  per-mode result notices (e.g., 漂前 + Platinum → "Needs pre-lightening to reach Platinum Blonde").
- Photo: unchanged pipeline, now routed through the mode-aware engine.
- Video: upload short clip → decode frames → segment+recolour each frame → play recoloured result
  in a `<canvas>` loop with play/pause + scrub; **download current still**.

**Video performance guardrails** (in-browser per-frame is what made live camera unreliable):
- Max clip length (≈8–10 s) and file size; downscale to ≤ `LIVE_FRAME_MAX_DIM`.
- Process frames **sequentially with a progress bar** (not real-time); cap processed FPS
  (≈12–15) and total frame count to bound memory.
- Reuse the slow-frame detection → if a device is too slow, advise photo mode.
- Recoloured frames cached as `ImageBitmap`/`ImageData` for smooth playback.

**Files touched**
- `src/components/try-color/constants.ts` — add `BleachState = 'pre' | 'post'`; extend
  `RecolorRequest` with `bleachState`; retune `MAX_LIFT_NO_BLEACH`; video constants.
- `src/components/try-color/colorMath.ts` — branch `resolveRecolorContext` / `buildModeBaseColor` /
  `applyRecolorToImageDataWithAlpha` on `bleachState` per §4.1/§4.2.
- `src/components/try-color/ColorPalette.tsx` — 漂前/漂後 toggle + per-mode notices.
- `src/app/try-color/TryColorClient.tsx` — hide camera mode; add Upload Video; wire `bleachState`;
  video frame loop + progress + playback.
- New: `src/components/try-color/VideoUploadProcessor.tsx` (or extend `UploadDropzone.tsx`) +
  a video frame-extraction/playback helper.
- `readme/structure.md` — document the new mode + video path.
- Camera files (`CameraView.tsx`, `segmentation.worker.ts`) remain but unreferenced (feature flag),
  so re-enabling later is trivial.

## 6. Feature 2 — Colour consultation/patch-test gate

**Rule:** booking any Colouring service requires a `COMPLETED` Consultation & Patch Test
appointment dated **≥48h before** the colour appointment and **within the previous 6 months**.

### 6.1 Data model (edit ALL three Prisma schemas + migration)

Add to `Service` in `prisma/dev`, `prisma/vercel`, `prisma/prod`:
- `requiresPatchTest Boolean @default(false)` — gated services (the Colouring colour services).
- `isPatchTest Boolean @default(false)` — marks the prerequisite Consultation & Patch Test service.

No new model: eligibility is **inferred from `Appointment`** records. Booleans (not an enum) for
SQLite/Postgres/MSSQL portability. Admin `ServiceForm` exposes both checkboxes.

### 6.2 Seed changes (`prisma/seed.ts`)
- Rename `Patch Test` → **`Consultation & Patch Test`** (duration ~15–20 min), `isPatchTest = true`.
- Set `requiresPatchTest = true` on every Colouring colour service (exclude the patch-test service).

### 6.3 Eligibility (`services/booking-service.ts`)
`hasValidPatchTest(userId, colourDate) → { ok: boolean; testDate?: Date }`:
find an `Appointment` where `service.isPatchTest`, `userId` matches, `status = 'COMPLETED'`,
`date >= colourDate − 6 months`, `date <= colourDate − 48h`.

### 6.4 Enforcement (two layers)
- **Server (authoritative)** — in `submitBooking()`, after loading the service: if
  `service.requiresPatchTest` and `!hasValidPatchTest(...)`, return
  `{ success: false, error }` and do not create the appointment. Re-check on
  `rescheduleAppointment` when the colour date moves.
- **Client (UX)** — new `checkColourEligibility(serviceId, date)` server action. In
  `BookingWizard`, selecting a `requiresPatchTest` service with no valid test shows a gate panel
  ("Colour services need a consultation & patch test ≥48h beforehand") and a CTA that pre-selects
  the Consultation & Patch Test service, instead of failing at the final step.

### 6.5 Admin: mark COMPLETED (new — required, currently missing)
- New admin-only action `updateAppointmentStatus(appointmentId, status)` (guard via `verifySession`
  + `role === 'ADMIN'`); allow `CONFIRMED → COMPLETED` (and `CANCELLED`).
- `ScheduleCalendar` appointment detail gets a "Mark completed" control.
- This is the authoritative signal that unlocks the colour booking.
- *Optional later:* a daily cron to auto-`COMPLETED` past patch tests, to reduce admin friction —
  deferred; manual marking is safer for an allergy gate.

### 6.6 Edge cases
- The Consultation & Patch Test service itself is never gated (excluded via `requiresPatchTest=false`).
- 48h rule blocks same-day colour after a fresh test — UX explains the wait.
- 6-month-expired test → must re-test. No valid test → routed to book one.
- Guests already blocked by `middleware.ts` (login required to book).
- Perms intentionally ungated (client decision); flipping `requiresPatchTest` later covers them.

## 7. Testing
- **Colour math (unit):** golden RGB assertions — 漂前 clamps lightness & mutes vivid-on-dark;
  漂後 yields near-target vivid regardless of base; level detection unchanged.
- **Eligibility (unit):** 48h and 6-month boundaries (just-inside / just-outside), wrong status,
  wrong service.
- **`submitBooking` gate (integration):** colour blocked without test; allowed with valid test;
  patch-test service itself bookable.
- **BookingWizard (component):** selecting a colour service surfaces the gate + CTA; non-colour
  services unaffected.
- **Admin:** `updateAppointmentStatus` rejects non-admins; flips status; gate then unlocks.
- `pnpm lint` + `pnpm build` clean.

## 8. Rollout / migration
- Schema migration adds two nullable-defaulted booleans → safe/back-compatible.
- Re-run/extend seed (or a one-off script) to set flags on existing rows in dev + Vercel DBs.
- Per `CLAUDE.md`: edit all three schema files; deploy Vercel migration via `pnpm db:vercel:deploy`.
- Try-color change is client-only (no DB/env). Camera disabled behind a flag (reversible).

## 9. Sources (colour science)
- Hair level system & tones — https://therighthairstyles.com/hair-color-levels-tones/
- Underlying pigment / lifting sequence — https://www.uglyducklingcolor.com/content/115-how-to-get-rid-of-red-hair
- Deposit-only without bleach — https://www.sallybeauty.com/just-ask-sally/articles/can-i-dye-my-hair-without-bleaching/
- Dark hair without bleach (muting, high-lift limits) — https://www.lorealparisusa.com/beauty-magazine/hair-color/hair-color-tutorials/hair-dye-for-dark-hair-without-bleach
- Lighter without bleach — limits — https://www.salonglam.ca/blogs/can-you-go-lighter-without-bleach
- ModiFace gray-level mapping recolour — https://modiface.com/products-hair.html ; patent https://patents.justia.com/patent/20240273857

## 10. Open decisions (resolved)
- Inputs: photo + video upload; **live camera disabled** for now.
- Engine: **improve in-browser**, no AI render API.
- Video: **recolour + play back whole clip** (with guardrails in §5).
- Gate: **must complete consultation & patch test first**; **≥48h before, valid 6 months**;
  scope = **all Colouring services**.
