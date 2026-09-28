'use client';

import { useState } from 'react';
import { CALENDAR_COLORS, CALENDAR_COLOR_KEYS } from '@/app/lib/calendar-colors';
import { useT } from '@/i18n/client';

interface CalendarColorPickerProps {
  name: string;
  label: string;
  help?: string;
  initial?: string | null;
}

/**
 * Swatch picker for the admin schedule board. Posts a palette KEY (not a hex)
 * under `name`, or an empty string for "no colour".
 *
 * Deliberately a fixed palette rather than a colour input: every swatch is
 * guaranteed readable with white text and distinguishable from its neighbours,
 * and these colours never reach the public site, which stays monochrome.
 */
export function CalendarColorPicker({ name, label, help, initial }: CalendarColorPickerProps) {
  const [selected, setSelected] = useState<string>(initial ?? '');
  const t = useT('adminSchedule');

  return (
    <fieldset>
      <legend className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
        {label}
      </legend>
      <input type="hidden" name={name} value={selected} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSelected('')}
          aria-pressed={selected === ''}
          title={t('colors.none')}
          aria-label={t('colors.none')}
          className={`h-9 w-9 rounded-full border-2 bg-white flex items-center justify-center text-xs text-zinc-400 transition
            ${selected === '' ? 'border-zinc-900 ring-2 ring-zinc-900/20' : 'border-zinc-300 hover:border-zinc-500'}`}
        >
          ✕
        </button>
        {CALENDAR_COLOR_KEYS.map((key) => {
          const swatch = CALENDAR_COLORS[key];
          const isSelected = selected === key;
          const name = t.dynamic(`colors.${key}`, undefined, swatch.label);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              aria-pressed={isSelected}
              title={name}
              className={`h-9 w-9 rounded-full border-2 transition ${swatch.swatch}
                ${isSelected ? 'border-zinc-900 ring-2 ring-zinc-900/20' : 'border-transparent hover:border-zinc-400'}`}
            >
              <span className="sr-only">{name}</span>
            </button>
          );
        })}
      </div>
      {help && <p className="text-xs text-zinc-500 mt-2">{help}</p>}
    </fieldset>
  );
}
