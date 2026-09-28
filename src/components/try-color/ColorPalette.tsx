'use client';

import {
  buildCustomShadePreset,
  HAIR_LEVEL_OPTIONS,
  PRESET_COLORS,
  type BleachState,
  type HairLevel,
  type HairLevelMode,
  type ShadePreset,
} from './constants';
import { useT } from '@/i18n/client';

/** Dictionary key for a preset: its English name in camelCase ("Natural Black" → "naturalBlack"). */
function shadeKey(name: string): string {
  return name
    .split(/\s+/)
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

interface ColorPaletteProps {
  selectedHex: string;
  selectedName: string | null;
  previewStrength: number;
  baseLevelMode: HairLevelMode;
  manualBaseLevel: HairLevel;
  detectedBaseLevel: HairLevel | null;
  effectiveBaseLevel: HairLevel | null;
  expectedResultNotice: string | null;
  bleachState: BleachState;
  onShadeChange: (shade: ShadePreset) => void;
  onPreviewStrengthChange: (value: number) => void;
  onBaseLevelModeChange: (mode: HairLevelMode) => void;
  onManualBaseLevelChange: (value: HairLevel) => void;
  onBleachStateChange: (value: BleachState) => void;
}

export function ColorPalette({
  selectedHex,
  selectedName,
  previewStrength,
  baseLevelMode,
  manualBaseLevel,
  detectedBaseLevel,
  effectiveBaseLevel,
  expectedResultNotice,
  bleachState,
  onShadeChange,
  onPreviewStrengthChange,
  onBaseLevelModeChange,
  onManualBaseLevelChange,
  onBleachStateChange,
}: ColorPaletteProps) {
  const t = useT('tryColor');
  // Presets keep their English names as data; only the displayed label is translated.
  const shadeName = (name: string) => t.dynamic(`shades.${shadeKey(name)}`, undefined, name);
  const shadeShort = (name: string) => t.dynamic(`shadeShort.${shadeKey(name)}`, undefined, name.split(' ').slice(-1)[0]);
  const isPreset = PRESET_COLORS.some(
    (color) => color.swatchHex.toLowerCase() === selectedHex.toLowerCase(),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-white/30 shadow-lg shadow-black/20"
          style={{ backgroundColor: selectedHex }}
        />
        <div>
          <p className="text-white font-serif text-lg leading-tight">
            {shadeName(selectedName ?? 'Custom Colour')}
          </p>
          <p className="text-zinc-500 text-xs tracking-wider uppercase">
            {t('palette.previewInfo', { hex: selectedHex, strength: previewStrength })}
          </p>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <p className="text-zinc-300 text-xs uppercase tracking-[0.2em] font-medium">{t('palette.method')}</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['pre', t('palette.preLabel'), t('palette.preHint')],
            ['post', t('palette.postLabel'), t('palette.postHint')],
          ] as const).map(([value, label, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => onBleachStateChange(value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                bleachState === value
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-[10px] text-zinc-500">{hint}</span>
            </button>
          ))}
        </div>
        <p className="text-zinc-500 text-[11px]">
          {bleachState === 'post' ? t('palette.postNote') : t('palette.preNote')}
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-zinc-300 text-xs uppercase tracking-[0.2em] font-medium">
              {t('palette.currentLevel')}
            </p>
            <p className="text-zinc-500 text-xs mt-1">
              {t('palette.levelHelp')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={baseLevelMode === 'auto'}
              onChange={(e) => onBaseLevelModeChange(e.target.checked ? 'auto' : 'manual')}
              className="h-4 w-4 accent-white"
            />
            {t('palette.autoDetect')}
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{t('palette.detected')}</p>
            <p className="mt-1 text-lg font-serif text-white">
              {detectedBaseLevel ? t('palette.level', { level: detectedBaseLevel }) : t('palette.detecting')}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{t('palette.using')}</p>
            <p className="mt-1 text-lg font-serif text-white">
              {t('palette.level', { level: effectiveBaseLevel ?? manualBaseLevel })}
            </p>
          </div>
        </div>

        <label className="block">
          <span className="text-zinc-400 text-xs uppercase tracking-[0.2em]">
            {t('palette.manualOverride')}
          </span>
          <select
            value={manualBaseLevel}
            disabled={baseLevelMode === 'auto'}
            onChange={(e) => onManualBaseLevelChange(Number(e.target.value) as HairLevel)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {HAIR_LEVEL_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {t('palette.level', { level })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-zinc-300 text-xs uppercase tracking-[0.2em] font-medium mb-3">
          {t('palette.selectColour')}
        </p>
        <div className="flex flex-wrap gap-2.5 pb-1">
          {PRESET_COLORS.map((color: ShadePreset) => (
            <button
              key={color.swatchHex}
              onClick={() => onShadeChange(color)}
              className="group flex flex-col items-center gap-1"
              title={shadeName(color.name)}
            >
              <div
                className={`w-9 h-9 rounded-full transition-all duration-300 ${
                  selectedHex.toLowerCase() === color.swatchHex.toLowerCase()
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110'
                    : 'hover:scale-105 border border-zinc-700 group-hover:border-zinc-500'
                }`}
                style={{ backgroundColor: color.swatchHex }}
              />
              <span
                className={`text-[9px] leading-tight text-center max-w-[2.5rem] transition-colors truncate ${
                  selectedHex.toLowerCase() === color.swatchHex.toLowerCase()
                    ? 'text-zinc-300'
                    : 'text-zinc-600 group-hover:text-zinc-400'
                }`}
              >
                {shadeShort(color.name)}
              </span>
            </button>
          ))}
          <label className="group flex flex-col items-center gap-1 cursor-pointer">
            <div
              className={`w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center transition-all duration-300 ${
                !isPreset
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110 border-white/30'
                  : 'border-zinc-700 group-hover:border-zinc-500 hover:scale-105'
              }`}
            >
              <input
                type="color"
                value={selectedHex}
                onChange={(e) => onShadeChange(buildCustomShadePreset(e.target.value))}
                className="sr-only"
              />
              <svg
                className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <span className="text-[9px] text-zinc-600 group-hover:text-zinc-400">{t('palette.custom')}</span>
          </label>
        </div>
      </div>

      <div>
        <p className="text-zinc-300 text-xs uppercase tracking-[0.2em] font-medium mb-2">
          {t('palette.strength')}
        </p>
        <div className="flex items-center gap-4">
          <span className="text-zinc-600 text-xs">{t('palette.light')}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={previewStrength}
            onChange={(e) => onPreviewStrengthChange(Number(e.target.value))}
            className="flex-1 h-1.5 accent-white cursor-pointer"
          />
          <span className="text-zinc-600 text-xs">{t('palette.bold')}</span>
        </div>
      </div>

      {expectedResultNotice && (
        <div className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-sm text-zinc-200">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 mb-1">
            {t('palette.expected')}
          </p>
          {/* colorMath words this notice in English; the same facts are re-worded here. */}
          <p>{t('palette.expectedNotice', { level: effectiveBaseLevel ?? manualBaseLevel, shade: shadeName(selectedName ?? 'Custom Colour') })}</p>
        </div>
      )}
    </div>
  );
}
