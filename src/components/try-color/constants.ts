// src/components/try-color/constants.ts

export interface PresetColor {
  name: string;
  hex: string;
}

export const PRESET_COLORS: PresetColor[] = [
  { name: 'Natural Black', hex: '#1a1a1a' },
  { name: 'Dark Brown', hex: '#3b2314' },
  { name: 'Medium Brown', hex: '#6b4226' },
  { name: 'Light Brown', hex: '#a0764a' },
  { name: 'Honey Blonde', hex: '#d4a76a' },
  { name: 'Platinum Blonde', hex: '#e8dcc8' },
  { name: 'Deep Red', hex: '#8b1a1a' },
  { name: 'Auburn', hex: '#a0522d' },
  { name: 'Silver Grey', hex: '#b0b0b0' },
  { name: 'Rose Pink', hex: '#e8a0bf' },
  { name: 'Purple', hex: '#6a0dad' },
  { name: 'Blue', hex: '#2563eb' },
];

export const DEFAULT_INTENSITY = 70;

export const MEDIAPIPE_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

// Hair is category 1 in the selfie_multiclass model
export const HAIR_CATEGORY_INDEX = 1;

export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

export const LIVE_TARGET_FPS = 12;
export const SLOW_FRAME_THRESHOLD_MS = 200;
export const SLOW_FRAME_WINDOW = 30;
// Skip the first N frames before measuring performance (model warmup)
export const WARMUP_FRAMES = 15;
