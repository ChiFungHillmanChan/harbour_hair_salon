// src/components/try-color/colorMath.ts

import {
  clampHairLevel,
  DEFAULT_CONSULTATION,
  HAIR_LEVEL_OPTIONS,
  getHairLevelReferenceLuminance,
  getUnderlyingPigmentHex,
  type HairAnalysis,
  type AnalysisIssue,
  type HairConsultation,
  type LabColor,
  type RecolorNotice,
  type HairLevel,
  type RecolorRequest,
} from './constants';
import type { HairMaskData } from './HairSegmentation';

type LinearRgb = [number, number, number];

export interface ResolvedRecolorContext {
  analysis: HairAnalysis;
  effectiveBaseLevel: HairLevel;
  achievedLevel: HairLevel;
  constrained: boolean;
  /** Legacy field; customer copy is translated from notices. */
  expectedResultNotice: string | null;
  notices: RecolorNotice[];
}

interface ResolvedShadeState extends ResolvedRecolorContext {
  requestedLift: number;
  achievedLift: number;
  resolvedRefL: number;
  targetLinear: LinearRgb;
  strength: number;
  canLighten: boolean;
  assumedBase: boolean;
  substrateLinear: LinearRgb | null;
}

interface ApplyRecolorOptions {
  analysisOverride?: HairAnalysis;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
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

/** Map into the sRGB gamut by reducing chroma, preserving requested luminance. */
function withLuminance(rgb: LinearRgb, targetLuminance: number): LinearRgb {
  const desired = clamp01(targetLuminance);
  const current = relativeLuminance(rgb);
  if (current <= 1e-5) return [desired, desired, desired];
  const scaled = rgb.map((channel) => channel * desired / current) as LinearRgb;
  let chromaScale = 1;
  for (const channel of scaled) {
    if (channel > 1) chromaScale = Math.min(chromaScale, (1 - desired) / (channel - desired));
    if (channel < 0) chromaScale = Math.min(chromaScale, desired / (desired - channel));
  }
  return scaled.map((channel) => clamp01(mix(desired, channel, chromaScale))) as LinearRgb;
}

/**
 * sRGB -> XYZ -> CIELAB, D65 / CIE 1931 2-degree observer.
 * Uses the sRGB matrix and Lab equations from https://www.w3.org/TR/css-color-4/#color-conversion-code
 * with D65 retained: these values are NOT CSS lab() (D50), nor measured hair reflectance.
 */
function linearRgbToLab([r, g, b]: LinearRgb): LabColor {
  const xyz = [
    (506752 / 1228815 * r + 87881 / 245763 * g + 12673 / 70218 * b) / (0.3127 / 0.329),
    87098 / 409605 * r + 175762 / 245763 * g + 12673 / 175545 * b,
    (7918 / 409605 * r + 87881 / 737289 * g + 1001167 / 1053270 * b) / ((1 - 0.3127 - 0.329) / 0.329),
  ];
  const [x, y, z] = xyz.map((value) => value > 216 / 24389
    ? Math.cbrt(value)
    : (24389 / 27 * value + 16) / 116);
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

export function rgbToLab(r: number, g: number, b: number): LabColor {
  return linearRgbToLab(rgbToLinearRgb(r, g, b));
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

interface HairSample { rgb: LinearRgb; luminance: number; y: number; weight: number }

function percentile(samples: HairSample[], fraction: number): number {
  return samples[Math.round((samples.length - 1) * fraction)].luminance;
}

/** Sort and trim both tails so specular highlights and isolated dark pixels do not set the base. */
function summarizeSamples(samples: HairSample[]): { rgb: LinearRgb; luminance: number } {
  samples.sort((a, b) => a.luminance - b.luminance);
  const trim = Math.floor(samples.length * 0.1);
  const rgb: LinearRgb = [0, 0, 0];
  let total = 0;
  for (let i = trim; i < samples.length - trim; i++) {
    const sample = samples[i];
    total += sample.weight;
    for (let c = 0; c < 3; c++) rgb[c] += sample.rgb[c] * sample.weight;
  }
  for (let c = 0; c < 3; c++) rgb[c] /= total;
  return { rgb, luminance: relativeLuminance(rgb) };
}

export function smoothHairAnalysis(
  previous: HairAnalysis,
  next: HairAnalysis,
  blend: number,
): HairAnalysis {
  // A lost mask or unusable exposure must take effect immediately, including recovery.
  if (previous.quality === 'unusable' || next.quality === 'unusable') return next;
  const t = clamp01(blend);
  const meanLuminance = mix(previous.meanLuminance, next.meanLuminance, t);
  return {
    ...next,
    meanLuminance,
    p95Luminance: mix(previous.p95Luminance, next.p95Luminance, t),
    chroma: mix(previous.chroma, next.chroma, t),
    warmCoolBias: mix(previous.warmCoolBias, next.warmCoolBias, t),
    confidence: mix(previous.confidence, next.confidence, t),
    estimatedBaseLevel: estimateBaseLevelFromLuminance(meanLuminance),
  };
}

export function analyzeHair(imageData: ImageData, alphaMask: Float32Array): HairAnalysis {
  const { data: pixels, width, height } = imageData;
  const samples: HairSample[] = [];
  // Bounded spatial sampling keeps long-hair video frames affordable without favouring the top.
  const step = Math.max(1, Math.ceil(Math.sqrt(width * height / 12000)));
  let top = height;
  let bottom = -1;
  let covered = 0;
  let inspected = 0;
  let dark = 0;
  let clipped = 0;
  let darkPhotoPixels = 0;
  let photoPixels = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      inspected++;
      const i = y * width + x;
      const weight = clamp01(alphaMask[i]);
      if (!(pixels[i * 4 + 3] >= 250)) continue;
      const rgb = rgbToLinearRgb(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
      const luminance = relativeLuminance(rgb);
      if (!Number.isFinite(luminance)) continue;
      photoPixels++;
      if (luminance < 0.01) darkPhotoPixels++;
      if (weight < 0.7) continue;
      // One-pixel erosion rejects skin/background mixed into the mask boundary.
      if ((x > 0 && !(alphaMask[i - 1] >= 0.5))
        || (x + 1 < width && !(alphaMask[i + 1] >= 0.5))
        || (y > 0 && !(alphaMask[i - width] >= 0.5))
        || (y + 1 < height && !(alphaMask[i + width] >= 0.5))) continue;
      samples.push({ rgb, luminance, y, weight });
      covered += weight;
      if (luminance < 0.004) dark++;
      if (Math.min(...rgb) > 0.93) clipped++;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  const colorMetadata = {
    space: 'srgb', labWhitePoint: 'D65', observer: '2-degree', source: 'photo-srgb-estimate',
  } as const;
  const normalSizeImage = width * height >= 1024;
  const insufficientSupport = normalSizeImage && samples.length < 8;
  const limitedSupport = normalSizeImage
    && (samples.length < 32 || covered / Math.max(1, inspected) < 0.01);
  if (samples.length === 0 || insufficientSupport) {
    return {
      quality: 'unusable', issues: ['no-hair'], regions: [], colorMetadata,
      meanLuminance: 0, p95Luminance: 0, chroma: 0, warmCoolBias: 0,
      // Compatibility placeholder only: consumers must gate the level on quality.
      estimatedBaseLevel: 1, confidence: 0,
    };
  }

  const summary = summarizeSamples(samples);
  const p10 = percentile(samples, 0.1);
  const p90 = percentile(samples, 0.9);
  const issues: AnalysisIssue[] = [];
  if (dark / samples.length >= 0.25 || summary.luminance < 0.01) issues.push('too-dark');
  if (clipped / samples.length >= 0.15) issues.push('overexposed');
  const levelRange: [HairLevel, HairLevel] = [
    estimateBaseLevelFromLuminance(p10), estimateBaseLevelFromLuminance(p90),
  ];
  const sampleLabs = samples.map((sample) => linearRgbToLab(sample.rgb));
  const toneSpreads = (['a', 'b'] as const).map((axis) => {
    const values = sampleLabs.map((lab) => lab[axis]).sort((a, b) => a - b);
    return values[Math.round((values.length - 1) * 0.9)] - values[Math.round((values.length - 1) * 0.1)];
  });
  // A conservative image-quality hint, not a measured diagnosis of uneven dye uptake.
  if (levelRange[1] - levelRange[0] >= 3 || Math.hypot(...toneSpreads) > 25) issues.push('uneven-colour');
  const photoSeverelyDark = darkPhotoPixels / Math.max(1, photoPixels) >= 0.95;
  // Black hair alone is not evidence that the whole photograph is underexposed.
  const unusable = (dark / samples.length >= 0.75 && photoSeverelyDark) || clipped / samples.length >= 0.65;
  const quality = unusable ? 'unusable' : issues.length || limitedSupport ? 'limited' : 'usable';
  const regions: NonNullable<HairAnalysis['regions']> = [];
  if (!unusable) {
    const positions = ['upper', 'middle', 'lower'] as const;
    for (let region = 0; region < 3; region++) {
      const regional = samples.filter((sample) => Math.min(2,
        Math.floor((sample.y - top) / (bottom - top + 1) * 3)) === region);
      if (regional.length === 0) continue;
      const { rgb, luminance } = summarizeSamples(regional);
      regions.push({ position: positions[region], level: estimateBaseLevelFromLuminance(luminance), lab: linearRgbToLab(rgb) });
    }
  }
  return {
    quality, issues, regions, colorMetadata,
    ...(unusable ? {} : { levelRange, lab: linearRgbToLab(summary.rgb) }),
    meanLuminance: summary.luminance,
    p95Luminance: percentile(samples, 0.95),
    chroma: rgbChroma(summary.rgb),
    warmCoolBias: rgbWarmCoolBias(summary.rgb),
    estimatedBaseLevel: estimateBaseLevelFromLuminance(summary.luminance),
    // Sample coverage/size and exposure quality only, never probability of a salon outcome.
    confidence: unusable ? 0 : clamp01(covered / Math.max(1, inspected) / 0.1)
      * Math.min(1, Math.sqrt(samples.length / 64)) * (quality === 'limited' ? 0.6 : 1),
  };
}

function resolveConsultation(request: RecolorRequest): HairConsultation {
  if (request.consultation) return request.consultation;
  return {
    ...DEFAULT_CONSULTATION,
    treatment: request.bleachState === 'post' ? 'prelighten' : 'deposit',
  };
}

// Hypothetical screen bases on the generic preview scale, NOT a measured bleach chart.
const LIGHTENED_BASE_PREVIEWS = {
  orange: { level: 6, hex: '#c88338' },
  yellow: { level: 8, hex: '#e4ca73' },
  'pale-yellow': { level: 10, hex: '#f3e6b5' },
} as const;

export function resolveRecolorContext(request: RecolorRequest, analysis: HairAnalysis): ResolvedShadeState {
  const consultation = resolveConsultation(request);
  const effectiveBaseLevel = request.baseLevelMode === 'manual' && request.manualBaseLevel
    ? request.manualBaseLevel : analysis.estimatedBaseLevel;
  const assumed = consultation.treatment === 'prelighten' && consultation.lightenedBase !== 'current'
    ? LIGHTENED_BASE_PREVIEWS[consultation.lightenedBase] : null;
  const substrateLevel = assumed?.level ?? effectiveBaseLevel;
  const requestedLift = Math.max(0, request.preset.targetLevel - substrateLevel);
  // Two levels is a conservative illustrative rendering ceiling, not a product lifting claim.
  const allowedLift = consultation.treatment === 'permanent' && consultation.history === 'natural' ? 2 : 0;
  const achievedLevel = clampHairLevel(Math.min(request.preset.targetLevel, substrateLevel + allowedLift));
  const achievedLift = Math.max(0, achievedLevel - effectiveBaseLevel);
  const constrained = achievedLevel < request.preset.targetLevel;
  const notices: RecolorNotice[] = ['uncalibrated'];
  if (consultation.history === 'unknown') notices.push('history-unknown');
  if (consultation.history === 'coloured' || consultation.history === 'lightened') notices.push('previous-colour');
  if (consultation.greyCoverage !== 'none') notices.push('grey-coverage');
  if (consultation.treatment === 'deposit' && requestedLift > 0) notices.push('deposit-limit');
  if (assumed) notices.push('lightened-base-assumed');
  if (constrained) notices.push('needs-lightening');
  if ((assumed && consultation.lightenedBase !== 'pale-yellow') || achievedLift > 0
    || (analysis.warmCoolBias > 0.1 && request.preset.undertoneBias === 'cool')) notices.push('warm-base');
  if (analysis.quality === 'unusable' || analysis.quality === 'limited' || analysis.confidence === 0) notices.push('photo-unreliable');

  const baseRef = getHairLevelReferenceLuminance(effectiveBaseLevel);
  const availableRef = getHairLevelReferenceLuminance(clampHairLevel(substrateLevel + allowedLift));
  // Integer preview levels are labels only. Use continuous swatch luminance to avoid
  // a visible jump when neighbouring picker values cross a level midpoint.
  const targetRef = Math.min(request.preset.refL, availableRef);
  const nextBaseRef = getHairLevelReferenceLuminance(clampHairLevel(effectiveBaseLevel + 1));
  const liftAmount = clamp01((targetRef - baseRef) / Math.max(0.001, nextBaseRef - baseRef));
  const upperPigmentLevel = HAIR_LEVEL_OPTIONS.find((level) => getHairLevelReferenceLuminance(level) >= targetRef) ?? 10;
  const lowerPigmentLevel = clampHairLevel(upperPigmentLevel - 1);
  const lowerPigmentRef = getHairLevelReferenceLuminance(lowerPigmentLevel);
  const pigmentPosition = clamp01((targetRef - lowerPigmentRef)
    / Math.max(0.001, getHairLevelReferenceLuminance(upperPigmentLevel) - lowerPigmentRef));
  const liftedPigment = mixRgb(
    hexToLinearRgb(getUnderlyingPigmentHex(lowerPigmentLevel)),
    hexToLinearRgb(getUnderlyingPigmentHex(upperPigmentLevel)),
    pigmentPosition,
  );
  const substrateLinear = assumed ? hexToLinearRgb(assumed.hex)
    : liftAmount > 0 ? liftedPigment : null;
  const target = hexToLinearRgb(request.preset.swatchHex);
  // These blend weights are visual heuristics, deliberately not labelled measured/calibrated.
  // Warmth ramps from zero with actual luminance lift, independently of rounded depth labels.
  const residual = assumed ? (consultation.lightenedBase === 'pale-yellow' ? 0.12 : 0.4) : 0.25 * liftAmount;
  const targetLinear = substrateLinear ? mixRgb(target, substrateLinear, residual) : target;
  const canLighten = assumed !== null || (allowedLift > 0 && targetRef > baseRef);
  const resolvedRefL = assumed ? targetRef
    : analysis.meanLuminance * targetRef / Math.max(0.001, baseRef);

  return {
    analysis, effectiveBaseLevel, achievedLevel, constrained, notices,
    expectedResultNotice: null,
    requestedLift, achievedLift, resolvedRefL, targetLinear,
    canLighten, assumedBase: assumed !== null, substrateLinear,
    strength: clamp01(request.previewStrength / 100),
  };
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
  if (state.strength === 0 || analysis.quality === 'unusable' || analysis.confidence === 0) return state;
  const pixels = imageData.data;
  const meanLuminance = Math.max(analysis.meanLuminance, 1e-4);
  const count = Math.min(hairMask.alphaMask.length, pixels.length / 4);

  for (let i = 0; i < count; i++) {
    const alpha = clamp01(hairMask.alphaMask[i]);
    if (alpha <= 0.001) continue;
    const idx = i * 4;
    const source = rgbToLinearRgb(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    const sourceLuminance = relativeLuminance(source);
    const shadowWeight = clamp01((meanLuminance - sourceLuminance) / meanLuminance);
    const highlightWeight = clamp01((sourceLuminance - meanLuminance)
      / Math.max(0.02, analysis.p95Luminance - meanLuminance));
    let desiredLuminance = clamp01(state.resolvedRefL * sourceLuminance / meanLuminance);
    if (!state.canLighten) desiredLuminance = Math.min(sourceLuminance, desiredLuminance);
    desiredLuminance = mix(desiredLuminance, sourceLuminance, highlightWeight * 0.8);

    const target = withLuminance(state.targetLinear, desiredLuminance);
    // Retain the observed base when it has not been replaced by an explicit hypothetical base.
    const retainedBase = state.assumedBase ? 0
      : Math.min(0.8, 0.25 + (state.constrained ? state.requestedLift * 0.08 : 0));
    let modeBase = mixRgb(target, withLuminance(source, desiredLuminance), retainedBase);
    const fringe = clamp01(hairMask.fringeMask[i]);
    if (fringe > 0) modeBase = desaturateRgb(modeBase, fringe * 0.25);

    let blendAlpha = alpha * state.strength;
    blendAlpha *= mix(0.7, 1, clamp01(hairMask.coreMask[i]));
    blendAlpha *= 1 - shadowWeight * 0.4;
    blendAlpha *= 1 - highlightWeight * 0.85;
    if (fringe > 0) blendAlpha *= mix(0.25, 0.12, fringe);
    const rendered = mixRgb(source, modeBase, clamp01(blendAlpha));
    let [r, g, b] = linearRgbToRgb(rendered);
    if (!state.canLighten) {
      // Also avoid an apparent encoded-brightness increase from a hue-only change.
      const originalBrightness = 0.2126 * pixels[idx] + 0.7152 * pixels[idx + 1] + 0.0722 * pixels[idx + 2];
      const renderedBrightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (renderedBrightness > originalBrightness) {
        const scale = originalBrightness / renderedBrightness;
        [r, g, b] = [Math.round(r * scale), Math.round(g * scale), Math.round(b * scale)];
      }
    }
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
  }
  return state;
}
