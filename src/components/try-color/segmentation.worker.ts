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
  type HairAnalysis,
  type RecolorRequest,
} from './constants';
import {
  applyRecolorToImageDataWithAlpha,
  analyzeHair,
  normalizeHairConfidence,
  smoothHairAnalysis,
} from './colorMath';
import { refineHairMask, type HairMaskData } from './HairSegmentation';

let segmenter: ImageSegmenter | null = null;
let busy = false;

let frameCanvas: OffscreenCanvas | null = null;
let frameCtx: OffscreenCanvasRenderingContext2D | null = null;
let outputCanvas: OffscreenCanvas | null = null;
let outputCtx: OffscreenCanvasRenderingContext2D | null = null;
let outputImageData: ImageData | null = null;
let workingAlphaMask: Float32Array | null = null;
let smoothedAlphaMask: Float32Array | null = null;
let smoothedCoreMask: Float32Array | null = null;
let smoothedFringeMask: Float32Array | null = null;
let smoothedAnalysis: HairAnalysis | null = null;
let lastStableAnalysis: HairAnalysis | null = null;

const TEMPORAL_BLEND = 0.35;
const TEMPORAL_ANALYSIS_BLEND = 0.25;
const MIN_ANALYSIS_CONFIDENCE = 0.15;

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
    smoothedCoreMask = new Float32Array(width * height);
    smoothedFringeMask = new Float32Array(width * height);
    smoothedAnalysis = null;
    lastStableAnalysis = null;
  }
}

function blendMask(dst: Float32Array, src: Float32Array, amount: number) {
  for (let i = 0; i < dst.length; i++) {
    dst[i] = src[i] * (1 - amount) + dst[i] * amount;
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

interface WorkerTimings {
  drawAndReadback: number;
  segment: number;
  maskRefine: number;
  recolor: number;
  transfer: number;
  total: number;
}

function processFrame(
  frame: ImageBitmap,
  request: RecolorRequest,
  timestamp: number,
) {
  if (!segmenter || busy) {
    frame.close();
    return;
  }

  busy = true;
  const start = performance.now();
  const timings: Partial<WorkerTimings> = {};

  try {
    const width = frame.width;
    const height = frame.height;
    ensureCanvases(width, height);

    const t0 = performance.now();
    frameCtx!.drawImage(frame, 0, 0);
    frame.close();
    const sourceImageData = frameCtx!.getImageData(0, 0, width, height);
    timings.drawAndReadback = performance.now() - t0;

    let processedBitmap: ImageBitmap | null = null;
    let recolorSummary: ReturnType<typeof applyRecolorToImageDataWithAlpha> | null = null;

    const tSeg = performance.now();
    segmenter.segmentForVideo(frameCanvas!, timestamp, (result) => {
      try {
        timings.segment = performance.now() - tSeg;

        const tMask = performance.now();
        copyHairAlphaMask(result, workingAlphaMask!);
        const refinedMask = refineHairMask(sourceImageData, workingAlphaMask!);

        blendMask(smoothedAlphaMask!, refinedMask.alphaMask, TEMPORAL_BLEND);
        blendMask(smoothedCoreMask!, refinedMask.coreMask, TEMPORAL_BLEND);
        blendMask(smoothedFringeMask!, refinedMask.fringeMask, TEMPORAL_BLEND);
        timings.maskRefine = performance.now() - tMask;

        const smoothedMask: HairMaskData = {
          alphaMask: smoothedAlphaMask!,
          coreMask: smoothedCoreMask!,
          fringeMask: smoothedFringeMask!,
          width,
          height,
        };

        outputImageData!.data.set(sourceImageData.data);
        const rawAnalysis = analyzeHair(outputImageData!, smoothedMask.alphaMask);
        let analysisToUse = rawAnalysis;

        if (rawAnalysis.confidence < MIN_ANALYSIS_CONFIDENCE && lastStableAnalysis) {
          analysisToUse = lastStableAnalysis;
        } else if (smoothedAnalysis) {
          analysisToUse = smoothHairAnalysis(
            smoothedAnalysis,
            rawAnalysis,
            TEMPORAL_ANALYSIS_BLEND,
          );
        }

        smoothedAnalysis = analysisToUse;
        if (analysisToUse.confidence >= MIN_ANALYSIS_CONFIDENCE) {
          lastStableAnalysis = analysisToUse;
        }

        const tRecolor = performance.now();
        const recolor = applyRecolorToImageDataWithAlpha(
          outputImageData!,
          smoothedMask,
          request,
          { analysisOverride: analysisToUse },
        );
        timings.recolor = performance.now() - tRecolor;

        recolorSummary = recolor;

        const tTransfer = performance.now();
        outputCtx!.putImageData(outputImageData!, 0, 0);
        processedBitmap = outputCanvas!.transferToImageBitmap();
        timings.transfer = performance.now() - tTransfer;
      } finally {
        result.close();
      }
    });

    if (!processedBitmap || !recolorSummary) {
      return;
    }

    const elapsed = performance.now() - start;
    timings.total = elapsed;

    self.postMessage(
      {
        type: 'frame',
        bitmap: processedBitmap,
        elapsed,
        recolor: recolorSummary,
        timings,
      },
      // @ts-expect-error transferable
      [processedBitmap],
    );
  } catch (err) {
    console.error('Worker segmentation error:', err);
    // `code` is what the page translates; `message` stays for logs.
    self.postMessage({
      type: 'error',
      code: 'processingFailed',
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
        code: 'unavailable',
        message: 'Live preview is unavailable on this device. Try uploading a photo instead.',
      });
    });
  } else if (type === 'segment') {
    const { frame, request, timestamp } = e.data;
    processFrame(frame, request, timestamp);
  }
};
