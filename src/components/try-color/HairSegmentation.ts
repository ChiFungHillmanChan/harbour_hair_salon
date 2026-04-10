// src/components/try-color/HairSegmentation.ts

import {
  ImageSegmenter,
  FilesetResolver,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision';
import {
  HAIR_CATEGORY_INDEX,
  MEDIAPIPE_WASM_CDN,
  SEGMENTER_MODEL_URL,
} from './constants';
import { normalizeHairConfidence } from './colorMath';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

export interface HairMaskData {
  alphaMask: Float32Array;
  width: number;
  height: number;
}

function shouldPreferCpuDelegate() {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  const isAppleMobile =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Android/i.test(ua);
  return isAppleMobile || isSafari;
}

function createSegmenterOptions(runningMode: 'IMAGE' | 'VIDEO') {
  return {
    baseOptions: {
      modelAssetPath: SEGMENTER_MODEL_URL,
      ...(shouldPreferCpuDelegate() ? { delegate: 'CPU' as const } : {}),
    },
    outputCategoryMask: true,
    outputConfidenceMasks: true,
    runningMode,
  };
}

function copyHairMask(
  result: ImageSegmenterResult,
  width: number,
  height: number,
): HairMaskData {
  const hairConfidenceMask = result.confidenceMasks?.[HAIR_CATEGORY_INDEX];
  if (hairConfidenceMask) {
    const raw = hairConfidenceMask.getAsFloat32Array();
    const alphaMask = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      alphaMask[i] = normalizeHairConfidence(raw[i]);
    }
    return { alphaMask, width, height };
  }

  const categoryMask = result.categoryMask;
  if (!categoryMask) throw new Error('Segmentation returned no usable hair mask');

  const raw = categoryMask.getAsUint8Array();
  const alphaMask = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    alphaMask[i] = raw[i] === HAIR_CATEGORY_INDEX ? 1 : 0;
  }
  return { alphaMask, width, height };
}

/**
 * Create and cache a single ImageSegmenter instance.
 * Calling this multiple times returns the same promise.
 */
export function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
      return ImageSegmenter.createFromOptions(vision, createSegmenterOptions('IMAGE'));
    })();
  }
  return segmenterPromise;
}

/**
 * Run segmentation on a single still image (for the upload fallback path).
 * Returns a soft alpha mask that can be reused for recoloring updates.
 */
export async function segmentStill(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<HairMaskData> {
  const segmenter = await getSegmenter();
  let maskData: HairMaskData | null = null;

  segmenter.segment(image, (result) => {
    try {
      maskData = copyHairMask(
        result,
        result.categoryMask?.width ?? image.width,
        result.categoryMask?.height ?? image.height,
      );
    } finally {
      result.close();
    }
  });

  if (!maskData) {
    throw new Error('Segmentation returned no hair mask');
  }

  return maskData;
}

/**
 * Create a fresh segmenter in VIDEO mode for the worker path.
 * Does NOT use the singleton — the worker owns its own instance.
 */
export async function createVideoSegmenter(): Promise<ImageSegmenter> {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
  return ImageSegmenter.createFromOptions(vision, createSegmenterOptions('VIDEO'));
}
