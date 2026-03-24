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
import { segmentStill } from '@/components/try-color/HairSegmentation';
import { applyRecolorToImageData } from '@/components/try-color/colorMath';
import {
  PRESET_COLORS,
  DEFAULT_INTENSITY,
  HAIR_CATEGORY_INDEX,
  SLOW_FRAME_THRESHOLD_MS,
  SLOW_FRAME_WINDOW,
  WARMUP_FRAMES,
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

  const uploadDataRef = useRef<{
    originalImageData: ImageData;
    mask: Uint8Array;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    colorRef.current = { hex: colorHex, intensity };
  }, [colorHex, intensity]);

  const initWorker = useCallback(() => {
    if (workerRef.current) return;

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
        const { bitmap, elapsed } = e.data;
        previewRef.current?.drawBitmap(bitmap);
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
            worker.terminate();
            workerRef.current = null;
          }
        }
      }
    };

    worker.postMessage({ type: 'init' });
    workerRef.current = worker;
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!workerRef.current || !workerReady) return;

      if (
        video.videoWidth !== dimensions.width ||
        video.videoHeight !== dimensions.height
      ) {
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      createImageBitmap(video).then((bitmap) => {
        const { hex, intensity: int } = colorRef.current;
        workerRef.current?.postMessage(
          {
            type: 'segment',
            frame: bitmap,
            colorHex: hex,
            intensity: int,
            timestamp: performance.now(),
          },
          [bitmap],
        );
      });
    },
    [workerReady, dimensions.width, dimensions.height],
  );

  const handleImageLoaded = useCallback(
    async (img: HTMLImageElement) => {
      setLoading(true);
      setError(null);
      try {
        const maskData = await segmentStill(img);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const originalImageData = ctx.getImageData(0, 0, img.width, img.height);

        uploadDataRef.current = {
          originalImageData,
          mask: maskData,
          width: img.width,
          height: img.height,
        };

        const coloredData = new ImageData(
          new Uint8ClampedArray(originalImageData.data),
          img.width,
          img.height,
        );
        applyRecolorToImageData(
          coloredData,
          maskData,
          colorHex,
          intensity,
          HAIR_CATEGORY_INDEX,
        );

        setDimensions({ width: img.width, height: img.height });
        setHasUploadedImage(true);
        previewRef.current?.drawImageData(coloredData, img.width, img.height);
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
    const { originalImageData, mask, width, height } = uploadDataRef.current;
    const coloredData = new ImageData(
      new Uint8ClampedArray(originalImageData.data),
      width,
      height,
    );
    applyRecolorToImageData(coloredData, mask, colorHex, intensity, HAIR_CATEGORY_INDEX);
    previewRef.current?.drawImageData(coloredData, width, height);
  }, [colorHex, intensity, mode]);

  const startCamera = () => {
    setError(null);
    setMode('camera');
    initWorker();
  };

  const startUpload = () => {
    setError(null);
    setMode('upload');
    setHasUploadedImage(false);
    uploadDataRef.current = null;
  };

  const handleColorChange = (hex: string, name: string | null) => {
    setColorHex(hex);
    setColorName(name);
  };

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
                { step: '02', title: 'Explore', desc: 'Browse 12 preset colours or pick your own' },
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
              workerRef.current?.terminate();
              workerRef.current = null;
              setWorkerReady(false);
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
                  setError(msg);
                  setMode('upload');
                }}
                active={mode === 'camera'}
              />
              <div className="absolute inset-0">
                <PreviewCanvas
                  ref={previewRef}
                  width={dimensions.width}
                  height={dimensions.height}
                  mirrored
                />
              </div>
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
        <ResultActions onDownload={() => previewRef.current?.downloadJpeg()} />

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
