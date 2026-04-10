// src/components/try-color/segmentation.worker.ts

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
import {
  applyRecolorToImageDataWithAlpha,
  normalizeHairConfidence,
} from './colorMath';

let segmenter: ImageSegmenter | null = null;
let busy = false;

let frameCanvas: OffscreenCanvas | null = null;
let frameCtx: OffscreenCanvasRenderingContext2D | null = null;
let outputCanvas: OffscreenCanvas | null = null;
let outputCtx: OffscreenCanvasRenderingContext2D | null = null;
let outputImageData: ImageData | null = null;
let workingAlphaMask: Float32Array | null = null;
let smoothedAlphaMask: Float32Array | null = null;

const TEMPORAL_BLEND = 0.35;

function shouldPreferCpuDelegate() {
  const ua = self.navigator?.userAgent ?? '';
  const isAppleMobile =
    /iPhone|iPad|iPod/i.test(ua) ||
    (self.navigator?.platform === 'MacIntel' &&
      (self.navigator?.maxTouchPoints ?? 0) > 1);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Android/i.test(ua);
  return isAppleMobile || isSafari;
}

function ensureCanvases(width: number, height: number) {
  if (!frameCanvas || frameCanvas.width !== width || frameCanvas.height !== height) {
    frameCanvas = new OffscreenCanvas(width, height);
    frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true })!;

    outputCanvas = new OffscreenCanvas(width, height);
    outputCtx = outputCanvas.getContext('2d')!;
    outputImageData = new ImageData(width, height);
    workingAlphaMask = new Float32Array(width * height);
    smoothedAlphaMask = new Float32Array(width * height);
  }
}

function copyHairAlphaMask(result: ImageSegmenterResult, dst: Float32Array) {
  const hairConfidenceMask = result.confidenceMasks?.[HAIR_CATEGORY_INDEX];
  if (hairConfidenceMask) {
    const raw = hairConfidenceMask.getAsFloat32Array();
    for (let i = 0; i < raw.length; i++) {
      dst[i] = normalizeHairConfidence(raw[i]);
    }
    return;
  }

  const categoryMask = result.categoryMask;
  if (!categoryMask) {
    dst.fill(0);
    return;
  }

  const raw = categoryMask.getAsUint8Array();
  for (let i = 0; i < raw.length; i++) {
    dst[i] = raw[i] === HAIR_CATEGORY_INDEX ? 1 : 0;
  }
}

async function init() {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
  const preferCpu = shouldPreferCpuDelegate();

  try {
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: SEGMENTER_MODEL_URL,
        delegate: preferCpu ? 'CPU' : 'GPU',
      },
      outputCategoryMask: true,
      outputConfidenceMasks: true,
      runningMode: 'VIDEO',
    });
  } catch {
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: SEGMENTER_MODEL_URL,
        delegate: 'CPU',
      },
      outputCategoryMask: true,
      outputConfidenceMasks: true,
      runningMode: 'VIDEO',
    });
  }

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
    const width = frame.width;
    const height = frame.height;
    ensureCanvases(width, height);

    frameCtx!.drawImage(frame, 0, 0);
    frame.close();

    const sourceImageData = frameCtx!.getImageData(0, 0, width, height);
    let processedBitmap: ImageBitmap | null = null;

    segmenter.segmentForVideo(frameCanvas!, timestamp, (result) => {
      try {
        copyHairAlphaMask(result, workingAlphaMask!);

        for (let i = 0; i < workingAlphaMask!.length; i++) {
          smoothedAlphaMask![i] =
            workingAlphaMask![i] * (1 - TEMPORAL_BLEND) +
            smoothedAlphaMask![i] * TEMPORAL_BLEND;
        }

        outputImageData!.data.set(sourceImageData.data);
        applyRecolorToImageDataWithAlpha(
          outputImageData!,
          smoothedAlphaMask!,
          colorHex,
          intensity,
        );
        outputCtx!.putImageData(outputImageData!, 0, 0);
        processedBitmap = outputCanvas!.transferToImageBitmap();
      } finally {
        result.close();
      }
    });

    if (!processedBitmap) {
      return;
    }

    const elapsed = performance.now() - start;
    self.postMessage(
      { type: 'frame', bitmap: processedBitmap, elapsed },
      // @ts-expect-error transferable
      [processedBitmap],
    );
  } catch (err) {
    console.error('Worker segmentation error:', err);
    self.postMessage({
      type: 'error',
      message: 'Live preview processing failed. Try uploading a photo instead.',
    });
  } finally {
    busy = false;
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;
  if (type === 'init') {
    void init().catch((err) => {
      console.error('Worker init error:', err);
      self.postMessage({
        type: 'error',
        message: 'Live preview is unavailable on this device. Try uploading a photo instead.',
      });
    });
  } else if (type === 'segment') {
    const { frame, colorHex, intensity, timestamp } = e.data;
    processFrame(frame, colorHex, intensity, timestamp);
  }
};
