# Virtual Hair Color Try-On Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/try-color` page where users open their camera and see hair color changes applied in real time via browser-based MediaPipe segmentation.

**Architecture:** Purely client-side feature. MediaPipe `ImageSegmenter` runs in a Web Worker for the live camera loop (10-15fps). Camera frames go to the worker, get segmented + recolored, and the composited result is rendered to a canvas overlaying the video. Photo upload is the fallback path. No backend, database, or auth changes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, `@mediapipe/tasks-vision` (hair segmentation), Canvas API, Web Workers, WebRTC (`getUserMedia`)

**Spec:** `docs/superpowers/specs/2026-03-23-virtual-hair-color-tryon-design.md`

---

## File Structure

```text
New files:
  src/app/try-color/page.tsx                    — Server page (metadata only)
  src/app/try-color/TryColorClient.tsx          — Client orchestrator (state machine, wires components)
  src/components/try-color/CameraView.tsx       — Camera access, video element, flip, frame capture
  src/components/try-color/UploadDropzone.tsx    — Photo upload fallback with resize
  src/components/try-color/PreviewCanvas.tsx     — Canvas that renders composited frames
  src/components/try-color/ColorPalette.tsx      — 12 presets + custom picker + intensity slider
  src/components/try-color/ResultActions.tsx     — Download button
  src/components/try-color/HairSegmentation.ts   — MediaPipe loader, segmentStill() for upload path
  src/components/try-color/segmentation.worker.ts — Web Worker: live segmentation + recolor loop
  src/components/try-color/colorMath.ts          — RGB/HSL conversion, recolor pixel math
  src/components/try-color/constants.ts          — Preset colors, MediaPipe config

Modified files:
  src/components/layout/Header.tsx:22            — Add "Try Color" desktop nav link after Contact
  src/components/layout/MobileMenuOverlay.tsx:82 — Add "Try Color" mobile nav link after Contact
```

---

### Task 1: Project Setup

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @mediapipe/tasks-vision**

```bash
pnpm add @mediapipe/tasks-vision
```

- [ ] **Step 2: Verify build still passes**

```bash
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @mediapipe/tasks-vision dependency"
```

---

### Task 2: Color Constants and Math Utilities

**Files:**
- Create: `src/components/try-color/constants.ts`
- Create: `src/components/try-color/colorMath.ts`

- [ ] **Step 1: Create constants.ts with preset colors**

```typescript
// src/components/try-color/constants.ts

export interface PresetColor {
  name: string;
  hex: string;
}

export const PRESET_COLORS: PresetColor[] = [
  { name: 'Natural Black', hex: '#1a1a1a' },
  { name: 'Dark Brown', hex: '#3b2314' },
  { name: 'Medium Brown', hex: '#6b4226' },
  { name: 'Light Brown', hex: '#a0764a' },
  { name: 'Honey Blonde', hex: '#d4a76a' },
  { name: 'Platinum Blonde', hex: '#e8dcc8' },
  { name: 'Deep Red', hex: '#8b1a1a' },
  { name: 'Auburn', hex: '#a0522d' },
  { name: 'Silver Grey', hex: '#b0b0b0' },
  { name: 'Rose Pink', hex: '#e8a0bf' },
  { name: 'Purple', hex: '#6a0dad' },
  { name: 'Blue', hex: '#2563eb' },
];

export const DEFAULT_INTENSITY = 70;

export const MEDIAPIPE_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

// Hair is category 1 in the selfie_multiclass model
export const HAIR_CATEGORY_INDEX = 1;

export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

export const LIVE_TARGET_FPS = 12;
export const SLOW_FRAME_THRESHOLD_MS = 80;
export const SLOW_FRAME_WINDOW = 10;
```

- [ ] **Step 2: Create colorMath.ts with recolor utilities**

```typescript
// src/components/try-color/colorMath.ts

/** Parse "#rrggbb" to [r, g, b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** RGB (0-255) → HSL (h: 0-360, s: 0-1, l: 0-1). */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** HSL (h: 0-360, s: 0-1, l: 0-1) → RGB (0-255). */
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Recolor a single pixel: keep original luminance, shift hue/saturation
 * toward the target color by the given intensity (0-100).
 */
export function recolorPixel(
  r: number,
  g: number,
  b: number,
  targetH: number,
  targetS: number,
  intensity: number,
): [number, number, number] {
  const t = intensity / 100;
  const [origH, origS, origL] = rgbToHsl(r, g, b);
  const newH = origH + (targetH - origH) * t;
  const newS = origS + (targetS - origS) * t;
  // Conservative lightness lift — shift at most 30% toward target to avoid fake bleach
  return hslToRgb(newH, newS, origL);
}

/**
 * Apply recolor to an ImageData using a Uint8Array category mask.
 * Modifies imageData pixels in-place. hairCategory is the mask value
 * that indicates hair pixels.
 */
export function applyRecolorToImageData(
  imageData: ImageData,
  maskData: Uint8Array,
  targetHex: string,
  intensity: number,
  hairCategory: number,
): void {
  const [tR, tG, tB] = hexToRgb(targetHex);
  const [targetH, targetS] = rgbToHsl(tR, tG, tB);
  const pixels = imageData.data;
  for (let i = 0; i < maskData.length; i++) {
    if (maskData[i] !== hairCategory) continue;
    const idx = i * 4;
    const [nr, ng, nb] = recolorPixel(
      pixels[idx],
      pixels[idx + 1],
      pixels[idx + 2],
      targetH,
      targetS,
      intensity,
    );
    pixels[idx] = nr;
    pixels[idx + 1] = ng;
    pixels[idx + 2] = nb;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/try-color/constants.ts src/components/try-color/colorMath.ts
git commit -m "feat(try-color): add color constants and recolor math utilities"
```

---

### Task 3: MediaPipe Hair Segmentation Wrapper

**Files:**
- Create: `src/components/try-color/HairSegmentation.ts`

This module provides a singleton loader for the MediaPipe `ImageSegmenter` and a `segmentStill()` helper for the upload fallback path (runs on main thread).

- [ ] **Step 1: Create HairSegmentation.ts**

```typescript
// src/components/try-color/HairSegmentation.ts

import {
  ImageSegmenter,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_CDN, SEGMENTER_MODEL_URL } from './constants';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

/**
 * Create and cache a single ImageSegmenter instance.
 * Calling this multiple times returns the same promise.
 */
export function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL },
        outputCategoryMask: true,
        outputConfidenceMasks: false,
        runningMode: 'IMAGE',
      });
    })();
  }
  return segmenterPromise;
}

/**
 * Run segmentation on a single still image (for the upload fallback path).
 * Returns the category mask as a Uint8Array (one byte per pixel).
 */
export async function segmentStill(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<Uint8Array> {
  const segmenter = await getSegmenter();
  const result = segmenter.segment(image);
  const mask = result.categoryMask;
  if (!mask) throw new Error('Segmentation returned no category mask');
  // Copy the mask data before MediaPipe reclaims the buffer
  const data = new Uint8Array(mask.getAsUint8Array());
  result.close();
  return data;
}

/**
 * Create a fresh segmenter in VIDEO mode for the worker path.
 * Does NOT use the singleton — the worker owns its own instance.
 */
export async function createVideoSegmenter(): Promise<ImageSegmenter> {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
  return ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: 'VIDEO',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/HairSegmentation.ts
git commit -m "feat(try-color): add MediaPipe hair segmentation wrapper"
```

---

### Task 4: Segmentation Web Worker

**Files:**
- Create: `src/components/try-color/segmentation.worker.ts`

The worker owns the live segmentation loop. It receives video frames as `ImageBitmap`, runs segmentation + recolor, and sends back the composited `ImageBitmap`.

- [ ] **Step 1: Create segmentation.worker.ts**

```typescript
// src/components/try-color/segmentation.worker.ts

import {
  ImageSegmenter,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import {
  MEDIAPIPE_WASM_CDN,
  SEGMENTER_MODEL_URL,
  HAIR_CATEGORY_INDEX,
} from './constants';
import { applyRecolorToImageData } from './colorMath';

let segmenter: ImageSegmenter | null = null;
let busy = false;

async function init() {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: 'VIDEO',
  });
  self.postMessage({ type: 'ready' });
}

function processFrame(
  frame: ImageBitmap,
  colorHex: string,
  intensity: number,
  timestamp: number,
) {
  if (!segmenter || busy) {
    frame.close();
    return;
  }

  busy = true;
  const start = performance.now();

  try {
    // Draw frame to offscreen canvas for pixel access
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(frame, 0, 0);
    frame.close();

    // Run segmentation
    const result = segmenter.segmentForVideo(canvas, timestamp);
    const mask = result.categoryMask;
    if (!mask) {
      result.close();
      busy = false;
      return;
    }

    const maskData = new Uint8Array(mask.getAsUint8Array());
    result.close();

    // Apply recolor
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyRecolorToImageData(
      imageData,
      maskData,
      colorHex,
      intensity,
      HAIR_CATEGORY_INDEX,
    );
    ctx.putImageData(imageData, 0, 0);

    // Transfer result back as ImageBitmap
    const resultBitmap = canvas.transferToImageBitmap();
    const elapsed = performance.now() - start;

    self.postMessage(
      { type: 'frame', bitmap: resultBitmap, elapsed },
      // @ts-expect-error transferable
      [resultBitmap],
    );
  } catch (err) {
    console.error('Worker segmentation error:', err);
  } finally {
    busy = false;
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;
  if (type === 'init') {
    init();
  } else if (type === 'segment') {
    const { frame, colorHex, intensity, timestamp } = e.data;
    processFrame(frame, colorHex, intensity, timestamp);
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/segmentation.worker.ts
git commit -m "feat(try-color): add web worker for live hair segmentation loop"
```

---

### Task 5: Color Palette Component

**Files:**
- Create: `src/components/try-color/ColorPalette.tsx`

- [ ] **Step 1: Create ColorPalette.tsx**

```tsx
// src/components/try-color/ColorPalette.tsx
'use client';

import { PRESET_COLORS, type PresetColor } from './constants';

interface ColorPaletteProps {
  selectedHex: string;
  selectedName: string | null;
  intensity: number;
  onColorChange: (hex: string, name: string | null) => void;
  onIntensityChange: (value: number) => void;
}

export function ColorPalette({
  selectedHex,
  selectedName,
  intensity,
  onColorChange,
  onIntensityChange,
}: ColorPaletteProps) {
  return (
    <div className="space-y-4">
      {/* Active color display */}
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <div
          className="w-6 h-6 rounded-full border border-zinc-600"
          style={{ backgroundColor: selectedHex }}
        />
        <span className="font-medium text-white">
          {selectedName ?? 'Custom'}
        </span>
        <span className="text-zinc-500">{selectedHex}</span>
        <span className="ml-auto">{intensity}%</span>
      </div>

      {/* Preset swatches */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {PRESET_COLORS.map((color: PresetColor) => (
          <button
            key={color.hex}
            onClick={() => onColorChange(color.hex, color.name)}
            className={`flex-shrink-0 w-10 h-10 rounded-full border-2 transition-all duration-200 ${
              selectedHex === color.hex
                ? 'border-white scale-110'
                : 'border-zinc-700 hover:border-zinc-500'
            }`}
            style={{ backgroundColor: color.hex }}
            title={color.name}
            aria-label={color.name}
          />
        ))}
        {/* Custom color picker */}
        <label
          className={`flex-shrink-0 w-10 h-10 rounded-full border-2 border-dashed cursor-pointer flex items-center justify-center transition-all duration-200 ${
            !PRESET_COLORS.some((c) => c.hex === selectedHex)
              ? 'border-white scale-110'
              : 'border-zinc-700 hover:border-zinc-500'
          }`}
          title="Custom color"
        >
          <input
            type="color"
            value={selectedHex}
            onChange={(e) => onColorChange(e.target.value, null)}
            className="sr-only"
          />
          <svg
            className="w-5 h-5 text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
        </label>
      </div>

      {/* Intensity slider */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider w-16">
          Intensity
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={intensity}
          onChange={(e) => onIntensityChange(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/ColorPalette.tsx
git commit -m "feat(try-color): add color palette with presets, custom picker, intensity slider"
```

---

### Task 6: Camera View Component

**Files:**
- Create: `src/components/try-color/CameraView.tsx`

Handles `getUserMedia`, front/back camera flip, and provides video frames to the parent via callback.

- [ ] **Step 1: Create CameraView.tsx**

```tsx
// src/components/try-color/CameraView.tsx
'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface CameraViewProps {
  onFrame: (video: HTMLVideoElement) => void;
  onError: (error: string) => void;
  active: boolean;
}

export function CameraView({ onFrame, onError, active }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const startCamera = useCallback(async () => {
    try {
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      onError(
        'Camera access was denied. You can upload a photo instead.',
      );
    }
  }, [facingMode, onError]);

  // Start/stop camera based on active prop
  useEffect(() => {
    if (!active) return;
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [active, startCamera]);

  // Frame capture loop — prefer requestVideoFrameCallback for efficiency
  useEffect(() => {
    if (!active) return;

    const video = videoRef.current;
    if (!video) return;

    // requestVideoFrameCallback fires once per decoded video frame,
    // avoiding duplicate processing. Fall back to rAF if unavailable.
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const onVideoFrame = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          onFrame(video);
        }
        rafRef.current = video.requestVideoFrameCallback(onVideoFrame);
      };
      rafRef.current = video.requestVideoFrameCallback(onVideoFrame);
      return () => video.cancelVideoFrameCallback(rafRef.current);
    }

    const captureLoop = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        onFrame(video);
      }
      rafRef.current = requestAnimationFrame(captureLoop);
    };
    rafRef.current = requestAnimationFrame(captureLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, onFrame]);

  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  return (
    <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        playsInline
        muted
        autoPlay
      />

      {/* Flip camera button */}
      <button
        onClick={flipCamera}
        className="absolute top-3 right-3 bg-black/60 text-white p-2 rounded-full hover:bg-black/80 transition-colors"
        aria-label="Flip camera"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>

      {/* LIVE badge */}
      <div className="absolute top-3 left-3 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
        LIVE
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/CameraView.tsx
git commit -m "feat(try-color): add camera view with getUserMedia and flip support"
```

---

### Task 7: Upload Dropzone Component

**Files:**
- Create: `src/components/try-color/UploadDropzone.tsx`

Fallback for devices without camera. Accepts image files, resizes to max 1024px, and provides the loaded image to the parent.

- [ ] **Step 1: Create UploadDropzone.tsx**

```tsx
// src/components/try-color/UploadDropzone.tsx
'use client';

import { useRef, useState } from 'react';

interface UploadDropzoneProps {
  onImageLoaded: (image: HTMLImageElement) => void;
}

const MAX_SIZE = 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function resizeImage(img: HTMLImageElement): HTMLCanvasElement {
  let { width, height } = img;
  if (width > MAX_SIZE || height > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

export function UploadDropzone({ onImageLoaded }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = (file: File) => {
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File is too large. Please use an image under 10MB.');
      return;
    }

    const img = new Image();
    img.onload = () => {
      const resized = resizeImage(img);
      // Create a new image from the resized canvas
      const resizedImg = new Image();
      resizedImg.onload = () => onImageLoaded(resizedImg);
      resizedImg.src = resized.toDataURL('image/jpeg', 0.9);
    };
    img.onerror = () => setError('Could not read this image. Try another file.');
    img.src = URL.createObjectURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  return (
    <div
      className={`w-full aspect-[4/3] border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer ${
        dragging
          ? 'border-[var(--accent)] bg-zinc-800/50'
          : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <svg
        className="w-12 h-12 text-zinc-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
        />
      </svg>
      <p className="text-zinc-400 text-sm">
        Drop a photo here or <span className="text-[var(--accent)]">browse</span>
      </p>
      <p className="text-zinc-600 text-xs">JPEG, PNG, or WebP up to 10MB</p>

      {error && (
        <p className="text-red-400 text-sm mt-2">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
        }}
        className="hidden"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/UploadDropzone.tsx
git commit -m "feat(try-color): add photo upload dropzone with resize and validation"
```

---

### Task 8: Preview Canvas Component

**Files:**
- Create: `src/components/try-color/PreviewCanvas.tsx`

Renders composited frames from the worker (live mode) or from the main-thread recolor (upload mode). Also handles the download action.

- [ ] **Step 1: Create PreviewCanvas.tsx**

```tsx
// src/components/try-color/PreviewCanvas.tsx
'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

export interface PreviewCanvasHandle {
  drawBitmap: (bitmap: ImageBitmap) => void;
  drawImageData: (data: ImageData, width: number, height: number) => void;
  downloadJpeg: () => void;
  getCanvas: () => HTMLCanvasElement | null;
}

interface PreviewCanvasProps {
  width: number;
  height: number;
  mirrored?: boolean;
}

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(
  function PreviewCanvas({ width, height, mirrored = false }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Resize canvas when dimensions change
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
    }, [width, height]);

    useImperativeHandle(ref, () => ({
      drawBitmap(bitmap: ImageBitmap) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        if (mirrored) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(bitmap, -canvas.width, 0, canvas.width, canvas.height);
          ctx.restore();
        } else {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        }
        bitmap.close();
      },

      drawImageData(data: ImageData, w: number, h: number) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(data, 0, 0);
      },

      downloadJpeg() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.toBlob(
          (blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hair-color-preview-${Date.now()}.jpg`;
            a.click();
            URL.revokeObjectURL(url);
          },
          'image/jpeg',
          0.9,
        );
      },

      getCanvas() {
        return canvasRef.current;
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full object-cover rounded-lg"
      />
    );
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/PreviewCanvas.tsx
git commit -m "feat(try-color): add preview canvas with bitmap rendering and JPEG download"
```

---

### Task 9: Result Actions Component

**Files:**
- Create: `src/components/try-color/ResultActions.tsx`

- [ ] **Step 1: Create ResultActions.tsx**

```tsx
// src/components/try-color/ResultActions.tsx
'use client';

interface ResultActionsProps {
  onDownload: () => void;
}

export function ResultActions({ onDownload }: ResultActionsProps) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onDownload}
        className="flex-1 bg-[var(--accent)] text-black py-3 text-sm uppercase tracking-[0.15em] font-bold hover:bg-[var(--accent-light)] transition-colors duration-300 rounded-lg flex items-center justify-center gap-2"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Download
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/try-color/ResultActions.tsx
git commit -m "feat(try-color): add download result actions component"
```

---

### Task 10: Main Client Orchestrator

**Files:**
- Create: `src/app/try-color/TryColorClient.tsx`

This is the central component that wires everything together: manages state machine (landing → camera/upload → previewing), owns the worker, passes frames, and coordinates color changes.

- [ ] **Step 1: Create TryColorClient.tsx**

```tsx
// src/app/try-color/TryColorClient.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { CameraView } from '@/components/try-color/CameraView';
import { UploadDropzone } from '@/components/try-color/UploadDropzone';
import {
  PreviewCanvas,
  type PreviewCanvasHandle,
} from '@/components/try-color/PreviewCanvas';
import { ColorPalette } from '@/components/try-color/ColorPalette';
import { ResultActions } from '@/components/try-color/ResultActions';
import { segmentStill } from '@/components/try-color/HairSegmentation';
import { applyRecolorToImageData } from '@/components/try-color/colorMath';
import {
  PRESET_COLORS,
  DEFAULT_INTENSITY,
  HAIR_CATEGORY_INDEX,
  SLOW_FRAME_THRESHOLD_MS,
  SLOW_FRAME_WINDOW,
} from '@/components/try-color/constants';

type Mode = 'landing' | 'camera' | 'upload';

export default function TryColorClient() {
  const [mode, setMode] = useState<Mode>('landing');
  const [colorHex, setColorHex] = useState(PRESET_COLORS[3].hex);
  const [colorName, setColorName] = useState<string | null>(PRESET_COLORS[3].name);
  const [intensity, setIntensity] = useState(DEFAULT_INTENSITY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });

  const previewRef = useRef<PreviewCanvasHandle>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorRef = useRef({ hex: colorHex, intensity });
  const frameTimesRef = useRef<number[]>([]);

  // Upload mode: store original image data and mask for re-coloring on color change
  const uploadDataRef = useRef<{
    originalImageData: ImageData;
    mask: Uint8Array;
    width: number;
    height: number;
  } | null>(null);

  // Keep refs in sync with state for the frame callback
  useEffect(() => {
    colorRef.current = { hex: colorHex, intensity };
  }, [colorHex, intensity]);

  // Initialize worker
  const initWorker = useCallback(() => {
    if (workerRef.current) return;

    setLoading(true);
    const worker = new Worker(
      new URL(
        '../../components/try-color/segmentation.worker.ts',
        import.meta.url,
      ),
    );

    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      if (type === 'ready') {
        setWorkerReady(true);
        setLoading(false);
      } else if (type === 'frame') {
        const { bitmap, elapsed } = e.data;
        previewRef.current?.drawBitmap(bitmap);

        // Track frame times for performance fallback
        const times = frameTimesRef.current;
        times.push(elapsed);
        if (times.length > SLOW_FRAME_WINDOW) times.shift();
        if (times.length === SLOW_FRAME_WINDOW) {
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          if (avg > SLOW_FRAME_THRESHOLD_MS) {
            setError(
              'Live preview is too slow on this device. Try uploading a photo instead.',
            );
            setMode('upload');
            worker.terminate();
            workerRef.current = null;
          }
        }
      }
    };

    worker.postMessage({ type: 'init' });
    workerRef.current = worker;
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Handle camera frame — send to worker
  const handleFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!workerRef.current || !workerReady) return;

      // Update dimensions on first frame
      if (
        video.videoWidth !== dimensions.width ||
        video.videoHeight !== dimensions.height
      ) {
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      // Capture frame as ImageBitmap and send to worker
      createImageBitmap(video).then((bitmap) => {
        const { hex, intensity: int } = colorRef.current;
        workerRef.current?.postMessage(
          {
            type: 'segment',
            frame: bitmap,
            colorHex: hex,
            intensity: int,
            timestamp: performance.now(),
          },
          [bitmap],
        );
      });
    },
    [workerReady, dimensions.width, dimensions.height],
  );

  // Handle uploaded image — main-thread segmentation (stores mask for re-coloring)
  const handleImageLoaded = useCallback(
    async (img: HTMLImageElement) => {
      setLoading(true);
      setError(null);
      try {
        const maskData = await segmentStill(img);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const originalImageData = ctx.getImageData(0, 0, img.width, img.height);

        // Store originals for re-coloring when user changes color/intensity
        uploadDataRef.current = {
          originalImageData,
          mask: maskData,
          width: img.width,
          height: img.height,
        };

        // Apply initial color
        const coloredData = new ImageData(
          new Uint8ClampedArray(originalImageData.data),
          img.width,
          img.height,
        );
        applyRecolorToImageData(
          coloredData,
          maskData,
          colorHex,
          intensity,
          HAIR_CATEGORY_INDEX,
        );

        setDimensions({ width: img.width, height: img.height });
        previewRef.current?.drawImageData(coloredData, img.width, img.height);
      } catch (err) {
        setError(
          'Could not process this image. Try a different photo.',
        );
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [colorHex, intensity],
  );

  // Re-apply color to upload preview when color or intensity changes
  useEffect(() => {
    if (mode !== 'upload' || !uploadDataRef.current) return;
    const { originalImageData, mask, width, height } = uploadDataRef.current;
    const coloredData = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      width,
      height,
    );
    applyRecolorToImageData(coloredData, mask, colorHex, intensity, HAIR_CATEGORY_INDEX);
    previewRef.current?.drawImageData(coloredData, width, height);
  }, [colorHex, intensity, mode]);

  const startCamera = () => {
    setError(null);
    setMode('camera');
    initWorker();
  };

  const startUpload = () => {
    setError(null);
    setMode('upload');
  };

  const handleColorChange = (hex: string, name: string | null) => {
    setColorHex(hex);
    setColorName(name);
  };

  // Landing page
  if (mode === 'landing') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
        <div className="w-12 h-[2px] bg-[var(--accent)] mx-auto mb-6" />
        <h1 className="text-5xl md:text-6xl font-serif mb-4 tracking-tight text-zinc-900">
          Virtual Hair Color{' '}
          <span className="italic text-zinc-500">Try-On</span>
        </h1>
        <p className="text-lg text-zinc-500 mb-10 max-w-md font-light">
          See how a new colour looks on you — live
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <button
            onClick={startCamera}
            className="bg-[#174F7F] text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-[#123c61] transition-colors duration-300 rounded-lg"
          >
            Open Camera
          </button>
          <button
            onClick={startUpload}
            className="border border-zinc-300 text-zinc-700 px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-100 transition-colors duration-300 rounded-lg"
          >
            Upload Photo
          </button>
        </div>

        <div className="space-y-2 text-xs text-zinc-400 max-w-sm">
          <p>Your photos are processed entirely on your device and never leave your browser.</p>
          <p>Preview only. Very light shades may look different in salon.</p>
        </div>
      </div>
    );
  }

  // Camera or Upload mode
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      {/* Back button */}
      <button
        onClick={() => {
          workerRef.current?.terminate();
          workerRef.current = null;
          setWorkerReady(false);
          setMode('landing');
          setError(null);
        }}
        className="text-zinc-500 hover:text-zinc-800 text-sm flex items-center gap-1 transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-8 text-zinc-500">
          <div className="w-5 h-5 border-2 border-zinc-300 border-t-[#174F7F] rounded-full animate-spin" />
          <span className="text-sm">Loading hair detection model...</span>
        </div>
      )}

      {/* Preview area */}
      <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
        {mode === 'camera' && (
          <>
            {/* Hidden video element — worker gets frames, canvas shows result */}
            <CameraView
              onFrame={handleFrame}
              onError={(msg) => {
                setError(msg);
                setMode('upload');
              }}
              active={mode === 'camera'}
            />
            {/* Overlay the preview canvas on top of the camera */}
            <div className="absolute inset-0">
              <PreviewCanvas
                ref={previewRef}
                width={dimensions.width}
                height={dimensions.height}
                mirrored
              />
            </div>
          </>
        )}

        {mode === 'upload' && !previewRef.current?.getCanvas()?.width && (
          <UploadDropzone onImageLoaded={handleImageLoaded} />
        )}

        {mode === 'upload' && (
          <div className={loading ? 'hidden' : ''}>
            <PreviewCanvas
              ref={previewRef}
              width={dimensions.width}
              height={dimensions.height}
            />
          </div>
        )}
      </div>

      {/* Color controls */}
      <div className="bg-zinc-900 rounded-lg p-4">
        <ColorPalette
          selectedHex={colorHex}
          selectedName={colorName}
          intensity={intensity}
          onColorChange={handleColorChange}
          onIntensityChange={setIntensity}
        />
      </div>

      {/* Download */}
      <ResultActions onDownload={() => previewRef.current?.downloadJpeg()} />

      {/* Mode switch */}
      <div className="text-center">
        {mode === 'camera' ? (
          <button
            onClick={startUpload}
            className="text-zinc-500 hover:text-zinc-700 text-sm underline transition-colors"
          >
            Or upload a photo instead
          </button>
        ) : (
          <button
            onClick={startCamera}
            className="text-zinc-500 hover:text-zinc-700 text-sm underline transition-colors"
          >
            Or use your camera instead
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles by running lint**

```bash
pnpm lint
```

Expected: No errors related to TryColorClient.tsx (warnings about unused vars are OK at this stage).

- [ ] **Step 3: Commit**

```bash
git add src/app/try-color/TryColorClient.tsx
git commit -m "feat(try-color): add main client orchestrator with camera/upload/preview state machine"
```

---

### Task 11: Server Page and Metadata

**Files:**
- Create: `src/app/try-color/page.tsx`

- [ ] **Step 1: Create page.tsx**

```tsx
// src/app/try-color/page.tsx
import type { Metadata } from 'next';
import TryColorClient from './TryColorClient';

export const metadata: Metadata = {
  title: 'Virtual Hair Color Try-On',
  description:
    'Preview different hair colours in real time using your camera. See how a new look suits you before booking at Harbour Hair Salon.',
  alternates: { canonical: '/try-color' },
};

export default function TryColorPage() {
  return (
    <div className="min-h-screen bg-white">
      <TryColorClient />
    </div>
  );
}
```

- [ ] **Step 2: Verify the page loads**

```bash
pnpm dev
```

Open `http://localhost:3000/try-color` in the browser. Verify:
- Landing page renders with title, CTAs, and disclaimer text
- "Open Camera" prompts for camera permission
- "Upload Photo" shows the dropzone

- [ ] **Step 3: Commit**

```bash
git add src/app/try-color/page.tsx
git commit -m "feat(try-color): add server page with metadata"
```

---

### Task 12: Navigation Links

**Files:**
- Modify: `src/components/layout/Header.tsx:22`
- Modify: `src/components/layout/MobileMenuOverlay.tsx:82`

- [ ] **Step 1: Add "Try Color" to desktop nav in Header.tsx**

After line 22 (the Contact link), add:

```tsx
          <Link href="/try-color" className="hover:text-[var(--accent)] transition-colors duration-300">Try Color</Link>
```

- [ ] **Step 2: Add "Try Color" to mobile nav in MobileMenuOverlay.tsx**

After line 82 (the Contact link), before the divider, add:

```tsx
          <Link
            href="/try-color"
            className="text-white hover:text-zinc-400 text-3xl font-serif tracking-tight transition-colors"
            onClick={onClose}
          >
            Try Color
          </Link>
```

- [ ] **Step 3: Verify navigation**

```bash
pnpm dev
```

Open `http://localhost:3000`. Verify:
- Desktop: "Try Color" link appears in header nav between Contact and auth links
- Mobile: "Try Color" link appears in overlay menu between Contact and the divider
- Both links navigate to `/try-color`

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Header.tsx src/components/layout/MobileMenuOverlay.tsx
git commit -m "feat(try-color): add navigation links to desktop and mobile menus"
```

---

### Task 13: Integration Testing and Polish

**Files:**
- Potentially modify: `src/app/try-color/TryColorClient.tsx` (bug fixes from manual testing)

This task is manual QA and any fixes that arise.

- [ ] **Step 1: Test live camera flow**

```bash
pnpm dev
```

Open `http://localhost:3000/try-color` on a device with a camera:
1. Click "Open Camera" — camera should start, model loading spinner should appear
2. Once model loads, hair should be detected and default color overlay visible
3. Click different preset swatches — color should change in real time
4. Adjust intensity slider — overlay should strengthen/weaken
5. Click Download — a JPEG should save to device
6. Click flip camera button — should switch between front/back
7. Click "Back" — should return to landing

- [ ] **Step 2: Test upload fallback flow**

1. Click "Upload Photo"
2. Upload a photo with visible hair
3. Model loads and applies color overlay to still image
4. Change colors and verify the preview updates
5. Click Download

- [ ] **Step 3: Test error states**

1. Deny camera permission — should show error and fall back to upload mode
2. Upload a non-image file — should show validation error
3. Upload an oversized file — should show size error

- [ ] **Step 4: Test on mobile**

Open on a mobile device (or use Chrome DevTools device emulation):
1. Verify mobile layout is usable — camera dominates viewport
2. Verify color swatches scroll horizontally
3. Verify flip camera works
4. Verify download works

- [ ] **Step 5: Run lint and build**

```bash
pnpm lint && pnpm build
```

Expected: No errors. Fix any that arise.

- [ ] **Step 6: Commit any fixes**

Stage only changed files explicitly (review `git status` first):

```bash
git status
git add src/app/try-color/ src/components/try-color/
git commit -m "fix(try-color): polish and bug fixes from integration testing"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Project setup | `package.json` |
| 2 | Color constants + math | `constants.ts`, `colorMath.ts` |
| 3 | MediaPipe wrapper | `HairSegmentation.ts` |
| 4 | Web Worker | `segmentation.worker.ts` |
| 5 | Color palette UI | `ColorPalette.tsx` |
| 6 | Camera view | `CameraView.tsx` |
| 7 | Upload dropzone | `UploadDropzone.tsx` |
| 8 | Preview canvas | `PreviewCanvas.tsx` |
| 9 | Result actions | `ResultActions.tsx` |
| 10 | Client orchestrator | `TryColorClient.tsx` |
| 11 | Server page | `page.tsx` |
| 12 | Navigation links | `Header.tsx`, `MobileMenuOverlay.tsx` |
| 13 | Integration QA | Manual testing + fixes |
