// src/app/try-color/TryColorClient.tsx
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

  const previewRef = useRef<PreviewCanvasHandle>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorRef = useRef({ hex: colorHex, intensity });
  const frameTimesRef = useRef<number[]>([]);

  // Upload mode: store original image data and mask for re-coloring on color change
  const uploadDataRef = useRef<{
    originalImageData: ImageData;
    mask: Uint8Array;
    width: number;
    height: number;
  } | null>(null);

  // Keep refs in sync with state for the frame callback
  useEffect(() => {
    colorRef.current = { hex: colorHex, intensity };
  }, [colorHex, intensity]);

  // Initialize worker
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

        // Track frame times for performance fallback
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

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Handle camera frame — send to worker
  const handleFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!workerRef.current || !workerReady) return;

      // Update dimensions on first frame
      if (
        video.videoWidth !== dimensions.width ||
        video.videoHeight !== dimensions.height
      ) {
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
      }

      // Capture frame as ImageBitmap and send to worker
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

  // Handle uploaded image — main-thread segmentation (stores mask for re-coloring)
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

        // Store originals for re-coloring when user changes color/intensity
        uploadDataRef.current = {
          originalImageData,
          mask: maskData,
          width: img.width,
          height: img.height,
        };

        // Apply initial color
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
        previewRef.current?.drawImageData(coloredData, img.width, img.height);
      } catch (err) {
        setError(
          'Could not process this image. Try a different photo.',
        );
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [colorHex, intensity],
  );

  // Re-apply color to upload preview when color or intensity changes
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
  };

  const handleColorChange = (hex: string, name: string | null) => {
    setColorHex(hex);
    setColorName(name);
  };

  // Landing page
  if (mode === 'landing') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
        <div className="w-12 h-[2px] bg-[var(--accent)] mx-auto mb-6" />
        <h1 className="text-5xl md:text-6xl font-serif mb-4 tracking-tight text-zinc-900">
          Virtual Hair Color{' '}
          <span className="italic text-zinc-500">Try-On</span>
        </h1>
        <p className="text-lg text-zinc-500 mb-10 max-w-md font-light">
          See how a new colour looks on you — live
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <button
            onClick={startCamera}
            className="bg-[#174F7F] text-white px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-[#123c61] transition-colors duration-300 rounded-lg"
          >
            Open Camera
          </button>
          <button
            onClick={startUpload}
            className="border border-zinc-300 text-zinc-700 px-10 py-4 text-sm uppercase tracking-[0.2em] font-bold hover:bg-zinc-100 transition-colors duration-300 rounded-lg"
          >
            Upload Photo
          </button>
        </div>

        <div className="space-y-2 text-xs text-zinc-400 max-w-sm">
          <p>Your photos are processed entirely on your device and never leave your browser.</p>
          <p>Preview only. Very light shades may look different in salon.</p>
        </div>
      </div>
    );
  }

  // Camera or Upload mode
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      {/* Back button */}
      <button
        onClick={() => {
          workerRef.current?.terminate();
          workerRef.current = null;
          setWorkerReady(false);
          setMode('landing');
          setError(null);
        }}
        className="text-zinc-500 hover:text-zinc-800 text-sm flex items-center gap-1 transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-8 text-zinc-500">
          <div className="w-5 h-5 border-2 border-zinc-300 border-t-[#174F7F] rounded-full animate-spin" />
          <span className="text-sm">Loading hair detection model...</span>
        </div>
      )}

      {/* Preview area */}
      <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
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
            {/* Overlay the preview canvas on top of the camera */}
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

        {mode === 'upload' && !previewRef.current?.getCanvas()?.width && (
          <UploadDropzone onImageLoaded={handleImageLoaded} />
        )}

        {mode === 'upload' && (
          <div className={loading ? 'hidden' : ''}>
            <PreviewCanvas
              ref={previewRef}
              width={dimensions.width}
              height={dimensions.height}
            />
          </div>
        )}
      </div>

      {/* Color controls */}
      <div className="bg-zinc-900 rounded-lg p-4">
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
      <div className="text-center">
        {mode === 'camera' ? (
          <button
            onClick={startUpload}
            className="text-zinc-500 hover:text-zinc-700 text-sm underline transition-colors"
          >
            Or upload a photo instead
          </button>
        ) : (
          <button
            onClick={startCamera}
            className="text-zinc-500 hover:text-zinc-700 text-sm underline transition-colors"
          >
            Or use your camera instead
          </button>
        )}
      </div>
    </div>
  );
}
