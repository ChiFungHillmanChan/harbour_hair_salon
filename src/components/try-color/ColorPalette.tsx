'use client';

import {
  buildCustomShadePreset,
  HAIR_LEVEL_OPTIONS,
  PRESET_COLORS,
  type HairAnalysis,
  type HairConsultation,
  type HairLevel,
  type HairLevelMode,
  type RecolorNotice,
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
  consultation: HairConsultation;
  analysis: HairAnalysis | null;
  notices: RecolorNotice[];
  onShadeChange: (shade: ShadePreset) => void;
  onPreviewStrengthChange: (value: number) => void;
  onBaseLevelModeChange: (mode: HairLevelMode) => void;
  onManualBaseLevelChange: (value: HairLevel) => void;
  onConsultationChange: (value: HairConsultation) => void;
}

export function ColorPalette({
  selectedHex,
  selectedName,
  previewStrength,
  baseLevelMode,
  manualBaseLevel,
  detectedBaseLevel,
  effectiveBaseLevel,
  consultation,
  analysis,
  notices,
  onShadeChange,
  onPreviewStrengthChange,
  onBaseLevelModeChange,
  onManualBaseLevelChange,
  onConsultationChange,
}: ColorPaletteProps) {
  const t = useT('tryColor');
  // Presets keep their English names as data; only the displayed label is translated.
  const shadeName = (name: string) => t.dynamic(`shades.${shadeKey(name)}`, undefined, name);
  const shadeShort = (name: string) => t.dynamic(`shadeShort.${shadeKey(name)}`, undefined, name.split(' ').slice(-1)[0]);
  const isPreset = PRESET_COLORS.some(
    (color) => color.swatchHex.toLowerCase() === selectedHex.toLowerCase(),
  );
  const hasUsableAnalysis = analysis !== null && analysis.quality !== 'unusable';
  const selectClassName = 'mt-2 h-11 min-h-11 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

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

      <fieldset className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <legend className="px-1 text-zinc-300 text-xs font-medium">{t('palette.method')}</legend>
        <div className="grid gap-2">
          {(['deposit', 'permanent', 'prelighten'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={consultation.treatment === value}
              onClick={() => onConsultationChange({ ...consultation, treatment: value })}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                consultation.treatment === value
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              <span className="block text-sm font-medium">{t(`palette.treatments.${value}.label`)}</span>
              <span className="mt-0.5 block text-xs text-zinc-400">{t(`palette.treatments.${value}.hint`)}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs text-zinc-300">
            {t('palette.history')}
            <select
              value={consultation.history}
              onChange={(e) => onConsultationChange({ ...consultation, history: e.target.value as HairConsultation['history'] })}
              className={selectClassName}
            >
              {(['unknown', 'natural', 'coloured', 'lightened'] as const).map((value) => (
                <option key={value} value={value}>{t(`palette.histories.${value}`)}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs text-zinc-300">
            {t('palette.greyCoverage')}
            <select
              value={consultation.greyCoverage}
              onChange={(e) => onConsultationChange({ ...consultation, greyCoverage: e.target.value as HairConsultation['greyCoverage'] })}
              className={selectClassName}
            >
              {(['unknown', 'none', 'some', 'mostly'] as const).map((value) => (
                <option key={value} value={value}>{t(`palette.greyOptions.${value}`)}</option>
              ))}
            </select>
          </label>
        </div>
        {consultation.treatment === 'prelighten' && (
          <label className="text-xs text-zinc-300">
            {t('palette.lightenedBase')}
            <select
              value={consultation.lightenedBase}
              onChange={(e) => onConsultationChange({ ...consultation, lightenedBase: e.target.value as HairConsultation['lightenedBase'] })}
              className={selectClassName}
            >
              {(['current', 'orange', 'yellow', 'pale-yellow'] as const).map((value) => (
                <option key={value} value={value}>{t(`palette.lightenedBases.${value}`)}</option>
              ))}
            </select>
            <span className="mt-2 block leading-relaxed text-zinc-400">{t('palette.lightenedBaseHelp')}</span>
          </label>
        )}
        <p className="text-xs leading-relaxed text-zinc-400">{t('palette.historyHelp')}</p>
      </fieldset>

      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-zinc-300 text-xs font-medium">
              {t('palette.currentLevel')}
            </p>
            <p className="text-zinc-400 text-xs mt-1 leading-relaxed">
              {t('palette.levelHelp')}
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-zinc-300">
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
              {hasUsableAnalysis && detectedBaseLevel ? t('palette.level', { level: detectedBaseLevel }) : '--'}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{t('palette.using')}</p>
            <p className="mt-1 text-lg font-serif text-white">
              {hasUsableAnalysis && effectiveBaseLevel ? t('palette.level', { level: effectiveBaseLevel }) : '--'}
            </p>
          </div>
        </div>

        <div className="space-y-2 text-xs text-zinc-400">
          <p>{t('palette.estimatedRange', {
            range: hasUsableAnalysis && analysis.levelRange ? `${analysis.levelRange[0]}–${analysis.levelRange[1]}` : '--',
          })}</p>
          <p>{t('palette.scaleHelp')}</p>
          {analysis?.quality && <p>{t(`palette.quality.${analysis.quality}`)}</p>}
          {(analysis?.issues?.length ?? 0) > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-amber-200/90">
              {analysis?.issues?.map((issue) => <li key={issue}>{t(`palette.issues.${issue}`)}</li>)}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs text-zinc-300">{t('palette.regionsTitle')}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['upper', 'middle', 'lower'] as const).map((position) => {
              const region = hasUsableAnalysis ? analysis.regions?.find((item) => item.position === position) : null;
              return (
                <div key={position} className="border-l border-zinc-700 pl-2">
                  <p className="text-xs text-zinc-400">{t(`palette.regions.${position}`)}</p>
                  <p className="mt-1 text-sm text-white">{region ? t('palette.level', { level: region.level }) : '--'}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">{t('palette.regionsHelp')}</p>
        </div>

        <label className="block">
          <span className="text-zinc-400 text-xs uppercase tracking-[0.2em]">
            {t('palette.manualOverride')}
          </span>
          <select
            value={baseLevelMode === 'auto' ? (hasUsableAnalysis ? detectedBaseLevel ?? '' : '') : manualBaseLevel}
            disabled={baseLevelMode === 'auto'}
            onChange={(e) => onManualBaseLevelChange(Number(e.target.value) as HairLevel)}
            className={`${selectClassName} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <option value="" disabled>--</option>
            {HAIR_LEVEL_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {t('palette.level', { level })}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">{t('palette.manualHelp')}</span>
        </label>
      </div>

      <div>
        <p className="text-zinc-300 text-xs uppercase tracking-[0.2em] font-medium mb-2">
          {t('palette.selectColour')}
        </p>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t('palette.illustrativeShades')}</p>
        <div className="flex flex-wrap gap-2.5 pb-1">
          {PRESET_COLORS.map((color: ShadePreset) => (
            <button
              key={color.swatchHex}
              type="button"
              onClick={() => onShadeChange(color)}
              aria-label={shadeName(color.name)}
              aria-pressed={selectedHex.toLowerCase() === color.swatchHex.toLowerCase()}
              className="group flex min-h-11 min-w-11 flex-col items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
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
                    : 'text-zinc-400 group-hover:text-zinc-300'
                }`}
              >
                {shadeShort(color.name)}
              </span>
            </button>
          ))}
          <label className="group flex min-h-11 min-w-11 flex-col items-center gap-1 cursor-pointer rounded focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-white">
            <div
              className={`w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center transition-all duration-300 ${
                !isPreset
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110 border-white/30'
                  : 'border-zinc-700 group-hover:border-zinc-500 hover:scale-105'
              }`}
            >
              <input
                type="color"
                aria-label={t('shades.customColour')}
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
            <span className="text-[9px] text-zinc-400 group-hover:text-zinc-300">{t('palette.custom')}</span>
          </label>
        </div>
      </div>

      <div>
        <p className="text-zinc-300 text-xs uppercase tracking-[0.2em] font-medium mb-2">
          {t('palette.strength')}
        </p>
        <div className="flex items-center gap-4">
          <span className="text-zinc-400 text-xs">{t('palette.light')}</span>
          <input
            type="range"
            aria-label={t('palette.strength')}
            min={0}
            max={100}
            value={previewStrength}
            onChange={(e) => onPreviewStrengthChange(Number(e.target.value))}
            className="h-11 min-w-0 flex-1 accent-white cursor-pointer"
          />
          <span className="text-zinc-400 text-xs">{t('palette.bold')}</span>
        </div>
      </div>

      {notices.length > 0 && (
        <div className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-sm text-zinc-200">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 mb-1">
            {t('palette.expected')}
          </p>
          <ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed">
            {notices.map((notice) => <li key={notice}>{t(`palette.notices.${notice}`)}</li>)}
          </ul>
        </div>
      )}

      <div className="border-t border-zinc-800 pt-4 text-xs leading-relaxed text-zinc-400">
        <p className="font-medium text-zinc-300">{t('palette.captureTitle')}</p>
        <p className="mt-2">{t('palette.captureTips')}</p>
        <p className="mt-2">{t('palette.calibrationTip')}</p>
      </div>
    </div>
  );
}
