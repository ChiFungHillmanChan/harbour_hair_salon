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
import { hexToRgb } from './colorMath';

let segmenter: ImageSegmenter | null = null;
let busy = false;

// Reusable canvases / buffers to avoid allocation per frame
let segCanvas: OffscreenCanvas | null = null;
let segCtx: OffscreenCanvasRenderingContext2D | null = null;
let overlayCanvas: OffscreenCanvas | null = null;
let overlayCtx: OffscreenCanvasRenderingContext2D | null = null;
let overlayImageData: ImageData | null = null;

function ensureCanvases(w: number, h: number) {
  if (!segCanvas || segCanvas.width !== w || segCanvas.height !== h) {
    segCanvas = new OffscreenCanvas(w, h);
    segCtx = segCanvas.getContext('2d')!;
    overlayCanvas = new OffscreenCanvas(w, h);
    overlayCtx = overlayCanvas.getContext('2d')!;
    overlayImageData = new ImageData(w, h);
  }
}

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
    const w = frame.width;
    const h = frame.height;
    ensureCanvases(w, h);

    // Draw frame onto segmentation canvas (MediaPipe needs a canvas source)
    segCtx!.drawImage(frame, 0, 0);
    frame.close();

    // Run segmentation
    const result = segmenter.segmentForVideo(segCanvas!, timestamp);
    const mask = result.categoryMask;
    if (!mask) {
      result.close();
      busy = false;
      return;
    }

    const maskData = mask.getAsUint8Array();

    // Build color overlay using Uint32Array for ~4x faster pixel writes.
    // Only hair pixels get the target color; rest stays transparent.
    // The main thread composites this over the live <video> via CSS
    // mix-blend-mode: color, so we don't need to composite here.
    const [tR, tG, tB] = hexToRgb(colorHex);
    const alpha = Math.round((intensity / 100) * 140); // cap at ~55% for natural look

    const buf32 = new Uint32Array(overlayImageData!.data.buffer);
    buf32.fill(0); // clear to fully transparent
    // Little-endian RGBA: R in lowest byte, A in highest
    const fillColor = tR | (tG << 8) | (tB << 16) | (alpha << 24);

    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i] === HAIR_CATEGORY_INDEX) {
        buf32[i] = fillColor;
      }
    }

    result.close();

    overlayCtx!.putImageData(overlayImageData!, 0, 0);

    // Transfer overlay-only bitmap (CSS mix-blend-mode handles compositing)
    const resultBitmap = overlayCanvas!.transferToImageBitmap();
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
