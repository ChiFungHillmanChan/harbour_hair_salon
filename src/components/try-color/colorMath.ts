// src/components/try-color/colorMath.ts

/** Parse "#rrggbb" to [r, g, b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** RGB (0-255) → HSL (h: 0-360, s: 0-1, l: 0-1). */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

/** HSL (h: 0-360, s: 0-1, l: 0-1) → RGB (0-255). */
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Recolor a single pixel: keep original luminance, shift hue/saturation
 * toward the target color by the given intensity (0-100).
 */
export function recolorPixel(
  r: number,
  g: number,
  b: number,
  targetH: number,
  targetS: number,
  intensity: number,
): [number, number, number] {
  const t = intensity / 100;
  const [origH, origS, origL] = rgbToHsl(r, g, b);
  const newH = origH + (targetH - origH) * t;
  const newS = origS + (targetS - origS) * t;
  return hslToRgb(newH, newS, origL);
}

/**
 * Apply recolor to an ImageData using a Uint8Array category mask.
 * Modifies imageData pixels in-place. hairCategory is the mask value
 * that indicates hair pixels.
 */
export function applyRecolorToImageData(
  imageData: ImageData,
  maskData: Uint8Array,
  targetHex: string,
  intensity: number,
  hairCategory: number,
): void {
  const [tR, tG, tB] = hexToRgb(targetHex);
  const [targetH, targetS] = rgbToHsl(tR, tG, tB);
  const pixels = imageData.data;
  for (let i = 0; i < maskData.length; i++) {
    if (maskData[i] !== hairCategory) continue;
    const idx = i * 4;
    const [nr, ng, nb] = recolorPixel(
      pixels[idx],
      pixels[idx + 1],
      pixels[idx + 2],
      targetH,
      targetS,
      intensity,
    );
    pixels[idx] = nr;
    pixels[idx + 1] = ng;
    pixels[idx + 2] = nb;
  }
}
