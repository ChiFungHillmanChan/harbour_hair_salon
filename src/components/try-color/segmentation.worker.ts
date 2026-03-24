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

// Reusable canvases to avoid allocation per frame
let mainCanvas: OffscreenCanvas | null = null;
let mainCtx: OffscreenCanvasRenderingContext2D | null = null;
let overlayCanvas: OffscreenCanvas | null = null;
let overlayCtx: OffscreenCanvasRenderingContext2D | null = null;

function ensureCanvases(w: number, h: number) {
  if (!mainCanvas || mainCanvas.width !== w || mainCanvas.height !== h) {
    mainCanvas = new OffscreenCanvas(w, h);
    mainCtx = mainCanvas.getContext('2d')!;
    overlayCanvas = new OffscreenCanvas(w, h);
    overlayCtx = overlayCanvas.getContext('2d')!;
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

    // Draw original frame
    mainCtx!.drawImage(frame, 0, 0);
    frame.close();

    // Run segmentation
    const result = segmenter.segmentForVideo(mainCanvas!, timestamp);
    const mask = result.categoryMask;
    if (!mask) {
      result.close();
      busy = false;
      return;
    }

    const maskData = mask.getAsUint8Array();

    // Fast compositing approach:
    // 1. Build a color overlay where hair pixels get the target color with alpha = intensity
    // 2. Use Canvas drawImage to composite it over the original frame
    // This avoids per-pixel HSL math and leverages GPU-accelerated Canvas ops.

    const [tR, tG, tB] = hexToRgb(colorHex);
    const alpha = Math.round((intensity / 100) * 140); // cap at ~55% for natural look

    const overlayData = overlayCtx!.createImageData(w, h);
    const pixels = overlayData.data;

    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i] === HAIR_CATEGORY_INDEX) {
        const idx = i * 4;
        pixels[idx] = tR;
        pixels[idx + 1] = tG;
        pixels[idx + 2] = tB;
        pixels[idx + 3] = alpha;
      }
    }

    result.close();

    overlayCtx!.putImageData(overlayData, 0, 0);

    // Use 'color' blend mode: applies hue+saturation from overlay while
    // preserving luminance (shadows/highlights/texture) from the original.
    // Falls back to simple alpha blend if not supported.
    mainCtx!.globalCompositeOperation = 'color';
    mainCtx!.drawImage(overlayCanvas!, 0, 0);
    mainCtx!.globalCompositeOperation = 'source-over';

    // Transfer result back as ImageBitmap
    const resultBitmap = mainCanvas!.transferToImageBitmap();
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
