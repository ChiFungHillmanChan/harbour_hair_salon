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
  coreMask: Float32Array;
  fringeMask: Float32Array;
  width: number;
  height: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function boxDilate3x3(
  src: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const dst = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      let maxValue = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          maxValue = Math.max(maxValue, src[yy * width + xx]);
        }
      }
      dst[y * width + x] = maxValue;
    }
  }

  return dst;
}

function boxErode3x3(
  src: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const dst = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      let minValue = 1;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          minValue = Math.min(minValue, src[yy * width + xx]);
        }
      }
      dst[y * width + x] = minValue;
    }
  }

  return dst;
}

function blurHorizontal(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const dst = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const xx = Math.min(width - 1, Math.max(0, x + offset));
        sum += src[y * width + xx];
        weight++;
      }
      dst[y * width + x] = sum / weight;
    }
  }

  return dst;
}

function blurVertical(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const dst = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const yy = Math.min(height - 1, Math.max(0, y + offset));
        sum += src[yy * width + x];
        weight++;
      }
      dst[y * width + x] = sum / weight;
    }
  }

  return dst;
}

function buildLuminanceBuffer(imageData: ImageData): Float32Array {
  const luminance = new Float32Array(imageData.width * imageData.height);
  const pixels = imageData.data;

  for (let i = 0; i < luminance.length; i++) {
    const idx = i * 4;
    luminance[i] =
      (0.2126 * pixels[idx] + 0.7152 * pixels[idx + 1] + 0.0722 * pixels[idx + 2]) / 255;
  }

  return luminance;
}

function deriveRefinedMasks(
  refinedAlpha: Float32Array,
): Pick<HairMaskData, 'alphaMask' | 'coreMask' | 'fringeMask'> {
  const alphaMask = new Float32Array(refinedAlpha.length);
  const coreMask = new Float32Array(refinedAlpha.length);
  const fringeMask = new Float32Array(refinedAlpha.length);

  for (let i = 0; i < refinedAlpha.length; i++) {
    const alpha = clamp01(refinedAlpha[i]);
    alphaMask[i] = alpha;

    if (alpha >= 0.6) {
      coreMask[i] = alpha;
      fringeMask[i] = clamp01((1 - alpha) * 0.35);
      continue;
    }

    if (alpha >= 0.12) {
      fringeMask[i] = clamp01((alpha - 0.12) / 0.48);
    }
  }

  return { alphaMask, coreMask, fringeMask };
}

function readImageData(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): ImageData {
  const width = image instanceof HTMLImageElement ? image.naturalWidth || image.width : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight || image.height : image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Unable to read image data for hair refinement');
  }

  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function refineHairMask(
  imageData: ImageData,
  alphaMask: Float32Array,
): HairMaskData {
  const { width, height } = imageData;
  const luminance = buildLuminanceBuffer(imageData);
  const closed = boxErode3x3(boxDilate3x3(alphaMask, width, height), width, height);
  const blurred = blurVertical(blurHorizontal(closed, width, height, 1), width, height, 1);
  const refined = new Float32Array(alphaMask.length);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const idx = y * width + x;
      let localMean = 0;
      let samples = 0;

      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          localMean += luminance[yy * width + xx];
          samples++;
        }
      }

      localMean /= Math.max(1, samples);
      const edgeContrast = Math.min(1, Math.abs(luminance[idx] - localMean) * 3.2);
      const softBlend = alphaMask[idx] >= 0.6 ? 0.75 : 0.55;
      const baseAlpha = blurred[idx] * softBlend + alphaMask[idx] * (1 - softBlend);
      const edgeWeight = 1 - edgeContrast * (1 - baseAlpha) * 0.55;

      refined[idx] = clamp01(baseAlpha * edgeWeight);
    }
  }

  return {
    ...deriveRefinedMasks(refined),
    width,
    height,
  };
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
): Float32Array {
  const hairConfidenceMask = result.confidenceMasks?.[HAIR_CATEGORY_INDEX];
  if (hairConfidenceMask) {
    const raw = hairConfidenceMask.getAsFloat32Array();
    const alphaMask = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      alphaMask[i] = normalizeHairConfidence(raw[i]);
    }
    return alphaMask;
  }

  const categoryMask = result.categoryMask;
  if (!categoryMask) throw new Error('Segmentation returned no usable hair mask');

  const raw = categoryMask.getAsUint8Array();
  const alphaMask = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    alphaMask[i] = raw[i] === HAIR_CATEGORY_INDEX ? 1 : 0;
  }
  return alphaMask;
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
      const rawMask = copyHairMask(
        result,
      );
      const sourceImageData = readImageData(image);
      maskData = refineHairMask(sourceImageData, rawMask);
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
