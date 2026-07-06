'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  segmentStill,
  type HairMaskData,
} from '@/components/try-color/HairSegmentation';
import { applyRecolorToImageDataWithAlpha } from '@/components/try-color/colorMath';
import {
  SLOW_FRAME_THRESHOLD_MS,
  VIDEO_MAX_DIM,
  VIDEO_MAX_FILE_BYTES,
  VIDEO_MAX_FRAMES,
  VIDEO_MAX_SECONDS,
  VIDEO_TARGET_FPS,
  type RecolorRequest,
} from '@/components/try-color/constants';

interface VideoTryOnProps {
  /** Current recolour parameters from the parent (preset + strength + level + bleach). */
  request: RecolorRequest;
}

/** A single decoded frame: SOURCE pixels + its hair mask. Never mutate `source`. */
interface StoredFrame {
  source: ImageData;
  mask: HairMaskData;
}

type Phase = 'idle' | 'extracting' | 'ready' | 'error';

const FRAME_INTERVAL_MS = 1000 / VIDEO_TARGET_FPS;
// A clip is "too slow" if a majority of frames exceed the per-frame budget.
const SLOW_FRAME_MAJORITY = 0.5;

function loadVideoMetadata(file: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error('Could not read this video file.'));
    video.src = file;
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('Could not read a frame from this video.'));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

export function VideoTryOn({ request }: VideoTryOnProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const framesRef = useRef<StoredFrame[]>([]);
  const requestRef = useRef<RecolorRequest>(request);
  const currentFrameRef = useRef(0);
  const playRafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const extractGenRef = useRef(0);

  // Keep the latest request in a ref so the playback loop reads fresh values.
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  // Paint a single stored frame: copy its source, recolour the COPY, draw it.
  const renderFrame = useCallback((index: number) => {
    const frame = framesRef.current[index];
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;

    if (canvas.width !== frame.source.width || canvas.height !== frame.source.height) {
      canvas.width = frame.source.width;
      canvas.height = frame.source.height;
      ctxRef.current = canvas.getContext('2d');
    }
    const ctx = ctxRef.current ?? canvas.getContext('2d');
    ctxRef.current = ctx;
    if (!ctx) return;

    const copy = new ImageData(
      new Uint8ClampedArray(frame.source.data),
      frame.source.width,
      frame.source.height,
    );
    applyRecolorToImageDataWithAlpha(copy, frame.mask, requestRef.current);
    ctx.putImageData(copy, 0, 0);
  }, []);

  // Re-render the visible frame whenever the recolour request changes.
  useEffect(() => {
    if (phase !== 'ready') return;
    renderFrame(currentFrameRef.current);
  }, [request, phase, renderFrame]);

  const stopPlayback = useCallback(() => {
    if (playRafRef.current !== null) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    setPlaying(false);
  }, []);

  // Playback loop: advance frames at VIDEO_TARGET_FPS, looping.
  useEffect(() => {
    if (!playing || phase !== 'ready') return;
    lastTickRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      if (now - lastTickRef.current >= FRAME_INTERVAL_MS) {
        lastTickRef.current = now;
        const total = framesRef.current.length;
        const next = total > 0 ? (currentFrameRef.current + 1) % total : 0;
        currentFrameRef.current = next;
        setCurrentFrame(next);
        renderFrame(next);
      }
      playRafRef.current = requestAnimationFrame(tick);
    };

    playRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (playRafRef.current !== null) {
        cancelAnimationFrame(playRafRef.current);
        playRafRef.current = null;
      }
    };
  }, [playing, phase, renderFrame]);

  const resetState = useCallback(() => {
    stopPlayback();
    framesRef.current = [];
    currentFrameRef.current = 0;
    setCurrentFrame(0);
    setFrameCount(0);
    setProgress(0);
    setError(null);
  }, [stopPlayback]);

  const extractFrames = useCallback(
    async (file: File) => {
      const gen = ++extractGenRef.current;
      resetState();
      setPhase('extracting');

      const objectUrl = URL.createObjectURL(file);
      let video: HTMLVideoElement | null = null;
      try {
        video = await loadVideoMetadata(objectUrl);
        if (gen !== extractGenRef.current) return;

        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error('Could not read this video file.');
        }
        if (duration > VIDEO_MAX_SECONDS + 0.5) {
          throw new Error(
            `Clip is too long. Please use a video under ${VIDEO_MAX_SECONDS} seconds.`,
          );
        }

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) throw new Error('Could not read this video file.');

        const scale = Math.min(1, VIDEO_MAX_DIM / Math.max(vw, vh));
        const fw = Math.max(1, Math.round(vw * scale));
        const fh = Math.max(1, Math.round(vh * scale));

        const work = document.createElement('canvas');
        work.width = fw;
        work.height = fh;
        const workCtx = work.getContext('2d', { willReadFrequently: true });
        if (!workCtx) throw new Error('Your browser cannot process video frames.');

        const frameInterval = 1 / VIDEO_TARGET_FPS;
        const plannedFrames = Math.min(
          VIDEO_MAX_FRAMES,
          Math.max(1, Math.floor(duration * VIDEO_TARGET_FPS)),
        );

        const frames: StoredFrame[] = [];
        let slowFrames = 0;

        for (let i = 0; i < plannedFrames; i++) {
          const t = Math.min(duration - 1e-3, i * frameInterval);
          await seekTo(video, t);
          if (gen !== extractGenRef.current) return;

          const startedAt = performance.now();
          workCtx.drawImage(video, 0, 0, fw, fh);

          // SAME still-segmentation the photo path uses.
          const mask = await segmentStill(work);
          if (gen !== extractGenRef.current) return;

          const source = workCtx.getImageData(0, 0, fw, fh);
          frames.push({ source, mask });

          const elapsed = performance.now() - startedAt;
          if (elapsed > SLOW_FRAME_THRESHOLD_MS) slowFrames++;

          // Slow-device fallback: bail once enough frames have been measured
          // and a majority are over budget (mirrors the live-camera fallback).
          if (
            i >= 4 &&
            slowFrames / (i + 1) > SLOW_FRAME_MAJORITY
          ) {
            throw new Error(
              'This device is too slow to process video. Try uploading a photo instead.',
            );
          }

          setProgress(Math.round(((i + 1) / plannedFrames) * 100));
        }

        if (frames.length === 0) {
          throw new Error('No frames could be extracted from this video.');
        }

        framesRef.current = frames;
        currentFrameRef.current = 0;
        setFrameCount(frames.length);
        setCurrentFrame(0);
        setDimensions({ width: fw, height: fh });
        setPhase('ready');
        // Defer first paint until the visible canvas is mounted.
        requestAnimationFrame(() => {
          if (gen === extractGenRef.current) renderFrame(0);
        });
      } catch (err) {
        if (gen !== extractGenRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not process this video.');
        setPhase('error');
      } finally {
        URL.revokeObjectURL(objectUrl);
        if (video) video.src = '';
      }
    },
    [renderFrame, resetState],
  );

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      if (!file.type.startsWith('video/')) {
        setError('Please upload a video file.');
        setPhase('error');
        return;
      }
      if (file.size > VIDEO_MAX_FILE_BYTES) {
        const mb = Math.round(VIDEO_MAX_FILE_BYTES / (1024 * 1024));
        setError(`File is too large. Please use a video under ${mb}MB.`);
        setPhase('error');
        return;
      }
      void extractFrames(file);
    },
    [extractFrames],
  );

  const handleScrub = useCallback(
    (index: number) => {
      stopPlayback();
      currentFrameRef.current = index;
      setCurrentFrame(index);
      renderFrame(index);
    },
    [renderFrame, stopPlayback],
  );

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hair-color-video-frame-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      },
      'image/jpeg',
      0.9,
    );
  }, []);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const showDropzone = phase === 'idle' || phase === 'error';

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-950/50 border border-red-900/50 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="relative w-full aspect-[4/3] bg-black rounded-xl overflow-hidden border border-zinc-800 shadow-2xl shadow-black/50">
        {showDropzone && (
          <div
            className={`w-full h-full min-h-[280px] border border-dashed rounded-lg flex flex-col items-center justify-center gap-5 transition-all duration-300 cursor-pointer ${
              dragging
                ? 'border-white/30 bg-white/5'
                : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <div className="w-16 h-16 rounded-full border border-zinc-700 flex items-center justify-center">
              <svg
                className="w-7 h-7 text-zinc-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white font-serif text-lg mb-1">Upload Your Video</p>
              <p className="text-zinc-500 text-sm">
                Drop here or <span className="text-zinc-300 hover:underline">browse</span>
              </p>
            </div>
            <p className="text-zinc-600 text-xs tracking-wider uppercase">
              Max {VIDEO_MAX_SECONDS}s · Max {Math.round(VIDEO_MAX_FILE_BYTES / (1024 * 1024))}MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
              className="hidden"
            />
          </div>
        )}

        {phase === 'extracting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm font-light">
              Processing video… {progress}%
            </p>
            <div className="w-full max-w-xs h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {phase === 'ready' && (
          <canvas
            ref={canvasRef}
            width={dimensions.width || undefined}
            height={dimensions.height || undefined}
            className="w-full h-full object-cover rounded-lg"
          />
        )}
      </div>

      {phase === 'ready' && frameCount > 0 && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (playing ? stopPlayback() : setPlaying(true))}
              className="w-11 h-11 shrink-0 rounded-full bg-white text-zinc-900 flex items-center justify-center hover:bg-zinc-200 transition-colors"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={frameCount - 1}
              value={currentFrame}
              onChange={(e) => handleScrub(Number(e.target.value))}
              className="flex-1 accent-white"
              aria-label="Scrub frames"
            />
            <span className="text-zinc-500 text-xs tabular-nums w-16 text-right">
              {currentFrame + 1} / {frameCount}
            </span>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="w-full bg-white text-zinc-900 py-3 text-sm uppercase tracking-[0.15em] font-bold hover:bg-zinc-200 transition-all duration-300 hover:scale-[1.01] flex items-center justify-center gap-2 rounded-lg shadow-lg shadow-black/10"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download Frame
          </button>
        </div>
      )}
    </div>
  );
}
