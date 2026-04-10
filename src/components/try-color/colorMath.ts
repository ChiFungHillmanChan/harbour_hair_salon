// src/components/try-color/colorMath.ts

import {
  clampHairLevel,
  getHairLevelReferenceLuminance,
  getUnderlyingPigmentHex,
  type HairAnalysis,
  type HairLevel,
  type RecolorRequest,
  type ShadePreset,
} from './constants';
import type { HairMaskData } from './HairSegmentation';

type LinearRgb = [number, number, number];

export interface ResolvedRecolorContext {
  analysis: HairAnalysis;
  effectiveBaseLevel: HairLevel;
  achievedLevel: HairLevel;
  constrained: boolean;
  expectedResultNotice: string | null;
}

interface ResolvedShadeState extends ResolvedRecolorContext {
  requestedLift: number;
  achievedLift: number;
  resolvedRefL: number;
  targetLinear: LinearRgb;
  strength: number;
}

interface ApplyRecolorOptions {
  analysisOverride?: HairAnalysis;
}

interface MaskBounds {
  top: number;
  bottom: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(a: LinearRgb, b: LinearRgb, t: number): LinearRgb {
  return [
    mix(a[0], b[0], t),
    mix(a[1], b[1], t),
    mix(a[2], b[2], t),
  ];
}

function desaturateRgb(rgb: LinearRgb, amount: number): LinearRgb {
  const luminance = relativeLuminance(rgb);
  return mixRgb(rgb, [luminance, luminance, luminance], clamp01(amount));
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const clamped = clamp01(channel);
  const encoded = clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
  return Math.round(clamp01(encoded) * 255);
}

export function rgbToLinearRgb(r: number, g: number, b: number): LinearRgb {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function hexToLinearRgb(hex: string): LinearRgb {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLinearRgb(r, g, b);
}

export function linearRgbToRgb(rgb: LinearRgb): [number, number, number] {
  return [
    linearToSrgb(rgb[0]),
    linearToSrgb(rgb[1]),
    linearToSrgb(rgb[2]),
  ];
}

function relativeLuminance(rgb: LinearRgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function rgbChroma(rgb: LinearRgb): number {
  return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

function rgbWarmCoolBias(rgb: LinearRgb): number {
  const total = rgb[0] + rgb[1] + rgb[2] + 1e-6;
  return clamp01((rgb[0] - rgb[2]) / total + 0.5) * 2 - 1;
}

function withLuminance(rgb: LinearRgb, targetLuminance: number): LinearRgb {
  const desired = clamp01(targetLuminance);
  const current = relativeLuminance(rgb);

  if (current <= 1e-5) {
    return [desired, desired, desired];
  }

  const scaled: LinearRgb = [
    rgb[0] * (desired / current),
    rgb[1] * (desired / current),
    rgb[2] * (desired / current),
  ];

  const peak = Math.max(...scaled);
  if (peak <= 1) return scaled.map(clamp01) as LinearRgb;

  const normalized: LinearRgb = [
    scaled[0] / peak,
    scaled[1] / peak,
    scaled[2] / peak,
  ];
  const normalizedLum = relativeLuminance(normalized);
  if (normalizedLum <= 1e-5) return [desired, desired, desired];

  const factor = desired / normalizedLum;
  return [
    clamp01(normalized[0] * factor),
    clamp01(normalized[1] * factor),
    clamp01(normalized[2] * factor),
  ];
}

function estimateBaseLevelFromLuminance(meanLuminance: number): HairLevel {
  const midpoints = [
    [1, 0.085],
    [2, 0.12],
    [3, 0.17],
    [4, 0.24],
    [5, 0.33],
    [6, 0.44],
    [7, 0.565],
    [8, 0.695],
    [9, 0.82],
  ] as const;

  for (const [level, maxLuminance] of midpoints) {
    if (meanLuminance <= maxLuminance) return level;
  }
  return 10;
}

function computeConfidence(weightedCoverage: number, pixelCount: number): number {
  const coverage = pixelCount === 0 ? 0 : weightedCoverage / pixelCount;
  return clamp01(coverage / 0.1);
}

export function smoothHairAnalysis(
  previous: HairAnalysis,
  next: HairAnalysis,
  blend: number,
): HairAnalysis {
  const t = clamp01(blend);
  const meanLuminance = mix(previous.meanLuminance, next.meanLuminance, t);
  return {
    meanLuminance,
    p95Luminance: mix(previous.p95Luminance, next.p95Luminance, t),
    chroma: mix(previous.chroma, next.chroma, t),
    warmCoolBias: mix(previous.warmCoolBias, next.warmCoolBias, t),
    confidence: mix(previous.confidence, next.confidence, t),
    estimatedBaseLevel: estimateBaseLevelFromLuminance(meanLuminance),
  };
}

export function analyzeHair(
  imageData: ImageData,
  alphaMask: Float32Array,
): HairAnalysis {
  const pixels = imageData.data;
  const histogram = new Float32Array(256);
  let weightedCoverage = 0;
  let sumLuminance = 0;
  let sumChroma = 0;
  let sumWarmCoolBias = 0;

  for (let i = 0; i < alphaMask.length; i++) {
    const weight = clamp01(alphaMask[i]);
    if (weight <= 0.001) continue;

    const idx = i * 4;
    const rgb = rgbToLinearRgb(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    const luminance = relativeLuminance(rgb);

    weightedCoverage += weight;
    sumLuminance += luminance * weight;
    sumChroma += rgbChroma(rgb) * weight;
    sumWarmCoolBias += rgbWarmCoolBias(rgb) * weight;
    histogram[Math.min(255, Math.round(luminance * 255))] += weight;
  }

  if (weightedCoverage <= 0.001) {
    return {
      meanLuminance: getHairLevelReferenceLuminance(5),
      p95Luminance: getHairLevelReferenceLuminance(6),
      chroma: 0,
      warmCoolBias: 0,
      estimatedBaseLevel: 5,
      confidence: 0,
    };
  }

  const meanLuminance = sumLuminance / weightedCoverage;
  const p95Target = weightedCoverage * 0.95;
  let cumulative = 0;
  let p95Luminance = meanLuminance;

  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i];
    if (cumulative >= p95Target) {
      p95Luminance = i / 255;
      break;
    }
  }

  return {
    meanLuminance,
    p95Luminance,
    chroma: sumChroma / weightedCoverage,
    warmCoolBias: sumWarmCoolBias / weightedCoverage,
    estimatedBaseLevel: estimateBaseLevelFromLuminance(meanLuminance),
    confidence: computeConfidence(weightedCoverage, alphaMask.length),
  };
}

function buildExpectedResultNotice(
  preset: ShadePreset,
  effectiveBaseLevel: HairLevel,
  achievedLevel: HairLevel,
): string | null {
  if (preset.mode !== 'lift') return null;
  if (achievedLevel >= preset.targetLevel) return null;
  return `This shade usually needs pre-lightening from level ${effectiveBaseLevel} to reach ${preset.name}.`;
}

function resolveTargetLinear(
  preset: ShadePreset,
  effectiveBaseLevel: HairLevel,
  achievedLevel: HairLevel,
  analysis: HairAnalysis,
): LinearRgb {
  const presetLinear = hexToLinearRgb(preset.swatchHex);
  const pigmentLinear = hexToLinearRgb(getUnderlyingPigmentHex(achievedLevel));
  const requestedLift = Math.max(0, preset.targetLevel - effectiveBaseLevel);
  const achievedLift = Math.max(0, achievedLevel - effectiveBaseLevel);
  const liftRatio = requestedLift === 0 ? 1 : achievedLift / requestedLift;

  let undertoneMix = 0;
  if (preset.mode === 'lift') {
    undertoneMix = 0.18 + requestedLift * 0.07 + (1 - liftRatio) * 0.35;
  } else if (preset.mode === 'tone') {
    undertoneMix = 0.08;
  } else {
    undertoneMix = 0.03;
  }

  if (preset.undertoneBias === 'cool') undertoneMix += 0.08;
  if (preset.undertoneBias === 'warm') undertoneMix -= 0.04;
  undertoneMix += Math.max(0, analysis.warmCoolBias) * 0.05;

  return mixRgb(presetLinear, pigmentLinear, clamp01(undertoneMix));
}

function computeMaskBounds(mask: HairMaskData): MaskBounds {
  let top = mask.height;
  let bottom = -1;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const idx = y * mask.width + x;
      if (mask.alphaMask[idx] < 0.12) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (bottom === -1) {
    return { top: 0, bottom: mask.height - 1 };
  }

  return { top, bottom };
}

function deterministicVariation(index: number): number {
  const n = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

export function resolveRecolorContext(
  request: RecolorRequest,
  analysis: HairAnalysis,
): ResolvedShadeState {
  const effectiveBaseLevel =
    request.baseLevelMode === 'manual' && request.manualBaseLevel
      ? request.manualBaseLevel
      : analysis.estimatedBaseLevel;

  const requestedLift = Math.max(0, request.preset.targetLevel - effectiveBaseLevel);
  let achievedLevel = request.preset.targetLevel;

  if (request.preset.mode === 'lift') {
    achievedLevel = clampHairLevel(
      Math.min(request.preset.targetLevel, effectiveBaseLevel + request.preset.maxLiftWithoutBleach),
    );
  } else if (request.preset.mode === 'tone' && request.preset.targetLevel > effectiveBaseLevel + 1) {
    achievedLevel = clampHairLevel(
      Math.min(request.preset.targetLevel, effectiveBaseLevel + request.preset.maxLiftWithoutBleach),
    );
  }

  const achievedLift = Math.max(0, achievedLevel - effectiveBaseLevel);
  const liftRatio = requestedLift === 0 ? 1 : achievedLift / requestedLift;
  const currentRefL = getHairLevelReferenceLuminance(effectiveBaseLevel);
  const resolvedRefL = clamp01(
    request.preset.mode === 'lift'
      ? mix(currentRefL, request.preset.refL, liftRatio)
      : request.preset.refL,
  );
  const constrained = achievedLevel < request.preset.targetLevel;

  return {
    analysis,
    effectiveBaseLevel,
    achievedLevel,
    constrained,
    expectedResultNotice: buildExpectedResultNotice(
      request.preset,
      effectiveBaseLevel,
      achievedLevel,
    ),
    requestedLift,
    achievedLift,
    resolvedRefL,
    targetLinear: resolveTargetLinear(
      request.preset,
      effectiveBaseLevel,
      achievedLevel,
      analysis,
    ),
    strength: clamp01(request.previewStrength / 100),
  };
}

function buildModeBaseColor(
  source: LinearRgb,
  desiredLuminance: number,
  request: RecolorRequest,
  state: ResolvedShadeState,
): LinearRgb {
  const targetAtLuminance = withLuminance(state.targetLinear, desiredLuminance);

  if (request.preset.mode === 'deposit') {
    const multiplied: LinearRgb = [
      source[0] * state.targetLinear[0],
      source[1] * state.targetLinear[1],
      source[2] * state.targetLinear[2],
    ];
    return mixRgb(multiplied, targetAtLuminance, 0.4);
  }

  if (request.preset.mode === 'tone') {
    return mixRgb(source, targetAtLuminance, 0.7);
  }

  return targetAtLuminance;
}

/**
 * Normalize raw hair confidence into a soft alpha mask in the [0, 1] range.
 */
export function normalizeHairConfidence(
  value: number,
  floor = 0.2,
): number {
  if (floor === 1) return value >= 1 ? 1 : 0;
  const t = clamp01((value - floor) / (1 - floor));
  return t * t * (3 - 2 * t);
}

/**
 * Apply recolor to an ImageData using a soft alpha mask.
 * Each alpha value should be in [0, 1], where 0 = no recolor and 1 = full recolor.
 */
export function applyRecolorToImageDataWithAlpha(
  imageData: ImageData,
  hairMask: HairMaskData,
  request: RecolorRequest,
  options: ApplyRecolorOptions = {},
): ResolvedRecolorContext {
  const analysis = options.analysisOverride ?? analyzeHair(imageData, hairMask.alphaMask);
  const state = resolveRecolorContext(request, analysis);
  const pixels = imageData.data;
  const meanLuminance = Math.max(state.analysis.meanLuminance, 1e-4);
  const maskBounds = computeMaskBounds(hairMask);
  const maskHeight = Math.max(1, maskBounds.bottom - maskBounds.top + 1);
  const warmPigment = hexToLinearRgb(getUnderlyingPigmentHex(state.effectiveBaseLevel));
  const goldenHighlight = mixRgb(state.targetLinear, [1, 0.86, 0.58], 0.24);

  for (let i = 0; i < hairMask.alphaMask.length; i++) {
    const alpha = clamp01(hairMask.alphaMask[i]);
    if (alpha <= 0.001) continue;

    const idx = i * 4;
    const y = Math.floor(i / hairMask.width);
    const source = rgbToLinearRgb(
      pixels[idx],
      pixels[idx + 1],
      pixels[idx + 2],
    );
    const sourceLuminance = relativeLuminance(source);
    const normalizedLuminance = sourceLuminance / meanLuminance;
    const coreAlpha = clamp01(hairMask.coreMask[i]);
    const fringeAlpha = clamp01(hairMask.fringeMask[i]);
    const shadowWeight = clamp01((state.analysis.meanLuminance - sourceLuminance) / meanLuminance);
    const highlightWeight = sourceLuminance >= state.analysis.p95Luminance
      ? clamp01((sourceLuminance - state.analysis.p95Luminance) / Math.max(0.02, 1 - state.analysis.p95Luminance))
      : 0;
    const rootWeight = clamp01((maskBounds.top + maskHeight * 0.38 - y) / Math.max(1, maskHeight * 0.38)) * clamp01(alpha * 1.2);
    const strandVariation = deterministicVariation(i) * 0.05;
    const isHighlight = sourceLuminance >= state.analysis.p95Luminance;
    let desiredLuminance = clamp01(state.resolvedRefL * normalizedLuminance);
    if (isHighlight) {
      desiredLuminance = mix(
        desiredLuminance,
        clamp01(sourceLuminance),
        clamp01(1 - request.preset.highlightBlend * 0.6),
      );
    }
    let modeBase = buildModeBaseColor(source, desiredLuminance, request, state);
    modeBase = mixRgb(modeBase, goldenHighlight, highlightWeight * 0.12);
    modeBase = mixRgb(modeBase, warmPigment, shadowWeight * 0.14);
    if (fringeAlpha > 0) {
      modeBase = desaturateRgb(modeBase, fringeAlpha * 0.3);
    }

    let blendAlpha = alpha * state.strength;
    if (request.preset.mode === 'deposit') blendAlpha *= 0.92;
    if (request.preset.mode === 'tone') blendAlpha *= 0.78;
    if (request.preset.mode === 'lift') blendAlpha *= 0.88;

    if (isHighlight) {
      blendAlpha *= request.preset.highlightBlend * 0.5;
    }

    const fringeBlendScale = mix(0.12, 0.26, fringeAlpha);
    const coreBlendScale = mix(0.7, 1, coreAlpha);
    blendAlpha *= coreBlendScale;
    if (fringeAlpha > 0) {
      blendAlpha *= fringeBlendScale;
    }
    blendAlpha *= 1 - shadowWeight * 0.28;
    blendAlpha *= 1 - rootWeight * 0.2;
    blendAlpha = clamp01(blendAlpha * (1 + strandVariation));

    const next = mixRgb(source, modeBase, clamp01(blendAlpha));
    let shaded = next;

    if (shadowWeight > 0) {
      shaded = mixRgb(shaded, mixRgb(source, warmPigment, 0.18), shadowWeight * 0.22);
    }

    if (rootWeight > 0) {
      shaded = mixRgb(shaded, source, rootWeight * 0.22);
    }

    if (fringeAlpha > 0) {
      shaded = mixRgb(shaded, source, fringeAlpha * 0.62);
      shaded = desaturateRgb(shaded, fringeAlpha * 0.34);
    }

    if (highlightWeight > 0) {
      shaded = withLuminance(
        mixRgb(shaded, goldenHighlight, highlightWeight * 0.18),
        mix(relativeLuminance(shaded), sourceLuminance, highlightWeight * 0.55),
      );
    }

    const [r, g, b] = linearRgbToRgb(shaded);

    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
  }

  return {
    analysis: state.analysis,
    effectiveBaseLevel: state.effectiveBaseLevel,
    achievedLevel: state.achievedLevel,
    constrained: state.constrained,
    expectedResultNotice: state.expectedResultNotice,
  };
}
