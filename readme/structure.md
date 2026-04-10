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
- `src/app/try-color/TryColorClient.tsx` — Main client orchestrator (camera/upload modes, single-canvas compositing render loop, worker lifecycle)
- `src/components/try-color/CameraView.tsx` — Camera feed, device flip, FPS-throttled frame dispatch
- `src/components/try-color/PreviewCanvas.tsx` — Preview surface for upload mode (drawBitmap, drawImageData, clearCanvas, downloadJpeg)
- `src/components/try-color/segmentation.worker.ts` — Worker: MediaPipe segmentation with GPU delegate, mask erosion, edge feathering, temporal smoothing, light-color alpha reduction
- `src/components/try-color/HairSegmentation.ts` — Singleton ImageSegmenter + `segmentStill()` for uploaded photos
- `src/components/try-color/colorMath.ts` — Color utilities: `hexToRgb`, `rgbToHsl`, `hslToRgb`, `recolorPixel`, `getHexSaturation`, `applyRecolorToImageData`
- `src/components/try-color/constants.ts` — Preset colors (22), model URLs, performance thresholds, hair category index
- `src/components/try-color/ColorPalette.tsx` — Color swatches (wrapping grid), custom picker, intensity slider
- `src/components/try-color/UploadDropzone.tsx` — Upload flow and image validation (max 1024px resize)
- `src/components/try-color/ResultActions.tsx` — Download button

## Services
(To be populated as we build)

## Database Models
- User
- Stylist
- Service
- Appointment
- Availability

