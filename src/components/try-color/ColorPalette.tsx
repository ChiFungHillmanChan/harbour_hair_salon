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
    <div className="space-y-5">
      {/* Active color display */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-[var(--accent)]/40 shadow-lg shadow-black/20"
          style={{ backgroundColor: selectedHex }}
        />
        <div>
          <p className="text-white font-serif text-lg leading-tight">
            {selectedName ?? 'Custom Colour'}
          </p>
          <p className="text-zinc-500 text-xs tracking-wider uppercase">
            {selectedHex} · {intensity}% intensity
          </p>
        </div>
      </div>

      {/* Preset swatches */}
      <div>
        <p className="text-[var(--accent)] text-xs uppercase tracking-[0.2em] font-medium mb-3">
          Select Colour
        </p>
        <div className="flex flex-wrap gap-2.5 pb-1">
          {PRESET_COLORS.map((color: PresetColor) => (
            <button
              key={color.hex}
              onClick={() => onColorChange(color.hex, color.name)}
              className="group flex flex-col items-center gap-1"
              title={color.name}
            >
              <div
                className={`w-9 h-9 rounded-full transition-all duration-300 ${
                  selectedHex === color.hex
                    ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-zinc-900 scale-110'
                    : 'hover:scale-105 border border-zinc-700 group-hover:border-zinc-500'
                }`}
                style={{ backgroundColor: color.hex }}
              />
              <span
                className={`text-[9px] leading-tight text-center max-w-[2.5rem] transition-colors truncate ${
                  selectedHex === color.hex
                    ? 'text-[var(--accent)]'
                    : 'text-zinc-600 group-hover:text-zinc-400'
                }`}
              >
                {color.name.split(' ').slice(-1)[0]}
              </span>
            </button>
          ))}
          {/* Custom color picker */}
          <label className="group flex flex-col items-center gap-1 cursor-pointer">
            <div
              className={`w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center transition-all duration-300 ${
                !PRESET_COLORS.some((c) => c.hex === selectedHex)
                  ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-zinc-900 scale-110 border-[var(--accent)]'
                  : 'border-zinc-700 group-hover:border-zinc-500 hover:scale-105'
              }`}
            >
              <input
                type="color"
                value={selectedHex}
                onChange={(e) => onColorChange(e.target.value, null)}
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

      {/* Intensity slider */}
      <div>
        <p className="text-[var(--accent)] text-xs uppercase tracking-[0.2em] font-medium mb-2">
          Intensity
        </p>
        <div className="flex items-center gap-4">
          <span className="text-zinc-600 text-xs">Light</span>
          <input
            type="range"
            min={0}
            max={100}
            value={intensity}
            onChange={(e) => onIntensityChange(Number(e.target.value))}
            className="flex-1 h-1.5 accent-[var(--accent)] cursor-pointer"
          />
          <span className="text-zinc-600 text-xs">Bold</span>
        </div>
      </div>
    </div>
  );
}
