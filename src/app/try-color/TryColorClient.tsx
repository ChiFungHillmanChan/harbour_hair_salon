'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { CameraView } from '@/components/try-color/CameraView';
import { UploadDropzone } from '@/components/try-color/UploadDropzone';
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
import { applyRecolorToImageDataWithAlpha } from '@/components/try-color/colorMath';
import {
  PRESET_COLORS,
  DEFAULT_INTENSITY,
  LIVE_FRAME_MAX_DIM,
  SLOW_FRAME_THRESHOLD_MS,
  SLOW_FRAME_WINDOW,
  WARMUP_FRAMES,
  OVERLAY_STALE_MS,
} from '@/components/try-color/constants';

type Mode = 'landing' | 'camera' | 'upload';

export default function TryColorClient() {
  const [mode, setMode] = useState<Mode>('landing');
  const [colorHex, setColorHex] = useState(PRESET_COLORS[3].hex);
  const [colorName, setColorName] = useState<string | null>(PRESET_COLORS[3].name);
  const [intensity, setIntensity] = useState(DEFAULT_INTENSITY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  const [hasUploadedImage, setHasUploadedImage] = useState(false);

  const previewRef = useRef<PreviewCanvasHandle>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorRef = useRef({ hex: colorHex, intensity });
  const frameTimesRef = useRef<number[]>([]);
  const frameCountRef = useRef(0);
  const workerBusyRef = useRef(false);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cachedFrameRef = useRef<ImageBitmap | null>(null);
  const lastFrameTimeRef = useRef(0);
  const renderRafRef = useRef(0);
  const facingModeRef = useRef<'user' | 'environment'>('user');

  const uploadDataRef = useRef<{
    originalImageData: ImageData;
    hairMask: HairMaskData;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    colorRef.current = { hex: colorHex, intensity };
  }, [colorHex, intensity]);

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
    cachedFrameRef.current?.close();
    cachedFrameRef.current = null;
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
        const { bitmap, elapsed } = e.data;
        cachedFrameRef.current?.close();
        cachedFrameRef.current = bitmap;
        lastFrameTimeRef.current = performance.now();
        frameCountRef.current++;

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
  }, [cleanupCameraState, resetWorkerMetrics, supportsLivePreview]);

  useEffect(() => {
    return () => {
      cleanupCameraState();
    };
  }, [cleanupCameraState]);

  // Single-canvas render loop for processed live frames.
  useEffect(() => {
    if (mode !== 'camera') return;

    const render = () => {
      const canvas = displayCanvasRef.current;
      if (!canvas) {
        renderRafRef.current = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        renderRafRef.current = requestAnimationFrame(render);
        return;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const frame = cachedFrameRef.current;
      if (frame && (performance.now() - lastFrameTimeRef.current) < OVERLAY_STALE_MS) {
        ctx.save();
        if (facingModeRef.current === 'user') {
          ctx.scale(-1, 1);
          ctx.drawImage(frame, -w, 0, w, h);
        } else {
          ctx.drawImage(frame, 0, 0, w, h);
        }
        ctx.restore();
      }

      renderRafRef.current = requestAnimationFrame(render);
    };

    renderRafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(renderRafRef.current);
    };
  }, [mode]);

  const handleFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!workerRef.current || !workerReady || workerBusyRef.current) return;

      if (
        video.videoWidth !== dimensions.width ||
        video.videoHeight !== dimensions.height
      ) {
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      workerBusyRef.current = true;
      const scale = Math.min(
        1,
        LIVE_FRAME_MAX_DIM / Math.max(video.videoWidth, video.videoHeight),
      );
      const rw = Math.round(video.videoWidth * scale);
      const rh = Math.round(video.videoHeight * scale);

      const postFrame = (bitmap: ImageBitmap) => {
        const { hex, intensity: currentIntensity } = colorRef.current;
        workerRef.current?.postMessage(
          {
            type: 'segment',
            frame: bitmap,
            colorHex: hex,
            intensity: currentIntensity,
            timestamp: performance.now(),
          },
          [bitmap],
        );
      };

      createImageBitmap(video, {
        resizeWidth: rw,
        resizeHeight: rh,
        resizeQuality: 'high',
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
    [cleanupCameraState, workerReady, dimensions.height, dimensions.width],
  );

  const handleImageLoaded = useCallback(
    async (source: HTMLImageElement | HTMLCanvasElement) => {
      setLoading(true);
      setError(null);
      try {
        const hairMask = await segmentStill(source);
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
        applyRecolorToImageDataWithAlpha(
          coloredData,
          hairMask.alphaMask,
          colorHex,
          intensity,
        );

        setDimensions({ width: source.width, height: source.height });
        setHasUploadedImage(true);
        previewRef.current?.drawImageData(coloredData, source.width, source.height);
      } catch (err) {
        setError('Could not process this image. Try a different photo.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [colorHex, intensity],
  );

  useEffect(() => {
    if (mode !== 'upload' || !uploadDataRef.current) return;
    const { originalImageData, hairMask, width, height } = uploadDataRef.current;
    const coloredData = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      width,
      height,
    );
    applyRecolorToImageDataWithAlpha(
      coloredData,
      hairMask.alphaMask,
      colorHex,
      intensity,
    );
    previewRef.current?.drawImageData(coloredData, width, height);
  }, [colorHex, intensity, mode]);

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
  };

  const handleColorChange = (hex: string, name: string | null) => {
    setColorHex(hex);
    setColorName(name);
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
              <div className="w-16 h-[2px] bg-[var(--accent)] mx-auto mb-8" />

              <p className="text-[var(--accent)] text-sm uppercase tracking-[0.3em] font-medium mb-6">
                Virtual Experience
              </p>

              <h1 className="text-5xl md:text-7xl font-serif mb-6 tracking-tight leading-[0.95]">
                Hair Colour{' '}
                <span className="italic text-zinc-400">Try-On</span>
              </h1>

              <p className="text-lg md:text-xl text-zinc-400 mb-12 max-w-lg mx-auto font-light leading-relaxed">
                See how a new colour looks on you before you book.
                Powered by AI, processed entirely on your device.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                <button
                  onClick={startCamera}
                  className="bg-[var(--accent)] text-black px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-[var(--accent-light)] transition-all duration-300 hover:scale-105"
                >
                  Open Camera
                </button>
                <button
                  onClick={startUpload}
                  className="border border-white/30 text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-medium hover:bg-white/10 transition-all duration-300"
                >
                  Upload Photo
                </button>
              </div>

              <div className="w-16 h-[2px] bg-[var(--accent)] mx-auto mb-6" />

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
              How It <span className="italic text-zinc-400">Works</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
              {[
                { step: '01', title: 'Capture', desc: 'Open your camera or upload a photo' },
                { step: '02', title: 'Explore', desc: 'Browse 22 salon colours or pick your own' },
                { step: '03', title: 'Download', desc: 'Save your favourite look as a JPEG' },
              ].map((item) => (
                <div key={item.step}>
                  <p className="text-[var(--accent)] text-xs tracking-[0.3em] font-medium mb-3">
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
            }}
            className="text-zinc-400 hover:text-white text-sm flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <h1 className="font-serif text-white text-lg tracking-tight">
            Colour <span className="italic text-zinc-400">Try-On</span>
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
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-[var(--accent)] rounded-full animate-spin" />
            <span className="text-sm font-light">Loading hair detection model...</span>
          </div>
        )}

        {/* Preview area */}
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
                hidden
                onFacingModeChange={(m) => { facingModeRef.current = m; }}
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

        {/* Color controls panel */}
        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          <ColorPalette
            selectedHex={colorHex}
            selectedName={colorName}
            intensity={intensity}
            onColorChange={handleColorChange}
            onIntensityChange={setIntensity}
          />
        </div>

        {/* Download */}
        <ResultActions onDownload={handleDownload} />

        {/* Mode switch */}
        <div className="flex justify-center gap-6 pb-6">
          {mode === 'camera' ? (
            <button
              onClick={startUpload}
              className="text-zinc-500 hover:text-[var(--accent)] text-sm transition-colors"
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
                  className="text-zinc-500 hover:text-[var(--accent)] text-sm transition-colors"
                >
                  Change photo
                </button>
              )}
              <button
                onClick={startCamera}
                className="text-zinc-500 hover:text-[var(--accent)] text-sm transition-colors"
              >
                Use camera instead
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
