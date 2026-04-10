// src/components/try-color/constants.ts

export interface PresetColor {
  name: string;
  hex: string;
}

export const PRESET_COLORS: PresetColor[] = [
  // Naturals
  { name: 'Natural Black', hex: '#1a1a1a' },
  { name: 'Espresso', hex: '#2a1506' },
  { name: 'Dark Brown', hex: '#3b2314' },
  { name: 'Chocolate', hex: '#3C1414' },
  { name: 'Medium Brown', hex: '#6b4226' },
  { name: 'Chestnut', hex: '#954535' },
  { name: 'Light Brown', hex: '#a0764a' },
  { name: 'Caramel', hex: '#C68E5B' },
  // Blondes
  { name: 'Golden Blonde', hex: '#C9A96E' },
  { name: 'Honey Blonde', hex: '#d4a76a' },
  { name: 'Strawberry Blonde', hex: '#C67D4B' },
  { name: 'Ash Blonde', hex: '#C2B280' },
  { name: 'Platinum Blonde', hex: '#e8dcc8' },
  // Reds
  { name: 'Copper', hex: '#B87333' },
  { name: 'Auburn', hex: '#a0522d' },
  { name: 'Deep Red', hex: '#8b1a1a' },
  { name: 'Burgundy', hex: '#722F37' },
  { name: 'Mahogany', hex: '#4E1E0E' },
  // Fashion
  { name: 'Silver Grey', hex: '#b0b0b0' },
  { name: 'Rose Pink', hex: '#e8a0bf' },
  { name: 'Purple', hex: '#6a0dad' },
  { name: 'Blue', hex: '#2563eb' },
];

export const DEFAULT_INTENSITY = 70;

export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.34';

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
