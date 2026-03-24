# Virtual Hair Color Try-On — Design Spec

## Overview

A standalone page (`/try-color`) for Harbour Hair Salon that lets users preview different hair color looks in real time using their device camera. The camera opens, detects the user's hair, and applies the selected color live — hair shape stays the same, only the color changes. Photo upload is available as a fallback for devices without a camera. Hair segmentation and recoloring run entirely in the browser via MediaPipe.

V1 is explicitly a best-effort preview, not a photorealistic bleaching simulator. The product promise is "help users explore colour direction" rather than "show an exact salon outcome".

## Requirements Summary

- **Page:** `/try-color` — standalone, accessible from main navigation
- **Auth:** No login required. Entirely public.
- **Primary experience:** Live camera feed with real-time hair color overlay. User opens camera, sees their face/hair, picks a color, and sees it applied instantly on the live feed.
- **Fallback:** Photo upload for devices without camera access (desktop without webcam, camera permission denied)
- **Color selection:** 12 preset hair colors + custom color picker + intensity slider
- **Processing:** Browser-side only (`@mediapipe/tasks-vision` + Canvas API)
- **Output:** Download final result as compressed JPEG
- **Accuracy:** Show an on-page disclaimer that the preview is approximate, especially for very light or fantasy shades on dark hair

## V1 Scope Decisions

- **Primary path:** live camera with real-time hair color overlay
- **Fallback path:** photo upload and captured still frame preview
- **Out of scope for v1:** saving results to account, server-side processing, exact bleach simulation, strand-level editing, multi-person photos, hairstyle changes

## Architecture

### Tech Stack (New Dependencies)

- **@mediapipe/tasks-vision** — Hair segmentation model in browser via WASM/WebGL
- **Canvas API / OffscreenCanvas** — Mask compositing and recoloring
- **Web Worker** — Run segmentation work off the main thread when live mode is enabled
- **WebRTC (`getUserMedia`)** — Camera access

### Data Flow

```text
Primary (live camera):
  Camera frame (continuous)
    → Worker: MediaPipe hair segmentation
    → Worker: Apply recolor to masked region
    → Transfer result to main thread
    → Render composited frame to preview canvas
    → Repeat at 10-15fps

Fallback (uploaded photo):
  Uploaded photo
    → Normalize and resize client-side
    → Main-thread: MediaPipe hair segmentation
    → Main-thread: Higher-quality recolor pass
    → Render to preview canvas

Download:
  Current preview canvas → canvas.toBlob('image/jpeg') → download
```

### New Files

```text
src/app/try-color/
  page.tsx                       — Server page with metadata
  TryColorClient.tsx             — Main client orchestrator

src/components/try-color/
  CameraView.tsx                 — Camera feed, device flip, capture controls
  UploadDropzone.tsx             — Upload flow and image validation
  PreviewCanvas.tsx              — Main preview surface and mode state
  HairSegmentation.ts            — MediaPipe loader and still-image segmentation helpers
  segmentation.worker.ts         — Worker-based live segmentation loop
  colorMath.ts                   — Recolor utilities for preview/final rendering
  ColorPalette.tsx               — Presets, custom picker, intensity slider
  ResultActions.tsx              — Download button and "Try Another Color" action
```

### Existing Files to Update

- `src/components/layout/Header.tsx` — add desktop nav link
- `src/components/layout/MobileMenuOverlay.tsx` — add mobile nav link

### Database Changes

None. V1 is entirely client-side.

### Middleware

No middleware changes. `/try-color` is a public page.

## UI Design

### Step 1: Landing

- Page title: "Virtual Hair Color Try-On"
- Supporting line: "See how a new colour looks on you — live"
- Primary CTA: "Open Camera" / Secondary: "Upload Photo"
- Privacy notice: "Your photos are processed entirely on your device and never leave your browser"
- Accuracy notice: "Preview only. Very light shades may look different in salon."

### Step 2: Live Camera Interface (Primary — Mobile-First)

**Top section — Live camera feed with real-time color overlay**

- Camera opens and immediately begins segmenting hair
- Color overlay applies in real time as user picks colors
- Flip button (front/back camera) on mobile
- `LIVE` badge visible while active
- MediaPipe loading spinner shown while model initializes

**Bottom section — Color controls (always visible alongside camera)**

- **Preset colors** (12 swatches in a scroll row):
  - Natural Black, Dark Brown, Medium Brown, Light Brown
  - Honey Blonde, Platinum Blonde
  - Deep Red, Auburn
  - Silver Grey, Rose Pink, Purple, Blue
- **Custom color** — native `<input type="color">`
- **Intensity slider** — 0% to 100%
- Active color name + hex displayed
- Changing color or intensity updates the live overlay immediately

### Step 2b: Upload Fallback

- Available when camera is unavailable or denied
- Upload a photo, see color applied as a still preview
- Same color controls as live mode

### Step 3: Download

- **Download** button — captures current frame as compressed JPEG
- "Try Another Color" — continues live feed / returns to editing
- No separate "result" page needed — the live feed IS the preview

## Component Details

### CameraView.tsx

- Uses `navigator.mediaDevices.getUserMedia` for camera access
- Supports front/back camera toggle on mobile
- Falls back to upload mode if camera access is denied
- Renders to a `<video>` element, mirrored for front camera preview only
- Capturing freezes the current frame to a canvas and hands control to still-image processing

### UploadDropzone.tsx

- Accepts common image types (`image/jpeg`, `image/png`, `image/webp`)
- Rejects files above a client-side size limit before processing
- Resizes image client-side to a max 1024px longest side before segmentation
- Normalizes EXIF orientation during decode

### HairSegmentation.ts

- Loads MediaPipe Hair Segmenter once
- Provides `segmentStill(imageBitmap | canvas | image)` for uploaded/captured stills
- Provides shared model lifecycle helpers for the worker path
- Still-image segmentation can run on main thread because it is explicit user-triggered work, not continuous animation

### segmentation.worker.ts

- Owns the primary live segmentation + recolor loop
- Processes at most one frame at a time
- Drops stale frames instead of queueing them
- Targets 10-15fps, not 30fps
- Auto-falls back to upload mode if average segmentation time is too slow

### Recolor Pipeline

Two rendering paths are required:

1. **Fast preview pass**
   - Used for live mode
   - Apply masked tint using Canvas compositing with softened mask edges
   - Optimized for responsiveness, not maximum realism

2. **Higher-quality still pass**
   - Used for uploaded photos and captured final result generation
   - Preserve original hair texture and luminance while interpolating hue/saturation toward the target color
   - Lightness lift must be conservative to avoid fake bleach artifacts
   - For extremely light shades on dark hair, show a note that the preview is approximate

### ColorPalette.tsx

- Presets stored as `{ name, hex }[]`
- Custom color uses `<input type="color">`
- Intensity slider uses `<input type="range" min="0" max="100">`
- Callbacks:
  - `onColorChange(hex, name?)`
  - `onIntensityChange(value)`

### ResultActions.tsx

- Download uses `canvas.toBlob('image/jpeg', 0.9)`
- "Try Another Color" resets to editing state with current image retained

## Performance Considerations

- **Model loading:** MediaPipe WASM/model payload is a noticeable first-load cost. Show a loading state and cache normally via the browser.
- **Live preview target:** 10-15fps on supported devices. Do not promise 30fps.
- **Frame scheduling:** use `requestVideoFrameCallback` when available, otherwise `requestAnimationFrame`
- **Back-pressure:** only one in-flight segmentation job at a time
- **Fallback trigger:** if segmentation time stays above ~80ms average over recent frames, disable live mode and prompt user to capture/upload instead
- **Mobile-first:** preview area should dominate the viewport
- **Still-image resize:** max 1024px longest side before processing

## Privacy

- All processing stays in the browser. No images are sent to any server.
- Privacy notice must be visible before camera/upload begins

## Future Enhancements (Not in v1)

- Save results to user account (requires database model, server actions, blob storage)
- Server-side AI enhancement via API route
- Saved colors gallery for authenticated users

## Navigation

- Add `Try Color` to desktop header nav
- Add `Try Color` to mobile overlay nav
- Optional CTA on Services page near colouring services

## Error Handling

- **Camera denied:** show upload-first mode with explanation
- **Browser unsupported:** show upload-only mode or unsupported message
- **Model loading failed:** retry button and fallback copy
- **Low-performance device:** disable live mode and guide user to still-image flow

## Testing Strategy

- Unit tests for `colorMath` utility functions
- Component tests for upload mode flow
- Component or integration tests for camera mode with mocked `getUserMedia`
- E2E test for upload photo → choose color → generate preview → download flow
- Manual QA on iOS Safari and Android Chrome

## Acceptance Criteria

- Users can open `/try-color`, start camera, and see hair color change in real time as they pick different colors
- Color changes are visible immediately on the live feed — no "generate" step needed
- Photo upload works as fallback when camera is unavailable
- Users can download the current preview as a JPEG
- On slower devices, the UI falls back cleanly from live mode to upload mode
- Navigation exposes the page on both desktop and mobile
- No server-side processing or data storage in v1
