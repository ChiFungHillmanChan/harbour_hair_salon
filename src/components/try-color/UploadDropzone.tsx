'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';
import { rich } from '@/i18n/rich';

interface UploadDropzoneProps {
  onImageLoaded: (image: HTMLImageElement | HTMLCanvasElement) => void;
}

const MAX_SIZE = 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function resizeImage(img: HTMLImageElement): HTMLCanvasElement {
  let { width, height } = img;
  if (width > MAX_SIZE || height > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

export function UploadDropzone({ onImageLoaded }: UploadDropzoneProps) {
  const t = useT('tryColor');
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingLoadRef = useRef<{ image: HTMLImageElement; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const cancelPendingLoad = useCallback(() => {
    const pending = pendingLoadRef.current;
    if (!pending) return;
    pendingLoadRef.current = null;
    pending.image.onload = null;
    pending.image.onerror = null;
    pending.image.src = '';
    URL.revokeObjectURL(pending.url);
  }, []);

  useEffect(() => cancelPendingLoad, [cancelPendingLoad]);

  const processFile = (file: File) => {
    // A replacement invalidates the previous decode even if it fails validation.
    cancelPendingLoad();
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('upload.wrongType'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(t('upload.tooLarge'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    const pending = { image: img, url: objectUrl };
    pendingLoadRef.current = pending;
    img.onload = () => {
      if (pendingLoadRef.current !== pending) return;
      // Release cancellation ownership before the parent can unmount us. Its
      // asynchronous segmentation still needs this successfully decoded image.
      pendingLoadRef.current = null;
      img.onload = null;
      img.onerror = null;
      try {
        if (img.width > MAX_SIZE || img.height > MAX_SIZE) {
          onImageLoaded(resizeImage(img));
        } else {
          onImageLoaded(img);
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      if (pendingLoadRef.current !== pending) return;
      cancelPendingLoad();
      setError(t('upload.unreadable'));
    };
    img.src = objectUrl;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('upload.title')}
      className={`w-full h-full min-h-80 border border-dashed rounded-lg flex flex-col items-center justify-center gap-5 px-4 py-6 text-center transition-all duration-300 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        dragging
          ? 'border-white/30 bg-white/5'
          : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50'
      }`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
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
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-white font-serif text-lg mb-1">{t('upload.title')}</p>
        <p className="text-zinc-500 text-sm">
          {rich(t('upload.dropOrBrowse'), {
            browse: (text) => <span className="text-zinc-300 hover:underline">{text}</span>,
          })}
        </p>
      </div>
      <p className="text-zinc-600 text-xs tracking-wider uppercase">
        {t('upload.formats')}
      </p>

      {error && (
        <p className="text-red-400 text-sm px-4 text-center">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
        }}
        className="hidden"
      />
    </div>
  );
}
