// src/components/try-color/ColorPalette.tsx
'use client';

import { PRESET_COLORS, type PresetColor } from './constants';

interface ColorPaletteProps {
  selectedHex: string;
  selectedName: string | null;
  intensity: number;
  onColorChange: (hex: string, name: string | null) => void;
  onIntensityChange: (value: number) => void;
}

export function ColorPalette({
  selectedHex,
  selectedName,
  intensity,
  onColorChange,
  onIntensityChange,
}: ColorPaletteProps) {
  return (
    <div className="space-y-4">
      {/* Active color display */}
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <div
          className="w-6 h-6 rounded-full border border-zinc-600"
          style={{ backgroundColor: selectedHex }}
        />
        <span className="font-medium text-white">
          {selectedName ?? 'Custom'}
        </span>
        <span className="text-zinc-500">{selectedHex}</span>
        <span className="ml-auto">{intensity}%</span>
      </div>

      {/* Preset swatches */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {PRESET_COLORS.map((color: PresetColor) => (
          <button
            key={color.hex}
            onClick={() => onColorChange(color.hex, color.name)}
            className={`flex-shrink-0 w-10 h-10 rounded-full border-2 transition-all duration-200 ${
              selectedHex === color.hex
                ? 'border-white scale-110'
                : 'border-zinc-700 hover:border-zinc-500'
            }`}
            style={{ backgroundColor: color.hex }}
            title={color.name}
            aria-label={color.name}
          />
        ))}
        {/* Custom color picker */}
        <label
          className={`flex-shrink-0 w-10 h-10 rounded-full border-2 border-dashed cursor-pointer flex items-center justify-center transition-all duration-200 ${
            !PRESET_COLORS.some((c) => c.hex === selectedHex)
              ? 'border-white scale-110'
              : 'border-zinc-700 hover:border-zinc-500'
          }`}
          title="Custom color"
        >
          <input
            type="color"
            value={selectedHex}
            onChange={(e) => onColorChange(e.target.value, null)}
            className="sr-only"
          />
          <svg
            className="w-5 h-5 text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
        </label>
      </div>

      {/* Intensity slider */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500 uppercase tracking-wider w-16">
          Intensity
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={intensity}
          onChange={(e) => onIntensityChange(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
      </div>
    </div>
  );
}
