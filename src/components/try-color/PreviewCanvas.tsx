'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

export interface PreviewCanvasHandle {
  drawBitmap: (bitmap: ImageBitmap) => void;
  drawImageData: (data: ImageData, width: number, height: number) => void;
  downloadJpeg: () => void;
  getCanvas: () => HTMLCanvasElement | null;
}

interface PreviewCanvasProps {
  width: number;
  height: number;
  mirrored?: boolean;
}

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(
  function PreviewCanvas({ width, height, mirrored = false }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
    }, [width, height]);

    useImperativeHandle(ref, () => ({
      drawBitmap(bitmap: ImageBitmap) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        if (mirrored) {
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(bitmap, -canvas.width, 0, canvas.width, canvas.height);
          ctx.restore();
        } else {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        }
        bitmap.close();
      },

      drawImageData(data: ImageData, w: number, h: number) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(data, 0, 0);
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
        className="w-full h-full object-cover rounded-lg"
      />
    );
  },
);
