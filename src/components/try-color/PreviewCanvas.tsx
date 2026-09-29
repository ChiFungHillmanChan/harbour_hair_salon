'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

export interface PreviewCanvasHandle {
  drawBitmap: (bitmap: ImageBitmap) => void;
  drawImageData: (data: ImageData, width: number, height: number) => void;
  clearCanvas: () => void;
  downloadJpeg: () => void;
  getCanvas: () => HTMLCanvasElement | null;
}

interface PreviewCanvasProps {
  width: number;
  height: number;
  /** CSS-level mirroring (GPU-accelerated, replaces per-frame canvas flip) */
  mirrored?: boolean;
  /** CSS mix-blend-mode — use 'color' for overlay-on-video compositing */
  blendMode?: React.CSSProperties['mixBlendMode'];
}

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(
  function PreviewCanvas({ width, height, mirrored = false, blendMode }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      ctxRef.current = canvas.getContext('2d');
    }, [width, height]);

    useImperativeHandle(ref, () => ({
      drawBitmap(bitmap: ImageBitmap) {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas) { bitmap.close(); return; }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
      },

      drawImageData(data: ImageData, w: number, h: number) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          ctxRef.current = canvas.getContext('2d');
        }
        ctxRef.current?.putImageData(data, 0, 0);
      },

      clearCanvas() {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },

      downloadJpeg() {
        const canvas = canvasRef.current;
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
      },

      getCanvas() {
        return canvasRef.current;
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain rounded-lg"
        style={{
          ...(mirrored && { transform: 'scaleX(-1)' }),
          ...(blendMode && { mixBlendMode: blendMode }),
        }}
      />
    );
  },
);
