// src/components/try-color/constants.ts

export type HairLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type HairTone = 'neutral' | 'ash' | 'gold' | 'copper' | 'red' | 'violet';
export type RecolorMode = 'deposit' | 'tone' | 'lift';
export type HairLevelMode = 'auto' | 'manual';
/** Legacy requests never imply a particular bleach endpoint. */
export type BleachState = 'pre' | 'post';

export interface HairConsultation {
  treatment: 'deposit' | 'permanent' | 'prelighten';
  history: 'natural' | 'coloured' | 'lightened' | 'unknown';
  lightenedBase: 'current' | 'orange' | 'yellow' | 'pale-yellow';
  greyCoverage: 'none' | 'some' | 'mostly' | 'unknown';
}

export const DEFAULT_CONSULTATION: HairConsultation = {
  treatment: 'deposit', history: 'unknown', lightenedBase: 'current', greyCoverage: 'unknown',
};

export interface LabColor { l: number; a: number; b: number }
export type AnalysisIssue = 'no-hair' | 'too-dark' | 'overexposed' | 'uneven-colour';
export type RecolorNotice = 'uncalibrated' | 'deposit-limit' | 'history-unknown' | 'previous-colour'
  | 'lightened-base-assumed' | 'warm-base' | 'grey-coverage' | 'photo-unreliable' | 'needs-lightening';

/** Source RGB and derived Lab conventions; conversion is not physical calibration. */
export interface ColorMetadata {
  space: 'srgb';
  labWhitePoint: 'D65';
  observer: '2-degree';
  source: 'illustrative-screen-swatch' | 'user-screen-swatch' | 'photo-srgb-estimate';
}


export interface ShadePreset {
  id?: string;
  provenance?: 'illustrative' | 'custom';
  colorMetadata?: ColorMetadata;
  name: string;
  swatchHex: string;
  targetLevel: HairLevel;
  targetTone: HairTone;
  mode: RecolorMode;
  refL: number;
  maxLiftWithoutBleach: number;
  highlightBlend: number;
  undertoneBias: 'cool' | 'neutral' | 'warm';
}

export interface HairAnalysis {
  quality?: 'usable' | 'limited' | 'unusable';
  issues?: AnalysisIssue[];
  levelRange?: [HairLevel, HairLevel];
  lab?: LabColor;
  regions?: { position: 'upper' | 'middle' | 'lower'; level: HairLevel; lab: LabColor }[];
  colorMetadata?: ColorMetadata;
  meanLuminance: number;
  p95Luminance: number;
  chroma: number;
  warmCoolBias: number;
  estimatedBaseLevel: HairLevel;
  confidence: number;
}

export interface RecolorRequest {
  preset: ShadePreset;
  previewStrength: number;
  baseLevelMode: HairLevelMode;
  manualBaseLevel?: HairLevel;
  bleachState?: BleachState;
  consultation?: HairConsultation;
}

export const HAIR_LEVEL_OPTIONS: HairLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Generic screen-preview anchors, not a manufacturer scale or measured hair-level calibration.
export const HAIR_LEVEL_REFERENCE_LUMINANCE: Record<HairLevel, number> = {
  1: 0.07,
  2: 0.1,
  3: 0.14,
  4: 0.2,
  5: 0.28,
  6: 0.38,
  7: 0.5,
  8: 0.63,
  9: 0.76,
  10: 0.88,
};

// Illustrative warm screen colours only; not measured exposed pigment or bleach endpoints.
export const UNDERLYING_PIGMENT_HEX: Record<HairLevel, string> = {
  1: '#4f1f17',
  2: '#6b2618',
  3: '#7d3018',
  4: '#95431d',
  5: '#b45a1f',
  6: '#c88326',
  7: '#d8a93a',
  8: '#e3bc57',
  9: '#eed47f',
  10: '#f3e4a5',
};

// Names identify illustrative screen swatches, not manufacturer shade/depth claims.
const ILLUSTRATIVE_SHADES = [
  { name: 'Natural Black', swatchHex: '#1a1a1a' },
  { name: 'Espresso', swatchHex: '#2a1506' },
  { name: 'Dark Brown', swatchHex: '#3b2314' },
  { name: 'Chocolate', swatchHex: '#3C1414' },
  { name: 'Medium Brown', swatchHex: '#6b4226' },
  { name: 'Chestnut', swatchHex: '#954535' },
  { name: 'Light Brown', swatchHex: '#a0764a' },
  { name: 'Caramel', swatchHex: '#C68E5B' },
  { name: 'Golden Blonde', swatchHex: '#C9A96E' },
  { name: 'Honey Blonde', swatchHex: '#d4a76a' },
  { name: 'Strawberry Blonde', swatchHex: '#C67D4B' },
  { name: 'Ash Blonde', swatchHex: '#C2B280' },
  { name: 'Platinum Blonde', swatchHex: '#e8dcc8' },
  { name: 'Copper', swatchHex: '#B87333' },
  { name: 'Auburn', swatchHex: '#a0522d' },
  { name: 'Deep Red', swatchHex: '#8b1a1a' },
  { name: 'Burgundy', swatchHex: '#722F37' },
  { name: 'Mahogany', swatchHex: '#4E1E0E' },
  { name: 'Silver Grey', swatchHex: '#b0b0b0' },
  { name: 'Rose Pink', swatchHex: '#e8a0bf' },
  { name: 'Purple', swatchHex: '#6a0dad' },
  { name: 'Blue', swatchHex: '#2563eb' },
];

export const PRESET_COLORS: ShadePreset[] = ILLUSTRATIVE_SHADES.map((preset) => ({
  ...buildScreenShade(preset.swatchHex),
  name: preset.name,
  id: `illustrative:${preset.name.toLowerCase().replaceAll(' ', '-')}`,
  provenance: 'illustrative',
  colorMetadata: {
    space: 'srgb', labWhitePoint: 'D65', observer: '2-degree', source: 'illustrative-screen-swatch',
  },
}));

export type PresetColor = ShadePreset;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function srgbToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function estimateToneFromHex(hex: string): HairTone {
  const [r, g, b] = hexToRgb(hex);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 18) return 'neutral';
  if (b > r + 35 && b > g) return 'violet';
  if (r > b + 28 && g < r * 0.78) return 'red';
  if (r > b + 22 && g > b && g > r * 0.45) return 'copper';
  if (b > r && g > r) return 'ash';
  return 'gold';
}

function estimateMode(targetLevel: HairLevel): RecolorMode {
  if (targetLevel >= 8) return 'lift';
  if (targetLevel <= 4) return 'deposit';
  return 'tone';
}

function estimateUndertoneBias(tone: HairTone): 'cool' | 'neutral' | 'warm' {
  if (tone === 'ash' || tone === 'violet') return 'cool';
  if (tone === 'neutral') return 'neutral';
  return 'warm';
}

export function clampHairLevel(value: number): HairLevel {
  const clamped = Math.min(10, Math.max(1, Math.round(value)));
  return clamped as HairLevel;
}

export function getHairLevelReferenceLuminance(level: HairLevel): number {
  return HAIR_LEVEL_REFERENCE_LUMINANCE[level];
}

export function getUnderlyingPigmentHex(level: HairLevel): string {
  return UNDERLYING_PIGMENT_HEX[level];
}

export function findPresetByHex(hex: string): ShadePreset | null {
  return PRESET_COLORS.find((preset) => preset.swatchHex.toLowerCase() === hex.toLowerCase()) ?? null;
}

/** One uncalibrated sRGB rule for all screen swatches, including neighbouring custom colours. */
function buildScreenShade(hex: string): Omit<ShadePreset, 'name' | 'id' | 'provenance' | 'colorMetadata'> {
  const targetLuminance = relativeLuminance(hex);
  const targetLevel = clampHairLevel(
    HAIR_LEVEL_OPTIONS.reduce(
      (closestLevel, level) => {
        const currentDistance = Math.abs(getHairLevelReferenceLuminance(level) - targetLuminance);
        const closestDistance = Math.abs(
          getHairLevelReferenceLuminance(closestLevel) - targetLuminance,
        );
        return currentDistance < closestDistance ? level : closestLevel;
      },
      5 as HairLevel,
    ),
  );
  const targetTone = estimateToneFromHex(hex);
  const mode = estimateMode(targetLevel);

  return {
    swatchHex: hex,
    targetLevel,
    targetTone,
    mode,
    refL: clamp01(targetLuminance),
    maxLiftWithoutBleach: mode === 'lift' ? 3 : mode === 'tone' ? 1 : 0,
    highlightBlend: mode === 'lift' ? 0.42 : 0.5,
    undertoneBias: estimateUndertoneBias(targetTone),
  };
}

export function buildCustomShadePreset(hex: string): ShadePreset {
  return {
    ...buildScreenShade(hex),
    name: 'Custom Colour',
    id: `custom:${hex.toLowerCase()}`,
    provenance: 'custom',
    colorMetadata: {
      space: 'srgb', labWhitePoint: 'D65', observer: '2-degree', source: 'user-screen-swatch',
    },
  };
}

export const DEFAULT_INTENSITY = 70;

export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.35';

export const MEDIAPIPE_WASM_CDN =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;

// Hair is category 1 in the selfie_multiclass model
export const HAIR_CATEGORY_INDEX = 1;

export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';

export const LIVE_TARGET_FPS = 12;
export const LIVE_FRAME_MAX_DIM = 448;
export const SLOW_FRAME_THRESHOLD_MS = 200;
export const SLOW_FRAME_WINDOW = 30;
// Skip the first N frames before measuring performance (model warmup)
export const WARMUP_FRAMES = 15;
// Discard cached overlay after this many ms to prevent stale positioning
export const OVERLAY_STALE_MS = 150;

export const HAIR_CONFIDENCE_FLOOR = 0.2;

// Video try-on guardrails (per-frame recolor is heavy; keep clips short)
export const VIDEO_MAX_SECONDS = 10;
export const VIDEO_MAX_DIM = 480;
export const VIDEO_TARGET_FPS = 12;
export const VIDEO_MAX_FRAMES = 150;
export const VIDEO_MAX_FILE_BYTES = 50 * 1024 * 1024;
