'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { CameraView } from '@/components/try-color/CameraView';
import { UploadDropzone } from '@/components/try-color/UploadDropzone';
import { VideoTryOn } from '@/components/try-color/VideoTryOn';
import {
  PreviewCanvas,
  type PreviewCanvasHandle,
} from '@/components/try-color/PreviewCanvas';
import { ColorPalette } from '@/components/try-color/ColorPalette';
import { ResultActions } from '@/components/try-color/ResultActions';
import {
  segmentStill,
  type HairMaskData,
} from '@/components/try-color/HairSegmentation';
import {
  applyRecolorToImageDataWithAlpha,
  type ResolvedRecolorContext,
} from '@/components/try-color/colorMath';
import {
  PRESET_COLORS,
  DEFAULT_INTENSITY,
  LIVE_FRAME_MAX_DIM,
  LIVE_TARGET_FPS,
  SLOW_FRAME_THRESHOLD_MS,
  SLOW_FRAME_WINDOW,
  WARMUP_FRAMES,
  type BleachState,
  type HairAnalysis,
  type HairLevel,
  type HairLevelMode,
  type RecolorRequest,
  type ShadePreset,
} from '@/components/try-color/constants';

const ENABLE_LIVE_CAMERA = false; // disabled per client request; code retained for re-enable

type Mode = 'landing' | 'camera' | 'upload' | 'video';
const DEFAULT_SHADE = PRESET_COLORS[3];

interface LivePreviewProfile {
  maxDim: number;
  targetFps: number;
}

function detectLivePreviewProfile(): LivePreviewProfile {
  if (typeof navigator === 'undefined') {
    return { maxDim: LIVE_FRAME_MAX_DIM, targetFps: LIVE_TARGET_FPS };
  }

  const ua = navigator.userAgent;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const hasCoarsePointer =
    typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  // iPadOS Safari reports as Macintosh but has touch points
  const isIPadOS =
    /Macintosh/i.test(ua) && maxTouchPoints > 1 && hasCoarsePointer;

  const isTablet =
    /iPad|Tablet/i.test(ua) ||
    isIPadOS ||
    (hasCoarsePointer && maxTouchPoints > 1 && window.innerWidth >= 768);

  const isPhone =
    /iPhone/i.test(ua) ||
    (/Android/i.test(ua) && !isTablet) ||
    (hasCoarsePointer && maxTouchPoints > 1 && window.innerWidth < 768);

  const deviceMemory = 'deviceMemory' in navigator ? Number(navigator.deviceMemory) : undefined;

  if (isPhone) {
    return {
      maxDim: deviceMemory && deviceMemory <= 4 ? 288 : 320,
      targetFps: 8,
    };
  }

  if (isTablet) {
    return {
      maxDim: deviceMemory && deviceMemory <= 4 ? 320 : 384,
      targetFps: 10,
    };
  }

  return { maxDim: LIVE_FRAME_MAX_DIM, targetFps: LIVE_TARGET_FPS };
}

function buildRecolorRequest(
  preset: ShadePreset,
  previewStrength: number,
  baseLevelMode: HairLevelMode,
  manualBaseLevel: HairLevel,
  bleachState: BleachState,
): RecolorRequest {
  return {
    preset,
    previewStrength,
    baseLevelMode,
    manualBaseLevel: baseLevelMode === 'manual' ? manualBaseLevel : undefined,
    bleachState,
  };
}

export default function TryColorClient() {
  const [mode, setMode] = useState<Mode>('landing');
  const [selectedShade, setSelectedShade] = useState<ShadePreset>(DEFAULT_SHADE);
  const [previewStrength, setPreviewStrength] = useState(DEFAULT_INTENSITY);
  const [baseLevelMode, setBaseLevelMode] = useState<HairLevelMode>('auto');
  const [manualBaseLevel, setManualBaseLevel] = useState<HairLevel>(5);
  const [bleachState, setBleachState] = useState<BleachState>('pre');
  const [hairAnalysis, setHairAnalysis] = useState<HairAnalysis | null>(null);
  const [recolorContext, setRecolorContext] = useState<ResolvedRecolorContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Loading...');
  const [error, setError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  const [hasUploadedImage, setHasUploadedImage] = useState(false);
  const [liveProfile, setLiveProfile] = useState<LivePreviewProfile>({
    maxDim: LIVE_FRAME_MAX_DIM,
    targetFps: LIVE_TARGET_FPS,
  });
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const previewRef = useRef<PreviewCanvasHandle>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef<RecolorRequest>(
    buildRecolorRequest(DEFAULT_SHADE, DEFAULT_INTENSITY, 'auto', 5, 'pre'),
  );
  const frameTimesRef = useRef<number[]>([]);
  const frameCountRef = useRef(0);
  const workerBusyRef = useRef(false);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const displayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cachedFrameRef = useRef<ImageBitmap | null>(null);
  const lastUiUpdateRef = useRef(0);
  const droppedFramesRef = useRef(0);
  const pendingRecolorRef = useRef<ResolvedRecolorContext | null>(null);

  const uploadDataRef = useRef<{
    originalImageData: ImageData;
    hairMask: HairMaskData;
    width: number;
    height: number;
  } | null>(null);
  const uploadGenRef = useRef(0);

  useEffect(() => {
    requestRef.current = buildRecolorRequest(
      selectedShade,
      previewStrength,
      baseLevelMode,
      manualBaseLevel,
      bleachState,
    );
  }, [selectedShade, previewStrength, baseLevelMode, manualBaseLevel, bleachState]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial sync with window size; new rule from eslint-config-next 16.2.10, pre-existing pattern
    setLiveProfile(detectLivePreviewProfile());
    const onResize = () => setLiveProfile(detectLivePreviewProfile());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const drawLiveFrame = useCallback(
    (frame: ImageBitmap) => {
      const canvas = displayCanvasRef.current;
      if (!canvas) return;
      if (!displayCtxRef.current) {
        displayCtxRef.current = canvas.getContext('2d');
      }
      const ctx = displayCtxRef.current;
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      if (facingMode === 'user') {
        ctx.scale(-1, 1);
        ctx.drawImage(frame, -w, 0, w, h);
      } else {
        ctx.drawImage(frame, 0, 0, w, h);
      }
      ctx.restore();
    },
    [facingMode],
  );

  const resetWorkerMetrics = useCallback(() => {
    frameTimesRef.current = [];
    frameCountRef.current = 0;
    workerBusyRef.current = false;
  }, []);

  const cleanupCameraState = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerReady(false);
    setLoading(false);
    resetWorkerMetrics();
    droppedFramesRef.current = 0;
    pendingRecolorRef.current = null;
    cachedFrameRef.current?.close();
    cachedFrameRef.current = null;
    displayCtxRef.current?.clearRect(
      0,
      0,
      displayCanvasRef.current?.width ?? 0,
      displayCanvasRef.current?.height ?? 0,
    );
    displayCtxRef.current = null;
    setHairAnalysis(null);
    setRecolorContext(null);
  }, [resetWorkerMetrics]);

  const supportsLivePreview = useCallback(() => {
    return (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap === 'function'
    );
  }, []);

  const initWorker = useCallback(() => {
    if (workerRef.current) return;
    if (!supportsLivePreview()) {
      setError('Live preview is unavailable on this device. Try uploading a photo instead.');
      setMode('upload');
      return;
    }

    resetWorkerMetrics();
    setLoadingLabel('Loading hair detection model...');
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
        workerBusyRef.current = false;
        const { bitmap, elapsed, recolor } = e.data as {
          bitmap: ImageBitmap;
          elapsed: number;
          recolor: ResolvedRecolorContext;
        };
        cachedFrameRef.current?.close();
        cachedFrameRef.current = bitmap;
        drawLiveFrame(bitmap);
        frameCountRef.current++;

        const now = performance.now();
        const UI_THROTTLE_MS = 250;
        if (now - lastUiUpdateRef.current >= UI_THROTTLE_MS) {
          lastUiUpdateRef.current = now;
          setHairAnalysis(recolor.analysis);
          setRecolorContext(recolor);
        } else {
          pendingRecolorRef.current = recolor;
        }

        if (frameCountRef.current <= WARMUP_FRAMES) return;

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
            cleanupCameraState();
          }
        }
      } else if (type === 'error') {
        workerBusyRef.current = false;
        setLoading(false);
        setError(e.data.message);
        setMode('upload');
        cleanupCameraState();
      }
    };

    worker.onerror = () => {
      workerBusyRef.current = false;
      setLoading(false);
      setError('Live preview is unavailable on this device. Try uploading a photo instead.');
      setMode('upload');
      cleanupCameraState();
    };

    worker.postMessage({ type: 'init' });
    workerRef.current = worker;
  }, [cleanupCameraState, drawLiveFrame, resetWorkerMetrics, supportsLivePreview]);

  useEffect(() => {
    return () => {
      cleanupCameraState();
    };
  }, [cleanupCameraState]);

  // Flush any throttled UI state that hasn't been committed yet
  useEffect(() => {
    if (mode !== 'camera') return;
    const id = setInterval(() => {
      const pending = pendingRecolorRef.current;
      if (pending) {
        pendingRecolorRef.current = null;
        setHairAnalysis(pending.analysis);
        setRecolorContext(pending);
      }
    }, 300);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'camera') return;
    const frame = cachedFrameRef.current;
    if (frame) {
      drawLiveFrame(frame);
    }
  }, [mode, dimensions.width, dimensions.height, drawLiveFrame]);

  const handleFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!workerRef.current || !workerReady) return;
      if (workerBusyRef.current) {
        droppedFramesRef.current++;
        return;
      }

      if (
        video.videoWidth !== dimensions.width ||
        video.videoHeight !== dimensions.height
      ) {
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      workerBusyRef.current = true;
      const scale = Math.min(
        1,
        liveProfile.maxDim / Math.max(video.videoWidth, video.videoHeight),
      );
      const rw = Math.round(video.videoWidth * scale);
      const rh = Math.round(video.videoHeight * scale);

      const postFrame = (bitmap: ImageBitmap) => {
        workerRef.current?.postMessage(
          {
            type: 'segment',
            frame: bitmap,
            request: requestRef.current,
            timestamp: performance.now(),
          },
          [bitmap],
        );
      };

      createImageBitmap(video, {
        resizeWidth: rw,
        resizeHeight: rh,
        resizeQuality: 'medium',
      })
        .then(postFrame)
        .catch(() => createImageBitmap(video).then(postFrame))
        .catch(() => {
          workerBusyRef.current = false;
          setError('Live preview is unavailable on this device. Try uploading a photo instead.');
          setMode('upload');
          cleanupCameraState();
        });
    },
    [cleanupCameraState, workerReady, dimensions.height, dimensions.width, liveProfile.maxDim],
  );

  const handleImageLoaded = useCallback(
    async (source: HTMLImageElement | HTMLCanvasElement) => {
      const gen = ++uploadGenRef.current;
      setLoadingLabel('Analysing your photo...');
      setLoading(true);
      setError(null);
      try {
        const hairMask = await segmentStill(source);
        if (gen !== uploadGenRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(source, 0, 0);
        const originalImageData = ctx.getImageData(0, 0, source.width, source.height);

        uploadDataRef.current = {
          originalImageData,
          hairMask,
          width: source.width,
          height: source.height,
        };

        const coloredData = new ImageData(
          new Uint8ClampedArray(originalImageData.data),
          source.width,
          source.height,
        );
        const nextContext = applyRecolorToImageDataWithAlpha(
          coloredData,
          hairMask,
          requestRef.current,
        );

        if (gen !== uploadGenRef.current) return;

        setDimensions({ width: source.width, height: source.height });
        setHasUploadedImage(true);
        setHairAnalysis(nextContext.analysis);
        setRecolorContext(nextContext);
        previewRef.current?.drawImageData(coloredData, source.width, source.height);
      } catch (err) {
        if (gen !== uploadGenRef.current) return;
        setError('Could not process this image. Try a different photo.');
        console.error(err);
      } finally {
        if (gen === uploadGenRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (mode !== 'upload' || !uploadDataRef.current) return;

    const rafId = requestAnimationFrame(() => {
      if (!uploadDataRef.current) return;
      const { originalImageData, hairMask, width, height } = uploadDataRef.current;
      const coloredData = new ImageData(
        new Uint8ClampedArray(originalImageData.data),
        width,
        height,
      );
      const nextContext = applyRecolorToImageDataWithAlpha(
        coloredData,
        hairMask,
        requestRef.current,
      );
      setHairAnalysis(nextContext.analysis);
      setRecolorContext(nextContext);
      previewRef.current?.drawImageData(coloredData, width, height);
    });

    return () => cancelAnimationFrame(rafId);
  }, [selectedShade, previewStrength, baseLevelMode, manualBaseLevel, bleachState, mode]);

  const startCamera = () => {
    setError(null);
    setMode('camera');
    initWorker();
  };

  const startUpload = () => {
    cleanupCameraState();
    setError(null);
    setMode('upload');
    setHasUploadedImage(false);
    uploadDataRef.current = null;
    setHairAnalysis(null);
    setRecolorContext(null);
  };

  const startVideo = () => {
    cleanupCameraState();
    setError(null);
    setMode('video');
    setHasUploadedImage(false);
    uploadDataRef.current = null;
    setHairAnalysis(null);
    setRecolorContext(null);
  };

  const handleShadeChange = (shade: ShadePreset) => {
    setSelectedShade(shade);
  };

  const handleBaseLevelModeChange = (nextMode: HairLevelMode) => {
    setBaseLevelMode(nextMode);
  };

  const handleManualBaseLevelChange = (level: HairLevel) => {
    setBaseLevelMode('manual');
    setManualBaseLevel(level);
  };

  const handleDownload = useCallback(() => {
    if (mode !== 'camera') {
      previewRef.current?.downloadJpeg();
      return;
    }
    const canvas = displayCanvasRef.current;
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
  }, [mode]);

  const detectedBaseLevel = hairAnalysis?.estimatedBaseLevel ?? null;
  const effectiveBaseLevel =
    recolorContext?.effectiveBaseLevel ??
    (baseLevelMode === 'manual' ? manualBaseLevel : detectedBaseLevel);
  const expectedResultNotice = recolorContext?.expectedResultNotice ?? null;

  // ── Landing ──────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-zinc-900 text-white">
        {/* Hero */}
        <section className="relative py-24 md:py-32 overflow-hidden">
          {/* Subtle gradient background */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-zinc-900 to-zinc-900" />

          <div className="relative z-10 container mx-auto px-4 text-center">
            <div className="animate-fade-in">
              <div className="w-16 h-[2px] bg-white/50 mx-auto mb-8" />

              <p className="text-zinc-300 text-sm uppercase tracking-[0.2em] font-medium mb-6">
                Virtual Experience
              </p>

              <h1 className="text-5xl md:text-7xl font-serif mb-6 tracking-tight leading-[0.95]">
                Hair Colour{' '}
                <span className="text-zinc-400">Try-On</span>
              </h1>

              <p className="text-lg md:text-xl text-zinc-400 mb-12 max-w-lg mx-auto font-light leading-relaxed">
                See how a new colour looks on you before you book.
                Powered by AI, processed entirely on your device.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                <button
                  onClick={startUpload}
                  className="bg-white text-zinc-900 px-10 py-4 text-sm uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all duration-300 hover:scale-[1.02]"
                >
                  Upload Photo
                </button>
                <button
                  onClick={startVideo}
                  className="border border-white/30 text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-medium hover:bg-white/10 transition-all duration-300"
                >
                  Upload Video
                </button>
                {ENABLE_LIVE_CAMERA && (
                  <button
                    onClick={startCamera}
                    className="border border-white/30 text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-medium hover:bg-white/10 transition-all duration-300"
                  >
                    Open Camera
                  </button>
                )}
              </div>

              <div className="w-16 h-[2px] bg-white/50 mx-auto mb-6" />

              <div className="space-y-2 text-xs text-zinc-500 max-w-md mx-auto">
                <p>Your photos never leave your browser. All processing happens on-device.</p>
                <p>Preview only — very light or fantasy shades may look different in salon.</p>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16 border-t border-zinc-800">
          <div className="container mx-auto px-4 max-w-3xl">
            <h2 className="font-serif text-2xl text-center mb-12 tracking-tight">
              How It <span className="text-zinc-400">Works</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
              {[
                { step: '01', title: 'Capture', desc: 'Open your camera or upload a photo' },
                { step: '02', title: 'Explore', desc: 'Browse 22 salon colours or pick your own' },
                { step: '03', title: 'Download', desc: 'Save your favourite look as a JPEG' },
              ].map((item) => (
                <div key={item.step}>
                  <p className="text-zinc-300 text-xs tracking-[0.2em] font-medium mb-3">
                    {item.step}
                  </p>
                  <h3 className="font-serif text-xl mb-2">{item.title}</h3>
                  <p className="text-zinc-500 text-sm font-light">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ── Camera / Upload Mode ─────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Top bar */}
      <div className="bg-zinc-900 border-b border-zinc-800">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => {
              cleanupCameraState();
              setMode('landing');
              setError(null);
              setHasUploadedImage(false);
              uploadDataRef.current = null;
              setHairAnalysis(null);
              setRecolorContext(null);
            }}
            className="text-zinc-400 hover:text-white text-sm flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <h1 className="font-serif text-white text-lg tracking-tight">
            Colour <span className="text-zinc-400">Try-On</span>
          </h1>

          <div className="w-12" /> {/* Spacer for centering */}
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 max-w-2xl space-y-4">
        {/* Error */}
        {error && (
          <div className="bg-red-950/50 border border-red-900/50 text-red-300 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-12 text-zinc-400">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
            <span className="text-sm font-light">{loadingLabel}</span>
          </div>
        )}

        {/* Preview area (camera / photo). Video mode renders its own preview. */}
        {mode === 'video' ? (
          <VideoTryOn
            request={buildRecolorRequest(
              selectedShade,
              previewStrength,
              baseLevelMode,
              manualBaseLevel,
              bleachState,
            )}
          />
        ) : (
          <div className="relative w-full aspect-[4/3] bg-black rounded-xl overflow-hidden border border-zinc-800 shadow-2xl shadow-black/50">
            {mode === 'camera' && (
              <>
                <CameraView
                  onFrame={handleFrame}
                  onError={(msg) => {
                    cleanupCameraState();
                    setError(msg);
                    setMode('upload');
                  }}
                  active={mode === 'camera'}
                  targetFps={liveProfile.targetFps}
                  onFacingModeChange={setFacingMode}
                />
                <canvas
                  ref={displayCanvasRef}
                  width={dimensions.width}
                  height={dimensions.height}
                  className="absolute inset-0 z-10 w-full h-full object-cover rounded-lg"
                />
              </>
            )}

            {mode === 'upload' && !hasUploadedImage && !loading && (
              <UploadDropzone onImageLoaded={handleImageLoaded} />
            )}

            {mode === 'upload' && hasUploadedImage && (
              <PreviewCanvas
                ref={previewRef}
                width={dimensions.width}
                height={dimensions.height}
              />
            )}
          </div>
        )}

        {/* Color controls panel */}
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <ColorPalette
            selectedHex={selectedShade.swatchHex}
            selectedName={selectedShade.name}
            previewStrength={previewStrength}
            baseLevelMode={baseLevelMode}
            manualBaseLevel={manualBaseLevel}
            detectedBaseLevel={detectedBaseLevel}
            effectiveBaseLevel={effectiveBaseLevel}
            expectedResultNotice={expectedResultNotice}
            bleachState={bleachState}
            onShadeChange={handleShadeChange}
            onPreviewStrengthChange={setPreviewStrength}
            onBaseLevelModeChange={handleBaseLevelModeChange}
            onManualBaseLevelChange={handleManualBaseLevelChange}
            onBleachStateChange={setBleachState}
          />
        </div>

        {/* Download (camera / photo only — video has its own frame download) */}
        {mode !== 'video' && (
          <ResultActions
            onDownload={handleDownload}
            // eslint-disable-next-line react-hooks/refs -- pre-existing: frame count gates the download button; new rule from eslint-config-next 16.2.10
            disabled={loading || (mode === 'upload' && !hasUploadedImage) || (mode === 'camera' && frameCountRef.current === 0)}
          />
        )}

        {/* Mode switch */}
        <div className="flex justify-center gap-6 pb-6">
          {mode === 'camera' ? (
            <button
              onClick={startUpload}
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              Upload a photo instead
            </button>
          ) : mode === 'video' ? (
            <button
              onClick={startUpload}
              className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
            >
              Upload a photo instead
            </button>
          ) : (
            <>
              {hasUploadedImage && (
                <button
                  onClick={() => {
                    setHasUploadedImage(false);
                    uploadDataRef.current = null;
                  }}
                  className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                >
                  Change photo
                </button>
              )}
              <button
                onClick={startVideo}
                className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
              >
                Upload a video instead
              </button>
              {ENABLE_LIVE_CAMERA && (
                <button
                  onClick={startCamera}
                  className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                >
                  Use camera instead
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
