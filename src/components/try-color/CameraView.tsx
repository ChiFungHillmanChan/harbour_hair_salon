// src/components/try-color/CameraView.tsx
'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface CameraViewProps {
  onFrame: (video: HTMLVideoElement) => void;
  onError: (error: string) => void;
  active: boolean;
}

export function CameraView({ onFrame, onError, active }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  // Stable refs for callbacks to avoid re-triggering effects on parent re-renders
  const onFrameRef = useRef(onFrame);
  const onErrorRef = useRef(onError);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Start/stop camera based on active prop and facingMode
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

  // Frame capture loop — prefer requestVideoFrameCallback for efficiency
  useEffect(() => {
    if (!active) return;

    const video = videoRef.current;
    if (!video) return;

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const onVideoFrame = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          onFrameRef.current(video);
        }
        rafRef.current = video.requestVideoFrameCallback(onVideoFrame);
      };
      rafRef.current = video.requestVideoFrameCallback(onVideoFrame);
      return () => video.cancelVideoFrameCallback(rafRef.current);
    }

    const captureLoop = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        onFrameRef.current(video);
      }
      rafRef.current = requestAnimationFrame(captureLoop);
    };
    rafRef.current = requestAnimationFrame(captureLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);

  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  return (
    <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        playsInline
        muted
        autoPlay
      />

      {/* Flip camera button */}
      <button
        onClick={flipCamera}
        className="absolute top-3 right-3 bg-black/60 text-white p-2 rounded-full hover:bg-black/80 transition-colors"
        aria-label="Flip camera"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>

      {/* LIVE badge */}
      <div className="absolute top-3 left-3 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded">
        LIVE
      </div>
    </div>
  );
}
