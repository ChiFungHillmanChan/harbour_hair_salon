# Virtual Hair Color Try-On — Design Spec

## Overview

A standalone page (`/try-color`) for Harbour Hair Salon that lets users virtually try different hair colors using their device camera or an uploaded photo. Hair segmentation and color overlay run entirely in the browser via MediaPipe, with a reserved interface for future server-side AI enhancement.

## Requirements Summary

- **Page:** `/try-color` — standalone, accessible from main navigation
- **Auth:** No login required to use. Logged-in users can save results to their account.
- **Input:** Live camera feed (primary) + photo upload (secondary)
- **Color selection:** 12-15 preset hair colors + custom color picker + intensity slider
- **Processing:** Browser-side only (MediaPipe Hair Segmentation + Canvas API)
- **Output:** Download result image. Logged-in users can save to account.
- **Future:** Reserved API interface for server-side AI enhancement (not implemented in v1)

## Architecture

### Tech Stack (New Dependencies)

- **@mediapipe/tasks-vision** — Hair segmentation model (runs in browser via WASM/WebGL)
- **Canvas API** — Compositing hair mask with selected color onto camera/photo
- **WebRTC (getUserMedia)** — Camera access for live feed

### Data Flow

```
Camera Feed / Uploaded Photo
  → MediaPipe Image Segmenter (hair category mask)
  → Canvas compositing (soft-light blend: original + hair mask + selected color × intensity)
  → Real-time display on screen
  → User captures → Result image (downloadable / saveable)
```

### New Files

```
src/app/try-color/
  page.tsx                    — Page component (server), metadata, layout
  TryColorClient.tsx          — Main client component orchestrating the feature

src/components/try-color/
  CameraView.tsx              — Camera feed + photo upload + capture controls
  HairSegmentation.ts         — MediaPipe model loading + hair mask generation
  ColorPalette.tsx            — Preset colors + custom picker + intensity slider
  ResultView.tsx              — Result display + download + save actions
  SavedColorsGallery.tsx      — Gallery of saved results (logged-in users)

src/app/actions/try-color.ts  — Server actions: saveResult, getSavedResults, deleteSavedResult
```

### Database Changes

New model in all three Prisma schemas (`dev`, `vercel`, `prod`):

```prisma
model SavedHairColor {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  imageUrl  String   // URL to saved image (stored via Vercel Blob in prod, local file in dev)
  colorHex  String   // The color that was applied (e.g. "#d4a76a")
  colorName String?  // Display name if preset color (e.g. "Honey Blonde")
  intensity Int      // 0-100 intensity value
  createdAt DateTime @default(now())

  @@index([userId])
}
```

**Cross-provider notes:** `@default(cuid())` works across SQLite, PostgreSQL, and MSSQL as Prisma generates the CUID at the client level, not the database. All three schemas use the same model definition. `String` maps to `TEXT` (SQLite), `text` (Postgres), `nvarchar(max)` (MSSQL) — all sufficient for URLs.

Add relation to User model:
```prisma
model User {
  // ... existing fields
  savedHairColors SavedHairColor[]
}
```

### Middleware

No changes needed — `/try-color` is a public page. Save actions check session server-side.

## UI Design

### Step 1: Landing

- Page title: "Virtual Hair Color Try-On"
- Two CTA buttons: "Open Camera" (primary) / "Upload Photo" (secondary)
- Privacy notice: "Your photos are processed entirely on your device"

### Step 2: Main Interface (Mobile-First)

**Top section — Camera/Photo view:**
- Live camera feed with flip (front/back) button
- Capture button to freeze frame
- Or uploaded photo display

**Bottom section — Color controls:**
- **Preset colors** (12 swatches in a row, scrollable):
  - Natural Black, Dark Brown, Medium Brown, Light Brown, Honey Blonde, Platinum Blonde, Deep Red, Auburn, Silver Grey, Rose Pink, Purple, Blue
- **Custom color** — color picker (rainbow circle swatch opens native picker)
- **Intensity slider** — 0% (subtle tint) to 100% (full coverage)
- Active color name + hex displayed

### Step 3: Live Preview

- Camera feed with real-time hair color overlay
- "LIVE" indicator badge
- Current color info bar (color swatch + name + intensity)
- "Capture Result" button to freeze and generate final image

### Step 4: Result

- Full result image display
- **Download** button — saves PNG to device
- **Save** button — stores to account (logged-in users only)
- "Try Another Color" link — returns to Step 2
- Login prompt for non-authenticated users wanting to save

### Saved Colors Gallery (Logged-in Users)

- Accessible from the result page or via a "My Saved Colors" tab
- Grid of saved results with color info
- Delete individual saved results

## Component Details

### CameraView.tsx

- Uses `navigator.mediaDevices.getUserMedia` for camera access
- Supports front/back camera toggle on mobile
- Fallback to photo upload if camera access denied
- Renders to a `<video>` element, mirrored for front camera
- Capture freezes current frame to `<canvas>`

### HairSegmentation.ts

- Loads MediaPipe Image Segmenter with "hair" category
- Processes each video frame (requestAnimationFrame loop)
- Returns a binary mask (Uint8Array) of hair pixels
- Targets ~30fps on modern devices, degrades gracefully on older hardware
- Model loaded once on component mount, disposed on unmount

### Color Compositing Algorithm

1. For each pixel where hair mask confidence > 0.5:
   - Use Canvas `soft-light` blend mode to overlay selected color onto original hair
   - `intensity` (0-100) maps to overlay opacity: `intensity / 100`
   - At 0% intensity: no visible change. At 100%: full soft-light blend.
2. Apply 2px Gaussian blur to mask edges to avoid hard cutoff artifacts
3. Composite: draw original frame → set `globalCompositeOperation = 'soft-light'` → draw color layer (clipped to hair mask) at `globalAlpha = intensity/100`

### ColorPalette.tsx

- Preset colors as an array of `{ name, hex }` objects
- Custom color uses `<input type="color">`
- Intensity slider: `<input type="range" min="0" max="100">`
- Callbacks: `onColorChange(hex, name?)`, `onIntensityChange(value)`

### ResultView.tsx

- Displays composited canvas as an `<img>` (toDataURL)
- Download: creates a temporary `<a>` with blob URL
- Save: converts canvas to Blob, uploads via server action to Vercel Blob (prod) or local `/public/uploads` (dev), stores returned URL in DB
- Shows login prompt if not authenticated

## Server Actions (src/app/actions/try-color.ts)

```typescript
'use server'

async function saveHairColorResult(formData: FormData): Promise<ActionResult>
// Requires auth. Receives image as Blob via FormData.
// Uploads to Vercel Blob (prod) or saves to public/uploads (dev).
// Stores returned URL + colorHex, colorName, intensity in SavedHairColor.
// Limit: max 20 saved results per user (delete oldest + its blob if exceeded).

async function getSavedResults(): Promise<SavedHairColor[]>
// Requires auth. Returns all saved results for current user, newest first.

async function deleteSavedResult(id: string): Promise<ActionResult>
// Requires auth. Deletes saved result owned by current user + removes blob.
```

## Image Storage

- **Production (Vercel):** Use `@vercel/blob` to store result images. Free tier includes 256MB, sufficient for early usage. Each image ~50-200KB (compressed JPEG).
- **Development (local):** Save to `public/uploads/try-color/` directory.
- **Limit:** Max 20 saved images per user. When exceeded, delete oldest result and its blob.
- **Cleanup:** `deleteSavedResult` removes both the DB record and the blob.

## Performance Considerations

- **Model loading:** MediaPipe WASM model is ~4MB. Show loading spinner on first load. Cache via browser's standard caching.
- **Frame rate:** Target 30fps. Measure frame delta via `requestAnimationFrame` timestamps. If average frame time exceeds 50ms over 10 frames, auto-reduce to processing every 2nd frame (~15fps).
- **Mobile:** Primary use case. Design is mobile-first. Camera view takes most of screen.
- **Uploaded photos:** Resize to max 1280px on longest side before processing to prevent memory issues on mobile.

## Privacy

- All image processing happens in the browser — no photos leave the user's device during try-on.
- Saved results (logged-in users only) upload the final result image to Vercel Blob — this is the only time image data touches the server.
- Privacy notice displayed on landing page.

## Future: API Enhancement (Not in v1)

Reserved interface in `HairSegmentation.ts`:

```typescript
interface HairColorProcessor {
  processFrame(frame: ImageData): Promise<ImageData>  // real-time (browser)
  generateHighQuality(image: Blob, color: string, intensity: number): Promise<Blob>  // API
}
```

When ready to add API support:
1. Add API route `/api/try-color/enhance`
2. Implement `generateHighQuality` using Replicate/Stability AI
3. Add "Enhance" button in ResultView that calls the API
4. Cost: ~$0.01-0.05 per API call

## Navigation

- Add "Try Color" link to main navigation header
- Mobile nav: add to menu overlay
- Optional: CTA button on Services page under "Colouring" category

## Error Handling

- **Camera denied:** Show upload-only mode with message
- **Browser not supported (no MediaPipe):** Show message suggesting Chrome/Safari/Edge
- **Model loading failed:** Retry button + fallback message
- **Save failed:** Toast notification with retry

## Testing Strategy

- Unit tests for color compositing logic
- Component tests for CameraView (mock getUserMedia)
- E2E test for upload photo → select color → download flow
- Manual testing on mobile devices (iOS Safari, Android Chrome)
