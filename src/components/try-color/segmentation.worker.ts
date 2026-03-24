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
