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
