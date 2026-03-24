'use client';

import { useRef, useState } from 'react';

interface UploadDropzoneProps {
  onImageLoaded: (image: HTMLImageElement) => void;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = (file: File) => {
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File is too large. Please use an image under 10MB.');
      return;
    }

    const img = new Image();
    img.onload = () => {
      const resized = resizeImage(img);
      const resizedImg = new Image();
      resizedImg.onload = () => onImageLoaded(resizedImg);
      resizedImg.src = resized.toDataURL('image/jpeg', 0.9);
    };
    img.onerror = () => setError('Could not read this image. Try another file.');
    img.src = URL.createObjectURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  return (
    <div
      className={`w-full aspect-[4/3] border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer ${
        dragging
          ? 'border-[var(--accent)] bg-zinc-800/50'
          : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <svg
        className="w-12 h-12 text-zinc-500"
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
      <p className="text-zinc-400 text-sm">
        Drop a photo here or <span className="text-[var(--accent)]">browse</span>
      </p>
      <p className="text-zinc-600 text-xs">JPEG, PNG, or WebP up to 10MB</p>

      {error && (
        <p className="text-red-400 text-sm mt-2">{error}</p>
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
