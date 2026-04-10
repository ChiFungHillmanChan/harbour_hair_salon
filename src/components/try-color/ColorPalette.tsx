'use client';

import {
  buildCustomShadePreset,
  HAIR_LEVEL_OPTIONS,
  PRESET_COLORS,
  type HairLevel,
  type HairLevelMode,
  type ShadePreset,
} from './constants';

interface ColorPaletteProps {
  selectedHex: string;
  selectedName: string | null;
  previewStrength: number;
  baseLevelMode: HairLevelMode;
  manualBaseLevel: HairLevel;
  detectedBaseLevel: HairLevel | null;
  effectiveBaseLevel: HairLevel | null;
  expectedResultNotice: string | null;
  onShadeChange: (shade: ShadePreset) => void;
  onPreviewStrengthChange: (value: number) => void;
  onBaseLevelModeChange: (mode: HairLevelMode) => void;
  onManualBaseLevelChange: (value: HairLevel) => void;
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
  onShadeChange,
  onPreviewStrengthChange,
  onBaseLevelModeChange,
  onManualBaseLevelChange,
}: ColorPaletteProps) {
  const isPreset = PRESET_COLORS.some(
    (color) => color.swatchHex.toLowerCase() === selectedHex.toLowerCase(),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-accent/40 shadow-lg shadow-black/20"
          style={{ backgroundColor: selectedHex }}
        />
        <div>
          <p className="text-white font-serif text-lg leading-tight">
            {selectedName ?? 'Custom Colour'}
          </p>
          <p className="text-zinc-500 text-xs tracking-wider uppercase">
            {selectedHex} · {previewStrength}% preview
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-accent text-xs uppercase tracking-[0.2em] font-medium">
              Current Hair Level
            </p>
            <p className="text-zinc-500 text-xs mt-1">
              Auto-detected from luminance, with manual salon-style override.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={baseLevelMode === 'auto'}
              onChange={(e) => onBaseLevelModeChange(e.target.checked ? 'auto' : 'manual')}
              className="h-4 w-4 accent-accent"
            />
            Use Auto Detection
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Detected</p>
            <p className="mt-1 text-lg font-serif text-white">
              {detectedBaseLevel ? `Level ${detectedBaseLevel}` : 'Detecting...'}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Using</p>
            <p className="mt-1 text-lg font-serif text-white">
              {effectiveBaseLevel ? `Level ${effectiveBaseLevel}` : `Level ${manualBaseLevel}`}
            </p>
          </div>
        </div>

        <label className="block">
          <span className="text-zinc-400 text-xs uppercase tracking-[0.2em]">
            Manual Override
          </span>
          <select
            value={manualBaseLevel}
            disabled={baseLevelMode === 'auto'}
            onChange={(e) => onManualBaseLevelChange(Number(e.target.value) as HairLevel)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {HAIR_LEVEL_OPTIONS.map((level) => (
              <option key={level} value={level}>
                Level {level}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-accent text-xs uppercase tracking-[0.2em] font-medium mb-3">
          Select Colour
        </p>
        <div className="flex flex-wrap gap-2.5 pb-1">
          {PRESET_COLORS.map((color: ShadePreset) => (
            <button
              key={color.swatchHex}
              onClick={() => onShadeChange(color)}
              className="group flex flex-col items-center gap-1"
              title={color.name}
            >
              <div
                className={`w-9 h-9 rounded-full transition-all duration-300 ${
                  selectedHex.toLowerCase() === color.swatchHex.toLowerCase()
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-zinc-900 scale-110'
                    : 'hover:scale-105 border border-zinc-700 group-hover:border-zinc-500'
                }`}
                style={{ backgroundColor: color.swatchHex }}
              />
              <span
                className={`text-[9px] leading-tight text-center max-w-[2.5rem] transition-colors truncate ${
                  selectedHex.toLowerCase() === color.swatchHex.toLowerCase()
                    ? 'text-accent'
                    : 'text-zinc-600 group-hover:text-zinc-400'
                }`}
              >
                {color.name.split(' ').slice(-1)[0]}
              </span>
            </button>
          ))}
          <label className="group flex flex-col items-center gap-1 cursor-pointer">
            <div
              className={`w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center transition-all duration-300 ${
                !isPreset
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-zinc-900 scale-110 border-accent'
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
            <span className="text-[9px] text-zinc-600 group-hover:text-zinc-400">Custom</span>
          </label>
        </div>
      </div>

      <div>
        <p className="text-accent text-xs uppercase tracking-[0.2em] font-medium mb-2">
          Preview Strength
        </p>
        <div className="flex items-center gap-4">
          <span className="text-zinc-600 text-xs">Light</span>
          <input
            type="range"
            min={0}
            max={100}
            value={previewStrength}
            onChange={(e) => onPreviewStrengthChange(Number(e.target.value))}
            className="flex-1 h-1.5 accent-accent cursor-pointer"
          />
          <span className="text-zinc-600 text-xs">Bold</span>
        </div>
      </div>

      {expectedResultNotice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300 mb-1">
            Expected Result
          </p>
          <p>{expectedResultNotice}</p>
        </div>
      )}
    </div>
  );
}
