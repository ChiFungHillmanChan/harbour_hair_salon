# Try-Color Bleach Modes + Colour Consultation Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit 漂前 (no-bleach) vs 漂後上色 (pre-bleached) mode to the virtual try-on with a science-grounded result model and photo+video input, and require a completed Consultation & Patch Test before any Colouring booking.

**Architecture:** Two independent parts. **Part A** is client-only: extend the existing in-browser recolour engine (`colorMath.ts`) with a `bleachState` branch, disable live camera, add video-clip processing. **Part B** is full-stack: two new `Service` boolean flags drive a patch-test gate enforced in `submitBooking` (server, authoritative) and surfaced in `BookingWizard` (UX), plus a new admin "mark completed" action that the gate depends on. Eligibility is a pure, unit-tested function fed by a Prisma query.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Prisma (SQLite dev / Postgres Vercel / MSSQL prod), Tailwind v4, MediaPipe Tasks Vision, Node `node:test` + `tsx` for tests.

**Spec:** `docs/superpowers/specs/2026-06-14-trycolor-bleach-modes-and-colour-consultation-gate-design.md`

**Branch:** `feat/trycolor-bleach-modes-and-colour-gate` (already created).

---

## Conventions & test runner

- Run colour-math tests: `pnpm test` (currently `node --import tsx --test src/components/try-color/colorMath.test.ts`). Task B0 widens this to all `*.test.ts`.
- After UI/DB tasks that have no unit test, the verification step is `pnpm lint && pnpm build` plus a described manual check on `pnpm dev`.
- Commit after every task. Keep `readme/structure.md` updated (final tasks).
- Type names are locked here and reused verbatim across tasks: `BleachState`, `RecolorRequest.bleachState`, `PatchTestRecord`, `EligibilityResult`, `evaluatePatchTestEligibility`, `getValidPatchTest`, `checkColourEligibility`, `updateAppointmentStatus`.

## File structure (what each touched/new file is responsible for)

**Part A**
- `src/components/try-color/constants.ts` — add `BleachState`, `RecolorRequest.bleachState`, video constants. *(modify)*
- `src/components/try-color/colorMath.ts` — branch resolve/blend on `bleachState`. *(modify)*
- `src/components/try-color/colorMath.test.ts` — add 漂前/漂後 tests. *(modify)*
- `src/components/try-color/ColorPalette.tsx` — 漂前/漂後 toggle + per-mode notice. *(modify)*
- `src/components/try-color/VideoTryOn.tsx` — upload a clip, recolour every frame, play back, download still. *(create)*
- `src/app/try-color/TryColorClient.tsx` — hide camera, thread `bleachState`, mount video path. *(modify)*

**Part B**
- `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma` — `Service.requiresPatchTest`, `Service.isPatchTest`. *(modify all three)*
- `prisma/seed.ts` — rename Patch Test → Consultation & Patch Test (`isPatchTest`), flag Colouring services (`requiresPatchTest`). *(modify)*
- `src/app/services/patch-test-eligibility.ts` — pure eligibility logic + constants. *(create)*
- `src/app/services/patch-test-eligibility.test.ts` — boundary unit tests. *(create)*
- `src/app/services/booking-service.ts` — `getValidPatchTest()` Prisma wrapper. *(modify)*
- `src/app/actions/booking.ts` — gate in `submitBooking`; `checkColourEligibility()`. *(modify)*
- `src/app/actions/admin.ts` — `updateAppointmentStatus()`. *(modify)*
- `src/components/admin/ScheduleCalendar.tsx` — "Mark completed" control. *(modify)*
- `src/components/booking/BookingWizard.tsx` — gate panel + CTA on colour services. *(modify)*
- `src/components/admin/ServiceForm.tsx` + `src/app/actions/admin-services.ts` — expose the two flags. *(modify)*
- `package.json` — widen `test` script. *(modify)*

---

# PART A — Try Color: 漂前 / 漂後 modes + video

## Task A1: Add `bleachState` type, request field, and video constants

**Files:**
- Modify: `src/components/try-color/constants.ts`

- [ ] **Step 1: Add the `BleachState` type** after the existing type aliases (near `constants.ts:6`, after `HairLevelMode`):

```ts
export type BleachState = 'pre' | 'post'; // 漂前 (colour over natural hair) | 漂後上色 (colour on pre-bleached hair)
```

- [ ] **Step 2: Add `bleachState` to `RecolorRequest`** (modify the interface at `constants.ts:29-34`):

```ts
export interface RecolorRequest {
  preset: ShadePreset;
  previewStrength: number;
  baseLevelMode: HairLevelMode;
  manualBaseLevel?: HairLevel;
  bleachState?: BleachState; // defaults to 'pre' when unset (back-compat)
}
```

- [ ] **Step 3: Add video constants** at the end of `constants.ts`:

```ts
// Video try-on guardrails (per-frame recolor is heavy; keep clips short)
export const VIDEO_MAX_SECONDS = 10;
export const VIDEO_MAX_DIM = 480;
export const VIDEO_TARGET_FPS = 12;
export const VIDEO_MAX_FRAMES = 150;
export const VIDEO_MAX_FILE_BYTES = 50 * 1024 * 1024;
```

- [ ] **Step 4: Verify nothing breaks** (the field is optional):

Run: `pnpm test`
Expected: PASS — all existing colorMath tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/components/try-color/constants.ts
git commit -m "feat(try-color): add BleachState type, request field, and video constants"
```

## Task A2: 漂後上色 (post-bleach) vivid branch in the engine

The post-bleach result must **ignore the dark base**: bypass the lift cap (`achievedLevel === targetLevel`, `constrained === false`) and drive absolute lightness from the target so a dark original still shows the vivid target colour.

**Files:**
- Modify: `src/components/try-color/colorMath.ts`
- Test: `src/components/try-color/colorMath.test.ts`

- [ ] **Step 1: Write failing tests** — append to `colorMath.test.ts`:

```ts
test('post-bleach mode bypasses the lift cap regardless of dark base', () => {
  const platinum = PRESET_COLORS.find((p) => p.name === 'Platinum Blonde');
  assert.ok(platinum);
  const analysis = {
    meanLuminance: 0.1, p95Luminance: 0.16, chroma: 0.1,
    warmCoolBias: 0.25, estimatedBaseLevel: 2 as const, confidence: 1,
  };
  const resolved = resolveRecolorContext(
    { preset: platinum!, previewStrength: 70, baseLevelMode: 'auto', bleachState: 'post' },
    analysis,
  );
  assert.equal(resolved.achievedLevel, 10);
  assert.equal(resolved.constrained, false);
  assert.equal(resolved.expectedResultNotice, null);
});

test('post-bleach renders a vivid target on dark hair; pre-bleach mutes it', () => {
  const blue = PRESET_COLORS.find((p) => p.name === 'Blue');
  assert.ok(blue);

  function recolouredChroma(bleachState: 'pre' | 'post'): number {
    const { imageData, mask } = createSolidImageData([[28, 20, 14]]); // dark level-2 hair
    const hairMask = createHairMaskData(imageData, Array.from(mask));
    applyRecolorToImageDataWithAlpha(imageData, hairMask, {
      preset: blue!, previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 2, bleachState,
    });
    const [r, g, b] = [imageData.data[0], imageData.data[1], imageData.data[2]];
    return Math.max(r, g, b) - Math.min(r, g, b);
  }

  const post = recolouredChroma('post');
  const pre = recolouredChroma('pre');
  assert.ok(post > pre + 20, `expected post (${post}) much more vivid than pre (${pre})`);
  assert.ok(post > 40, `expected post chroma vivid, got ${post}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — post-bleach currently behaves like pre (cap applied, low chroma).

- [ ] **Step 3: Branch `resolveRecolorContext`** — in `colorMath.ts`, replace the level-resolution block (`colorMath.ts:309-362`) so that `post` bypasses the cap. Add at the top of the function body (right after `effectiveBaseLevel` is computed, ~line 316):

```ts
  const bleachState = request.bleachState ?? 'pre';

  if (bleachState === 'post') {
    // Pre-bleached canvas: target shows true; original colour irrelevant.
    const targetLinear = mixRgb(
      hexToLinearRgb(request.preset.swatchHex),
      hexToLinearRgb(getUnderlyingPigmentHex(10)), // faint residual pale-yellow
      0.04,
    );
    return {
      analysis,
      effectiveBaseLevel,
      achievedLevel: request.preset.targetLevel,
      constrained: false,
      expectedResultNotice: null,
      requestedLift: Math.max(0, request.preset.targetLevel - effectiveBaseLevel),
      achievedLift: Math.max(0, request.preset.targetLevel - effectiveBaseLevel),
      resolvedRefL: clamp01(request.preset.refL),
      targetLinear,
      strength: clamp01(request.previewStrength / 100),
    };
  }
```

Leave the existing (pre-bleach) resolution code below it unchanged.

- [ ] **Step 4: Branch the per-pixel blend** — in `buildModeBaseColor` (`colorMath.ts:364-386`), make `post` drive luminance from the target and skip source-multiply. Add at the start of the function:

```ts
  if ((request.bleachState ?? 'pre') === 'post') {
    // Gray-level mapping: keep the pixel's relative light/shadow, take colour+lightness from target.
    return withLuminance(state.targetLinear, desiredLuminance);
  }
```

- [ ] **Step 5: Reduce base-pigment bleed in post mode** — in `applyRecolorToImageDataWithAlpha`, the lines that mix `warmPigment`/`goldenHighlight` (`colorMath.ts:416-417`, `450-451`) should be muted in post mode. Change the two `modeBase = mixRgb(...)` lines (450-451) to scale by a post factor:

```ts
    const undertoneScale = (request.bleachState ?? 'pre') === 'post' ? 0.15 : 1;
    modeBase = mixRgb(modeBase, goldenHighlight, highlightWeight * 0.12 * undertoneScale);
    modeBase = mixRgb(modeBase, warmPigment, shadowWeight * 0.14 * undertoneScale);
```

- [ ] **Step 6: Lift the deposit blend-alpha penalty in post mode** — the per-mode `blendAlpha` reductions (`colorMath.ts:456-459`) should not damp post. After that block add:

```ts
    if ((request.bleachState ?? 'pre') === 'post') blendAlpha = alpha * state.strength;
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — new post-bleach tests pass; all prior tests still pass (pre path untouched).

- [ ] **Step 8: Commit**

```bash
git add src/components/try-color/colorMath.ts src/components/try-color/colorMath.test.ts
git commit -m "feat(try-color): add 漂後上色 post-bleach vivid recolor branch"
```

## Task A3: 漂前 realism — mute vivid colours that the base can't support

In pre mode, when the target is far lighter/more vivid than the base (`constrained`), the visible colour must wash out and warm up — what deposit-only dye really does. Non-constrained presets must stay byte-for-byte unchanged so existing tests pass.

**Files:**
- Modify: `src/components/try-color/colorMath.ts`
- Test: `src/components/try-color/colorMath.test.ts`

- [ ] **Step 1: Write failing test** — append to `colorMath.test.ts`:

```ts
test('pre-bleach mutes a vivid cool target on dark hair (deposit reality)', () => {
  const blue = PRESET_COLORS.find((p) => p.name === 'Blue');
  assert.ok(blue);
  const { imageData, mask } = createSolidImageData([[30, 22, 16]]); // dark level-2
  const hairMask = createHairMaskData(imageData, Array.from(mask));
  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: blue!, previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 2, bleachState: 'pre',
  });
  const [r, g, b] = [imageData.data[0], imageData.data[1], imageData.data[2]];
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(chroma < 35, `expected muted chroma on dark hair, got ${chroma}`);
  assert.ok(lum < 90, `expected result to stay dark, got ${lum}`);
});
```

- [ ] **Step 2: Run test to verify it fails (or is weak)**

Run: `pnpm test`
Expected: the assertion may already pass partially; if it fails, proceed. Either way implement Step 3 to guarantee the behaviour and a regression guard.

- [ ] **Step 3: Add constrained desaturation** — in `applyRecolorToImageDataWithAlpha`, compute a per-call mute factor once before the pixel loop (after `state` is resolved, ~`colorMath.ts:412`):

```ts
  const bleach = request.bleachState ?? 'pre';
  const overreach = Math.max(0, request.preset.targetLevel - state.effectiveBaseLevel);
  // Only bites when pre-bleach AND the shade can't be reached without lifting.
  const preMute = bleach === 'pre' && state.constrained ? clamp01(overreach * 0.18) : 0;
```

Then, inside the loop, after `modeBase` is finalised (just before `let blendAlpha`, ~line 455) desaturate and warm it by `preMute`:

```ts
    if (preMute > 0) {
      modeBase = desaturateRgb(modeBase, preMute * 0.8);
      modeBase = mixRgb(modeBase, warmPigment, preMute * 0.4);
    }
```

Because `preMute` is `0` for every non-constrained preset, all existing tests (Caramel/Copper/Golden/Black at base 5, none constrained) are unaffected.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — new mute test passes; all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/components/try-color/colorMath.ts src/components/try-color/colorMath.test.ts
git commit -m "feat(try-color): mute unreachable vivid colours in 漂前 deposit mode"
```

## Task A4: 漂前/漂後 toggle in ColorPalette

**Files:**
- Modify: `src/components/try-color/ColorPalette.tsx`

- [ ] **Step 1: Extend props** — add to `ColorPaletteProps` (`ColorPalette.tsx:12-25`):

```ts
  bleachState: import('./constants').BleachState;
  onBleachStateChange: (value: import('./constants').BleachState) => void;
```

and destructure `bleachState, onBleachStateChange` in the component signature.

- [ ] **Step 2: Render the segmented toggle** — insert directly below the swatch header `</div>` (after `ColorPalette.tsx:60`), before the hair-level card:

```tsx
      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <p className="text-accent text-xs uppercase tracking-[0.2em] font-medium">Colour Method</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['pre', '漂前 · No Bleach', 'Colour over your natural hair'],
            ['post', '漂後上色 · Pre-Bleached', 'Colour on pre-lightened hair'],
          ] as const).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => onBleachStateChange(value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                bleachState === value
                  ? 'border-accent bg-accent/10 text-white'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-[10px] text-zinc-500">{hint}</span>
            </button>
          ))}
        </div>
        <p className="text-zinc-500 text-[11px]">
          {bleachState === 'post'
            ? 'Showing the colour as it appears on pre-bleached hair — close to the true shade.'
            : 'Showing a realistic deposit result — vivid shades look muted on darker hair without bleaching.'}
        </p>
      </div>
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: clean compile. Manual (`pnpm dev` → `/try-color`, upload a photo): toggling 漂前/漂後 visibly changes a vivid shade from muted → vivid.

- [ ] **Step 4: Commit**

```bash
git add src/components/try-color/ColorPalette.tsx
git commit -m "feat(try-color): add 漂前/漂後 method toggle to ColorPalette"
```

## Task A5: Disable live camera; thread `bleachState` through TryColorClient

**Files:**
- Modify: `src/app/try-color/TryColorClient.tsx`

- [ ] **Step 1: Add a camera feature flag** near the top of the module (after imports):

```ts
const ENABLE_LIVE_CAMERA = false; // disabled per client request; code retained for re-enable
```

- [ ] **Step 2: Add bleach-state UI state** — alongside the other `useState` hooks for colour/level:

```ts
const [bleachState, setBleachState] = useState<import('@/components/try-color/constants').BleachState>('pre');
```

- [ ] **Step 3: Hide the camera entry on the landing screen** — find the landing-mode buttons that set mode to `'camera'` and wrap the camera option in `{ENABLE_LIVE_CAMERA && ( ... )}`. Make **Upload** the primary/default action. If the initial `mode` state defaults to `'landing'`, leave it; if it auto-starts camera, default it to `'upload'`.

- [ ] **Step 4: Pass `bleachState` into every `RecolorRequest`** built in this file (camera worker dispatch — now flag-gated — and the upload re-render path). Add `bleachState,` to each request object literal.

- [ ] **Step 5: Wire the toggle into `<ColorPalette ... />`** — add the two new props:

```tsx
  bleachState={bleachState}
  onBleachStateChange={setBleachState}
```

- [ ] **Step 6: Verify**

Run: `pnpm lint && pnpm build`
Expected: clean. Manual: `/try-color` shows no live-camera option; upload + toggle work; changing the toggle re-renders the uploaded photo.

- [ ] **Step 7: Commit**

```bash
git add src/app/try-color/TryColorClient.tsx
git commit -m "feat(try-color): disable live camera and thread bleachState through client"
```

## Task A6: Video upload — recolour every frame and play it back

Reuse the still segmenter (`HairSegmentation.segmentStill` / `refineHairMask`) and `applyRecolorToImageDataWithAlpha` per frame. Store **source** frames so changing colour/mode re-renders without re-decoding. Enforce all `VIDEO_*` guardrails.

**Files:**
- Create: `src/components/try-color/VideoTryOn.tsx`
- Modify: `src/app/try-color/TryColorClient.tsx` (mount the video option)

- [ ] **Step 1: Create `VideoTryOn.tsx`** with this structure (complete the JSX shell; the load-bearing logic is shown in full):

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VIDEO_MAX_SECONDS, VIDEO_MAX_DIM, VIDEO_TARGET_FPS, VIDEO_MAX_FRAMES, VIDEO_MAX_FILE_BYTES,
  type RecolorRequest,
} from './constants';
import { getSegmenter, refineHairMask, type HairMaskData } from './HairSegmentation';
import { applyRecolorToImageDataWithAlpha } from './colorMath';

interface Frame { source: ImageData; mask: HairMaskData; }

interface VideoTryOnProps {
  request: Omit<RecolorRequest, 'preset'> & Pick<RecolorRequest, 'preset'>;
}

function fitDimensions(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, VIDEO_MAX_DIM / Math.max(w, h));
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function VideoTryOn({ request }: VideoTryOnProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<Frame[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'processing' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);

  // --- Extract + segment frames from an uploaded clip (runs once per file) ---
  const handleFile = useCallback(async (file: File) => {
    setError(null);
    if (file.size > VIDEO_MAX_FILE_BYTES) { setError('Video is too large (max 50MB).'); return; }
    setStatus('processing'); setProgress(0); framesRef.current = [];

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url; video.muted = true; video.playsInline = true;
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error('Could not read video.'));
    });

    if (video.duration > VIDEO_MAX_SECONDS + 0.5) {
      setError(`Please use a clip under ${VIDEO_MAX_SECONDS}s.`); setStatus('error');
      URL.revokeObjectURL(url); return;
    }

    const { w, h } = fitDimensions(video.videoWidth, video.videoHeight);
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const ctx = off.getContext('2d', { willReadFrequently: true })!;
    const segmenter = await getSegmenter();

    const total = Math.min(VIDEO_MAX_FRAMES, Math.floor(video.duration * VIDEO_TARGET_FPS));
    const step = video.duration / total;
    const slowFrames: number[] = [];

    for (let i = 0; i < total; i++) {
      const t0 = performance.now();
      await seek(video, i * step);
      ctx.drawImage(video, 0, 0, w, h);
      const source = ctx.getImageData(0, 0, w, h);
      const raw = segmenter.segment(off); // returns confidence mask for this still
      const mask = refineHairMask(source, raw);
      framesRef.current.push({ source: copyImageData(source), mask });
      setProgress(Math.round(((i + 1) / total) * 100));
      const dt = performance.now() - t0;
      if (dt > 200) slowFrames.push(dt);
      if (slowFrames.length > total * 0.6) {
        setError('This device is too slow for video. Try a photo instead.');
        setStatus('error'); URL.revokeObjectURL(url); return;
      }
    }
    URL.revokeObjectURL(url);
    setFrameIndex(0); setStatus('ready'); renderFrame(0);
  }, []);

  // --- Recolor + paint a single stored frame with the CURRENT request ---
  const renderFrame = useCallback((index: number) => {
    const frame = framesRef.current[index];
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const working = copyImageData(frame.source);
    applyRecolorToImageDataWithAlpha(working, frame.mask, request as RecolorRequest);
    canvas.width = working.width; canvas.height = working.height;
    canvas.getContext('2d')!.putImageData(working, 0, 0);
  }, [request]);

  // Re-render current frame whenever colour/mode/strength change.
  useEffect(() => { if (status === 'ready') renderFrame(frameIndex); }, [request, status, frameIndex, renderFrame]);

  // Playback loop at VIDEO_TARGET_FPS.
  useEffect(() => {
    if (!playing || status !== 'ready') return;
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % framesRef.current.length);
    }, 1000 / VIDEO_TARGET_FPS);
    return () => clearInterval(id);
  }, [playing, status]);

  const downloadStill = useCallback(() => {
    canvasRef.current?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `hair-color-frame-${frameIndex}.jpg`;
      a.click(); URL.revokeObjectURL(a.href);
    }, 'image/jpeg', 0.9);
  }, [frameIndex]);

  // ... JSX: file <input accept="video/*">, progress bar bound to `progress`,
  //     <canvas ref={canvasRef}>, play/pause button bound to `playing`,
  //     a range scrubber bound to frameIndex (0..frames.length-1),
  //     a "Download still" button, and `error` display. Render `status`-driven UI.
  return null; // replace with the JSX described above
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((res) => { video.onseeked = () => res(); video.currentTime = time; });
}
function copyImageData(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}
```

> **Note for the implementer:** verify the exact still-segmentation call names in `HairSegmentation.ts` (`getSegmenter`, `segmentStill`, `refineHairMask`) and adapt `segmenter.segment(off)` to the real API — `segmentStill()` may already return a refined `HairMaskData`, in which case skip `refineHairMask`. Keep the per-frame contract: `source: ImageData` + `mask: HairMaskData` → `applyRecolorToImageDataWithAlpha`.

- [ ] **Step 2: Mount it in `TryColorClient.tsx`** — add an "Upload Video" choice on the landing screen that switches to a `'video'` mode rendering `<VideoTryOn request={{ preset, previewStrength, baseLevelMode, manualBaseLevel, bleachState }} />`, using the same `preset`/level/`bleachState` state already wired for photos.

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: clean. Manual: upload a ≤10s clip → progress bar fills → recoloured playback; scrub works; switching 漂前/漂後 or colour re-renders the current frame; "Download still" saves a JPEG; an 11s clip is rejected with a clear message.

- [ ] **Step 4: Commit**

```bash
git add src/components/try-color/VideoTryOn.tsx src/app/try-color/TryColorClient.tsx
git commit -m "feat(try-color): add video-clip upload with per-frame recolor and playback"
```

## Task A7: Document Part A

**Files:**
- Modify: `readme/structure.md`

- [ ] **Step 1:** Under the Try-Color section, note: live camera disabled behind `ENABLE_LIVE_CAMERA`; `bleachState` ('pre'/'post') master mode in `colorMath.ts`; new `VideoTryOn.tsx`.
- [ ] **Step 2: Commit**

```bash
git add readme/structure.md
git commit -m "docs: record try-color bleach modes and video path in structure.md"
```

---

# PART B — Colour bookings require Consultation & Patch Test

## Task B0: Widen the test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** Change the `test` script (currently pinned to `colorMath.test.ts`) to:

```json
"test": "node --import tsx --test \"src/**/*.test.ts\""
```

- [ ] **Step 2: Verify** (Node ≥21 expands the glob; the project runs Node ≥20 for Next 16 — if your Node is older, list both files explicitly):

Run: `pnpm test`
Expected: PASS — existing colorMath tests run.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: run all *.test.ts under src in the test script"
```

## Task B1: Schema flags on `Service` (all three Prisma files)

**Files:**
- Modify: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`

- [ ] **Step 1:** In **each** of the three schema files, add two fields to `model Service` (after `category`):

```prisma
  requiresPatchTest Boolean @default(false)
  isPatchTest       Boolean @default(false)
```

- [ ] **Step 2: Push to dev + regenerate client**

Run: `pnpm db:dev:push && pnpm db:dev:generate`
Expected: SQLite schema updated; Prisma client regenerated with the two new fields.

- [ ] **Step 3: Verify build sees the types**

Run: `pnpm build`
Expected: clean (no type errors referencing `Service`).

- [ ] **Step 4: Commit**

```bash
git add prisma/dev/schema.prisma prisma/vercel/schema.prisma prisma/prod/schema.prisma
git commit -m "feat(db): add Service.requiresPatchTest and Service.isPatchTest flags"
```

## Task B2: Seed — consultation service + flag colouring services

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1:** Find the `Patch Test` service entry (`prisma/seed.ts:~68`). Rename and flag it:

```ts
{ name: 'Consultation & Patch Test', price: 10.00, duration: 15, category: 'Colouring',
  description: 'Required consultation and allergy patch test before any colour service (book at least 48h ahead).',
  isPatchTest: true },
```

- [ ] **Step 2:** Ensure every other `category: 'Colouring'` service object includes `requiresPatchTest: true`. If the services are built from a list, add the field where the object is constructed; otherwise set it per entry. The Consultation & Patch Test entry must **not** set `requiresPatchTest` (stays default `false`).

- [ ] **Step 3: Re-seed dev**

Run: `pnpm db:dev:push && npx tsx prisma/seed.ts` (or the project's seed command if different)
Expected: services upserted; one `isPatchTest` service, colour services flagged.

- [ ] **Step 4: Verify in studio (optional)**

Run: `pnpm db:dev:studio` → confirm flags. (Close when done.)

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(db): seed Consultation & Patch Test and flag colouring services"
```

## Task B3: Pure eligibility logic (unit-tested)

**Files:**
- Create: `src/app/services/patch-test-eligibility.ts`
- Create: `src/app/services/patch-test-eligibility.test.ts`

- [ ] **Step 1: Write the failing test** — `patch-test-eligibility.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePatchTestEligibility, PATCH_TEST_MIN_LEAD_HOURS } from './patch-test-eligibility';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const colour = new Date('2026-07-01T10:00:00Z');

test('no tests → not eligible (none)', () => {
  const r = evaluatePatchTestEligibility([], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'none');
});

test('completed test 3 days before, within 6 months → eligible', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 3 * DAY), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'eligible');
});

test('completed test only 24h before (<48h lead) → too_soon', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 24 * HOUR), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_soon');
});

test('exactly 48h before → eligible (boundary inclusive)', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - PATCH_TEST_MIN_LEAD_HOURS * HOUR), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, true);
});

test('completed test 200 days before → expired', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 200 * DAY), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('confirmed-but-not-completed test → not_completed', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 3 * DAY), status: 'CONFIRMED' }], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_completed');
});

test('picks the most recent qualifying test', () => {
  const r = evaluatePatchTestEligibility([
    { date: new Date(colour.getTime() - 150 * DAY), status: 'COMPLETED' },
    { date: new Date(colour.getTime() - 5 * DAY), status: 'COMPLETED' },
  ], colour);
  assert.equal(r.ok, true);
  assert.equal(r.testDate?.toISOString(), new Date(colour.getTime() - 5 * DAY).toISOString());
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `patch-test-eligibility.ts`**:

```ts
// Pure, dependency-free eligibility logic for the colour-booking patch-test gate.
export const PATCH_TEST_MIN_LEAD_HOURS = 48;
export const PATCH_TEST_VALIDITY_DAYS = 183; // ~6 months

export interface PatchTestRecord {
  date: Date;
  status: string; // appointment status
}

export type EligibilityReason =
  | 'eligible' | 'none' | 'not_completed' | 'too_soon' | 'expired';

export interface EligibilityResult {
  ok: boolean;
  testDate: Date | null;
  reason: EligibilityReason;
}

export function evaluatePatchTestEligibility(
  tests: PatchTestRecord[],
  colourDate: Date,
): EligibilityResult {
  if (tests.length === 0) return { ok: false, testDate: null, reason: 'none' };

  const completed = tests
    .filter((t) => t.status === 'COMPLETED')
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // most recent first

  if (completed.length === 0) return { ok: false, testDate: null, reason: 'not_completed' };

  const minLeadMs = PATCH_TEST_MIN_LEAD_HOURS * 3600_000;
  const validityMs = PATCH_TEST_VALIDITY_DAYS * 24 * 3600_000;
  const target = colourDate.getTime();

  let sawTooSoon = false;
  let sawExpired = false;

  for (const t of completed) {
    const lead = target - t.date.getTime();
    if (lead < minLeadMs) { sawTooSoon = true; continue; }   // test too close to (or after) colour date
    if (lead > validityMs) { sawExpired = true; continue; }  // test older than validity window
    return { ok: true, testDate: t.date, reason: 'eligible' };
  }

  if (sawTooSoon) return { ok: false, testDate: null, reason: 'too_soon' };
  if (sawExpired) return { ok: false, testDate: null, reason: 'expired' };
  return { ok: false, testDate: null, reason: 'none' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all eligibility + colorMath tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/patch-test-eligibility.ts src/app/services/patch-test-eligibility.test.ts
git commit -m "feat(booking): add pure patch-test eligibility logic with tests"
```

## Task B4: Prisma wrapper `getValidPatchTest`

**Files:**
- Modify: `src/app/services/booking-service.ts`

- [ ] **Step 1: Add the query+delegate function** (place near the other exports; reuse the existing `prisma` import in this file):

```ts
import {
  evaluatePatchTestEligibility,
  type EligibilityResult,
} from './patch-test-eligibility';

/**
 * Eligibility for booking a colour service on `colourDate`:
 * the user must have a COMPLETED patch-test appointment ≥48h before and within 6 months.
 */
export async function getValidPatchTest(
  userId: string,
  colourDate: Date,
): Promise<EligibilityResult> {
  const tests = await prisma.appointment.findMany({
    where: { userId, service: { isPatchTest: true } },
    select: { date: true, status: true },
    orderBy: { date: 'desc' },
    take: 20,
  });
  return evaluatePatchTestEligibility(tests, colourDate);
}
```

> If `booking-service.ts` imports prisma under a different name, match it. Confirm the import path for `prisma` already used in this file and reuse it.

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: clean (the `service: { isPatchTest: true }` filter compiles against the regenerated client).

- [ ] **Step 3: Commit**

```bash
git add src/app/services/booking-service.ts
git commit -m "feat(booking): add getValidPatchTest Prisma eligibility wrapper"
```

## Task B5: Enforce the gate in `submitBooking` + add `checkColourEligibility`

**Files:**
- Modify: `src/app/actions/booking.ts`

- [ ] **Step 1: Import the wrapper** at the top of `booking.ts`:

```ts
import { createBooking, getAvailableSlots, getValidPatchTest } from '@/app/services/booking-service';
```

- [ ] **Step 2: Gate the booking** — in `submitBooking`, insert **before** the `createBooking(...)` call (between `booking.ts:165` and `:167`):

```ts
  // Colour services require a completed Consultation & Patch Test first.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { requiresPatchTest: true },
  });
  if (service?.requiresPatchTest) {
    const eligibility = await getValidPatchTest(session.userId, fullDate);
    if (!eligibility.ok) {
      const message =
        eligibility.reason === 'too_soon'
          ? 'Your patch test must be at least 48 hours before a colour appointment.'
          : eligibility.reason === 'expired'
            ? 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.'
            : 'Colour services require a completed Consultation & Patch Test first. Please book that appointment.';
      return { success: false, error: message };
    }
  }
```

- [ ] **Step 3: Add the eligibility-check action** for the wizard — append to `booking.ts`:

```ts
export async function checkColourEligibility(serviceId: string, dateIso: string) {
  const session = await verifySession();
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { requiresPatchTest: true },
  });
  if (!service?.requiresPatchTest) {
    return { requiresTest: false, eligible: true, reason: 'eligible' as const, testDate: null };
  }
  const eligibility = await getValidPatchTest(session.userId, new Date(dateIso));
  return {
    requiresTest: true,
    eligible: eligibility.ok,
    reason: eligibility.reason,
    testDate: eligibility.testDate ? eligibility.testDate.toISOString() : null,
  };
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 5: Manual verification** (`pnpm dev`):
  - As a logged-in user with no patch test, attempt to book a Colouring service → booking is rejected with the gate message.
  - Book the Consultation & Patch Test (allowed — not gated).
  - (Set that appointment to COMPLETED after Task B6/B7, dated ≥48h before a colour slot) → colour booking now succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/booking.ts
git commit -m "feat(booking): gate colour bookings on a completed Consultation & Patch Test"
```

## Task B6: Admin action to set appointment status

**Files:**
- Modify: `src/app/actions/admin.ts`

- [ ] **Step 1: Add an admin-guarded status mutation** (reuse the file's existing `prisma`, `verifySession`, `revalidatePath` imports — add any that are missing):

```ts
const ALLOWED_APPOINTMENT_STATUSES = ['CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
type AppointmentStatus = (typeof ALLOWED_APPOINTMENT_STATUSES)[number];

export async function updateAppointmentStatus(appointmentId: string, status: string) {
  const session = await verifySession();
  if (session.role !== 'ADMIN') {
    return { success: false, error: 'Not authorised' };
  }
  if (!ALLOWED_APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return { success: false, error: 'Invalid status' };
  }
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status },
  });
  revalidatePath('/admin');
  revalidatePath('/appointments');
  return { success: true };
}
```

> Confirm `verifySession()` returns `role` (it does per `src/app/lib/session.ts`). If `admin.ts` lacks `revalidatePath`, add `import { revalidatePath } from 'next/cache';`.

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/admin.ts
git commit -m "feat(admin): add updateAppointmentStatus action (mark completed/cancelled)"
```

## Task B7: "Mark completed" control in the admin schedule

**Files:**
- Modify: `src/components/admin/ScheduleCalendar.tsx`

- [ ] **Step 1:** In the appointment-detail area (where `appt.status` is rendered, ~`ScheduleCalendar.tsx:272`), add an admin control. Since this is a client component, call the server action directly:

```tsx
{appt.status === 'CONFIRMED' && (
  <button
    type="button"
    onClick={async () => {
      const { updateAppointmentStatus } = await import('@/app/actions/admin');
      const res = await updateAppointmentStatus(appt.id, 'COMPLETED');
      if (res.success) location.reload();
      else alert(res.error ?? 'Failed to update');
    }}
    className="mt-2 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
  >
    Mark completed
  </button>
)}
```

> If `ScheduleCalendar` is not already a client component, confirm it has `'use client'` at the top (it uses `onClick`/`useState`, so it is). Match the existing `appt` object shape for `appt.id`.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: clean. Manual: admin schedule → a CONFIRMED appointment shows "Mark completed"; clicking flips it to COMPLETED (badge updates after reload).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/ScheduleCalendar.tsx
git commit -m "feat(admin): mark appointments completed from the schedule calendar"
```

## Task B8: Gate UX in the booking wizard

**Files:**
- Modify: `src/components/booking/BookingWizard.tsx`

- [ ] **Step 1:** When a service with `requiresPatchTest` is selected, call `checkColourEligibility` and, if not eligible, show a blocking panel with a CTA that switches the wizard to the Consultation & Patch Test service. Add state + effect in the wizard:

```tsx
const [colourGate, setColourGate] = useState<
  { eligible: boolean; reason: string; testDate: string | null } | null
>(null);

// after a service + date are chosen (or on entering CONFIRM for a colour service):
useEffect(() => {
  const svc = services.find((s) => s.id === selectedServiceId);
  if (!svc || !svc.requiresPatchTest || !selectedDate) { setColourGate(null); return; }
  let cancelled = false;
  (async () => {
    const { checkColourEligibility } = await import('@/app/actions/booking');
    const res = await checkColourEligibility(svc.id, selectedDate.toISOString());
    if (!cancelled) setColourGate({ eligible: res.eligible, reason: res.reason, testDate: res.testDate });
  })();
  return () => { cancelled = true; };
}, [selectedServiceId, selectedDate, services]);
```

> `services` must carry `requiresPatchTest` / `isPatchTest`. Confirm the booking page query (`src/app/book/page.tsx`) selects them; if it uses `select`, add the two fields, otherwise the default include already returns them.

- [ ] **Step 2:** Render the gate (above the confirm button) and block submission when `colourGate && !colourGate.eligible`:

```tsx
{colourGate && !colourGate.eligible && (
  <div className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
    <p className="font-medium">Consultation & Patch Test required</p>
    <p className="mt-1">
      Colour services need a completed consultation & patch test at least 48 hours beforehand
      {colourGate.reason === 'expired' ? ' (your previous test has expired)' : ''}.
    </p>
    <button
      type="button"
      onClick={() => {
        const test = services.find((s) => s.isPatchTest);
        if (test) selectService(test); // reuse the wizard's existing service-select handler
      }}
      className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700"
    >
      Book Consultation & Patch Test first
    </button>
  </div>
)}
```

Disable/guard the final submit while `colourGate && !colourGate.eligible` (the server also rejects it, so this is UX only).

> Replace `selectService`/`selectedServiceId`/`selectedDate` with the wizard's actual state/handler names (see `BookingWizard.tsx` SERVICE/CONFIRM steps).

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: clean. Manual: selecting a colour service without a valid test shows the panel + CTA and blocks confirm; the CTA jumps to the Consultation & Patch Test service; after an admin marks a test COMPLETED ≥48h before the slot, the panel clears and confirm works.

- [ ] **Step 4: Commit**

```bash
git add src/components/booking/BookingWizard.tsx src/app/book/page.tsx
git commit -m "feat(booking): surface colour patch-test gate in the booking wizard"
```

## Task B9: Expose the flags in the admin Service form

**Files:**
- Modify: `src/components/admin/ServiceForm.tsx`, `src/app/actions/admin-services.ts`

- [ ] **Step 1:** Add two checkboxes (`requiresPatchTest`, `isPatchTest`) to `ServiceForm.tsx`, defaulting from the edited service.
- [ ] **Step 2:** In `admin-services.ts`, read the two checkbox values from `FormData` (`formData.get('requiresPatchTest') === 'on'`) and include them in the `create`/`update` data.
- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: clean. Manual: editing a service can toggle both flags and they persist.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/ServiceForm.tsx src/app/actions/admin-services.ts
git commit -m "feat(admin): manage requiresPatchTest/isPatchTest on the service form"
```

## Task B10: Document + final verification

**Files:**
- Modify: `readme/structure.md`

- [ ] **Step 1:** Record the gate: `Service.requiresPatchTest`/`isPatchTest`, `patch-test-eligibility.ts`, `getValidPatchTest`, `checkColourEligibility`, `updateAppointmentStatus`, and the wizard/admin changes.
- [ ] **Step 2: Full verification**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add readme/structure.md
git commit -m "docs: record colour patch-test gate in structure.md"
```

---

## Deployment notes (after merge)
- Vercel Postgres needs the migration: `pnpm db:vercel:deploy` (or `db:vercel:push`) and a seed/backfill to set the flags on existing rows (`requiresPatchTest` on Colouring colour services, `isPatchTest` on the consultation service).
- Prod MSSQL schema is edited for parity; deploy via `pnpm db:prod:deploy` only if/when that legacy target is used.
- Part A ships with no DB/env changes. Live camera is reversible via `ENABLE_LIVE_CAMERA`.

## Self-review (done while writing)
- **Spec coverage:** 漂前 model → A3; 漂後 model → A2; disable camera → A5; photo path → A2–A5; video recolour+playback → A6; gate scope (all Colouring) → B2/B5; ≥48h + 6-month validity → B3; two-layer enforcement → B5/B8; admin mark-completed dependency → B6/B7; schema across 3 files → B1; seed → B2. All covered.
- **Placeholders:** none — the only intentionally-narrative block is the `VideoTryOn` JSX shell, with its load-bearing logic given in full and an explicit implementer note to match the real `HairSegmentation` API.
- **Type consistency:** `BleachState`, `RecolorRequest.bleachState`, `evaluatePatchTestEligibility(tests, colourDate)`, `EligibilityResult`/`reason`, `getValidPatchTest`, `checkColourEligibility`, `updateAppointmentStatus` are used identically wherever they appear.
