// src/components/try-color/CameraView.tsx
'use client';

import { useRef, useEffect, useState } from 'react';
import { LIVE_TARGET_FPS } from './constants';

interface CameraViewProps {
  onFrame: (video: HTMLVideoElement) => void;
  onError: (error: string) => void;
  active: boolean;
  /** Hide the video element; stream stays active for frame capture */
  hidden?: boolean;
  /** Called when the user flips between front/back camera */
  onFacingModeChange?: (mode: 'user' | 'environment') => void;
}

export function CameraView({ onFrame, onError, active, hidden, onFacingModeChange }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameTimeRef = useRef(0);
  const frameIntervalMs = 1000 / LIVE_TARGET_FPS;

  // Stable refs for callbacks
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Start/stop camera
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    (async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Camera error:', err);
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera access was denied. You can upload a photo instead.'
            : err instanceof DOMException && err.name === 'NotFoundError'
              ? 'No camera found on this device. You can upload a photo instead.'
              : err instanceof DOMException && err.name === 'AbortError'
                ? 'Camera was interrupted. Try again.'
                : `Camera error: ${err instanceof Error ? err.message : String(err)}`;
        onErrorRef.current(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [active, facingMode]);

  // Frame capture loop — throttled to LIVE_TARGET_FPS
  useEffect(() => {
    if (!active) return;

    const video = videoRef.current;
    if (!video) return;

    const throttledDispatch = () => {
      const now = performance.now();
      if (now - lastFrameTimeRef.current >= frameIntervalMs) {
        lastFrameTimeRef.current = now;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          onFrameRef.current(video);
        }
      }
    };

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const onVideoFrame = () => {
        throttledDispatch();
        rafRef.current = video.requestVideoFrameCallback(onVideoFrame);
      };
      rafRef.current = video.requestVideoFrameCallback(onVideoFrame);
      return () => video.cancelVideoFrameCallback(rafRef.current);
    }

    const captureLoop = () => {
      throttledDispatch();
      rafRef.current = requestAnimationFrame(captureLoop);
    };
    rafRef.current = requestAnimationFrame(captureLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, frameIntervalMs]);

  const flipCamera = () => {
    setFacingMode((prev) => {
      const next = prev === 'user' ? 'environment' : 'user';
      onFacingModeChange?.(next);
      return next;
    });
  };

  return (
    <div className={`relative w-full h-full ${hidden ? '' : 'bg-black'}`}>
      <video
        ref={videoRef}
        className={`w-full h-full object-cover ${hidden ? 'opacity-0 pointer-events-none' : ''}`}
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        playsInline
        muted
        autoPlay
      />

      {/* Flip camera */}
      <button
        onClick={flipCamera}
        className="absolute top-3 right-3 z-20 bg-black/50 backdrop-blur-sm text-white p-2.5 rounded-full hover:bg-black/70 transition-all duration-300 border border-white/10"
        aria-label="Flip camera"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      {/* Live indicator */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/10">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-white text-[10px] font-bold tracking-wider uppercase">Live</span>
      </div>
    </div>
  );
}
