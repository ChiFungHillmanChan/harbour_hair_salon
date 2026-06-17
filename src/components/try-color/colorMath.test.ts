import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESET_COLORS } from './constants';
import { refineHairMask, type HairMaskData } from './HairSegmentation';
import {
  analyzeHair,
  applyRecolorToImageDataWithAlpha,
  hexToLinearRgb,
  linearRgbToRgb,
  resolveRecolorContext,
} from './colorMath';

function perceivedLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function createSolidImageData(
  colors: Array<[number, number, number]>,
  alphaMask?: number[],
  dims?: { width: number; height: number },
): { imageData: ImageData; mask: Float32Array } {
  const data = new Uint8ClampedArray(colors.length * 4);

  colors.forEach(([r, g, b], index) => {
    const offset = index * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  });

  return {
    imageData: {
      data,
      width: dims?.width ?? colors.length,
      height: dims?.height ?? 1,
    } as ImageData,
    mask: new Float32Array(alphaMask ?? new Array(colors.length).fill(1)),
  };
}

function createHairMaskData(
  imageData: ImageData,
  alphaMask?: number[],
  coreMask?: number[],
  fringeMask?: number[],
): HairMaskData {
  const size = imageData.width * imageData.height;
  const alpha = new Float32Array(alphaMask ?? new Array(size).fill(1));
  return {
    alphaMask: alpha,
    coreMask: new Float32Array(coreMask ?? Array.from(alpha, (value) => (value >= 0.6 ? value : 0))),
    fringeMask: new Float32Array(fringeMask ?? Array.from(alpha, (value) => (value > 0 && value < 0.6 ? value : 0))),
    width: imageData.width,
    height: imageData.height,
  };
}

test('linear sRGB round-trip stays within one code value', () => {
  const rgb = linearRgbToRgb(hexToLinearRgb('#b87333'));
  assert.ok(Math.abs(rgb[0] - 184) <= 1);
  assert.ok(Math.abs(rgb[1] - 115) <= 1);
  assert.ok(Math.abs(rgb[2] - 51) <= 1);
});

test('hair analysis maps dark and light samples to expected levels', () => {
  const darkSample = createSolidImageData([[22, 15, 10]]);
  const lightSample = createSolidImageData([[231, 219, 198]]);

  const darkAnalysis = analyzeHair(darkSample.imageData, darkSample.mask);
  const lightAnalysis = analyzeHair(lightSample.imageData, lightSample.mask);

  assert.ok(darkAnalysis.estimatedBaseLevel <= 2);
  assert.ok(lightAnalysis.estimatedBaseLevel >= 9);
});

test('preset strategies resolve deposit, tone, and lift modes correctly', () => {
  const analysis = {
    meanLuminance: 0.28,
    p95Luminance: 0.36,
    chroma: 0.18,
    warmCoolBias: 0.1,
    estimatedBaseLevel: 5 as const,
    confidence: 1,
  };

  const black = PRESET_COLORS.find((preset) => preset.name === 'Natural Black');
  const copper = PRESET_COLORS.find((preset) => preset.name === 'Copper');
  const platinum = PRESET_COLORS.find((preset) => preset.name === 'Platinum Blonde');

  assert.ok(black);
  assert.ok(copper);
  assert.ok(platinum);

  const deposit = resolveRecolorContext(
    { preset: black!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );
  const tone = resolveRecolorContext(
    { preset: copper!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );
  const lift = resolveRecolorContext(
    { preset: platinum!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );

  assert.equal(deposit.achievedLevel, 1);
  assert.equal(tone.achievedLevel, 6);
  assert.equal(lift.achievedLevel, 9);
  assert.equal(lift.constrained, true);
});

test('manual base level override wins over auto estimate', () => {
  const platinum = PRESET_COLORS.find((preset) => preset.name === 'Platinum Blonde');
  assert.ok(platinum);

  const analysis = {
    meanLuminance: 0.18,
    p95Luminance: 0.24,
    chroma: 0.12,
    warmCoolBias: 0.15,
    estimatedBaseLevel: 4 as const,
    confidence: 1,
  };

  const resolved = resolveRecolorContext(
    {
      preset: platinum!,
      previewStrength: 70,
      baseLevelMode: 'manual',
      manualBaseLevel: 7,
    },
    analysis,
  );

  assert.equal(resolved.effectiveBaseLevel, 7);
  assert.equal(resolved.achievedLevel, 10);
});

test('unrealistic lift shows pre-lightening guidance', () => {
  const platinum = PRESET_COLORS.find((preset) => preset.name === 'Platinum Blonde');
  assert.ok(platinum);

  const analysis = {
    meanLuminance: 0.1,
    p95Luminance: 0.16,
    chroma: 0.1,
    warmCoolBias: 0.25,
    estimatedBaseLevel: 2 as const,
    confidence: 1,
  };

  const resolved = resolveRecolorContext(
    { preset: platinum!, previewStrength: 70, baseLevelMode: 'auto' },
    analysis,
  );

  assert.equal(resolved.achievedLevel, 6);
  assert.match(resolved.expectedResultNotice ?? '', /pre-lightening/i);
});

test('highlight preservation reduces recolor intensity on brightest pixels', () => {
  const caramel = PRESET_COLORS.find((preset) => preset.name === 'Caramel');
  assert.ok(caramel);

  const { imageData, mask } = createSolidImageData([
    [245, 230, 210],
    [110, 85, 60],
  ]);
  const hairMask = createHairMaskData(imageData, Array.from(mask));
  const before = new Uint8ClampedArray(imageData.data);

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: caramel!,
    previewStrength: 90,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const brightBeforeLum = perceivedLuminance(before[0], before[1], before[2]);
  const brightAfterLum = perceivedLuminance(
    imageData.data[0],
    imageData.data[1],
    imageData.data[2],
  );
  const shadowDelta =
    Math.abs(imageData.data[4] - before[4]) +
    Math.abs(imageData.data[5] - before[5]) +
    Math.abs(imageData.data[6] - before[6]);

  assert.ok(brightAfterLum >= brightBeforeLum * 0.9);
  assert.ok(shadowDelta > 0);
});

test('mask refinement fills pinholes and produces both core and fringe masks', () => {
  const { imageData } = createSolidImageData([
    [120, 90, 60],
    [125, 95, 63],
    [130, 100, 66],
    [135, 105, 69],
    [140, 110, 72],
    [145, 115, 75],
    [150, 120, 78],
    [155, 125, 81],
    [160, 130, 84],
  ], undefined, { width: 3, height: 3 });
  const rawMask = new Float32Array([
    0.72, 0.7, 0.68,
    0.7, 0.02, 0.45,
    0.66, 0.5, 0.18,
  ]);

  const refined = refineHairMask(imageData, rawMask);

  assert.ok(refined.alphaMask[4] > rawMask[4]);
  assert.ok(refined.coreMask.some((value) => value > 0));
  assert.ok(refined.fringeMask.some((value) => value > 0));
});

test('fringe pixels recolor less than core pixels for the same preset', () => {
  const copper = PRESET_COLORS.find((preset) => preset.name === 'Copper');
  assert.ok(copper);

  const { imageData } = createSolidImageData([
    [135, 105, 80],
    [135, 105, 80],
  ]);
  const before = new Uint8ClampedArray(imageData.data);
  const hairMask = createHairMaskData(
    imageData,
    [1, 0.45],
    [1, 0],
    [0, 1],
  );

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: copper!,
    previewStrength: 90,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const coreWarmShift = (imageData.data[0] - imageData.data[2]) - (before[0] - before[2]);
  const fringeWarmShift = (imageData.data[4] - imageData.data[6]) - (before[4] - before[6]);
  const sourceLum = perceivedLuminance(before[0], before[1], before[2]);
  const fringeLum = perceivedLuminance(imageData.data[4], imageData.data[5], imageData.data[6]);
  const coreLum = perceivedLuminance(imageData.data[0], imageData.data[1], imageData.data[2]);

  assert.ok(fringeWarmShift < coreWarmShift);
  assert.ok(Math.abs(fringeLum - sourceLum) <= Math.abs(coreLum - sourceLum) + 1);
});

test('shadow protection preserves more original color in dark regions than mid regions', () => {
  const caramel = PRESET_COLORS.find((preset) => preset.name === 'Caramel');
  assert.ok(caramel);

  const { imageData } = createSolidImageData([
    [45, 30, 20],
    [155, 120, 88],
  ]);
  const before = new Uint8ClampedArray(imageData.data);
  const hairMask = createHairMaskData(imageData);

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: caramel!,
    previewStrength: 90,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const darkDelta =
    Math.abs(imageData.data[0] - before[0]) +
    Math.abs(imageData.data[1] - before[1]) +
    Math.abs(imageData.data[2] - before[2]);
  const midDelta =
    Math.abs(imageData.data[4] - before[4]) +
    Math.abs(imageData.data[5] - before[5]) +
    Math.abs(imageData.data[6] - before[6]);

  assert.ok(darkDelta < midDelta);
});

test('root retention leaves upper hair less altered than lower hair', () => {
  const golden = PRESET_COLORS.find((preset) => preset.name === 'Golden Blonde');
  assert.ok(golden);

  const { imageData } = createSolidImageData([
    [125, 95, 70],
    [125, 95, 70],
    [125, 95, 70],
    [125, 95, 70],
  ], undefined, { width: 2, height: 2 });
  const before = new Uint8ClampedArray(imageData.data);
  const hairMask = createHairMaskData(imageData, [1, 1, 1, 1], [1, 1, 1, 1]);

  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: golden!,
    previewStrength: 85,
    baseLevelMode: 'manual',
    manualBaseLevel: 5,
  });

  const topDelta =
    Math.abs(imageData.data[0] - before[0]) +
    Math.abs(imageData.data[1] - before[1]) +
    Math.abs(imageData.data[2] - before[2]);
  const bottomDelta =
    Math.abs(imageData.data[8] - before[8]) +
    Math.abs(imageData.data[9] - before[9]) +
    Math.abs(imageData.data[10] - before[10]);

  assert.ok(topDelta < bottomDelta);
});

test('post-bleach mode bypasses the lift cap regardless of dark base', () => {
  const platinum = PRESET_COLORS.find((p) => p.name === 'Platinum Blonde');
  assert.ok(platinum);
  const analysis = {
    meanLuminance: 0.1, p95Luminance: 0.16, chroma: 0.1,
    warmCoolBias: 0.25, estimatedBaseLevel: 2 as const, confidence: 1,
  };
  const resolved = resolveRecolorContext(
    { preset: platinum!, previewStrength: 70, baseLevelMode: 'auto', bleachState: 'post' },
    analysis,
  );
  assert.equal(resolved.achievedLevel, 10);
  assert.equal(resolved.constrained, false);
  assert.equal(resolved.expectedResultNotice, null);
});

test('post-bleach renders a vivid target on dark hair; pre-bleach mutes it', () => {
  const blue = PRESET_COLORS.find((p) => p.name === 'Blue');
  assert.ok(blue);
  function recolouredChroma(bleachState: 'pre' | 'post'): number {
    const { imageData, mask } = createSolidImageData([[28, 20, 14]]);
    const hairMask = createHairMaskData(imageData, Array.from(mask));
    applyRecolorToImageDataWithAlpha(imageData, hairMask, {
      preset: blue!, previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 2, bleachState,
    });
    const [r, g, b] = [imageData.data[0], imageData.data[1], imageData.data[2]];
    return Math.max(r, g, b) - Math.min(r, g, b);
  }
  const post = recolouredChroma('post');
  const pre = recolouredChroma('pre');
  assert.ok(post > pre + 20, `expected post (${post}) much more vivid than pre (${pre})`);
  assert.ok(post > 40, `expected post chroma vivid, got ${post}`);
});

test('pre-bleach mutes a vivid cool target on dark hair (deposit reality)', () => {
  const blue = PRESET_COLORS.find((p) => p.name === 'Blue');
  assert.ok(blue);
  const { imageData, mask } = createSolidImageData([[30, 22, 16]]);
  const hairMask = createHairMaskData(imageData, Array.from(mask));
  applyRecolorToImageDataWithAlpha(imageData, hairMask, {
    preset: blue!, previewStrength: 100, baseLevelMode: 'manual', manualBaseLevel: 2, bleachState: 'pre',
  });
  const [r, g, b] = [imageData.data[0], imageData.data[1], imageData.data[2]];
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(chroma < 35, `expected muted chroma on dark hair, got ${chroma}`);
  assert.ok(lum < 90, `expected result to stay dark, got ${lum}`);
});
