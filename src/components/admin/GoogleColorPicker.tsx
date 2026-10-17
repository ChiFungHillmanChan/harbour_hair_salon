'use client';

import { useState } from 'react';
import { DEFAULT_UNASSIGNED_COLOR_ID, GOOGLE_COLOR_IDS, GOOGLE_EVENT_COLORS } from '@/app/lib/calendar-colors';
import { useT } from '@/i18n/client';

interface GoogleColorPickerProps {
  name: string;
  label: string;
  help?: string;
  initial?: string | null;
  /** Offer "no Google colour" (a stylist may have none); the two salon colours may not. */
  allowNone: boolean;
}

/**
 * Swatch picker for Google Calendar's eleven event colours (Google diary
 * mirror, spec §3). Posts a Google colour id ("1"–"11") under `name`, or an
 * empty string for "none" when `allowNone`. Admin-only: the server refuses a
 * colour another active stylist holds, and the two salon colours for a stylist.
 * Every swatch class comes from the palette object, never built at runtime.
 */
export function GoogleColorPicker({ name, label, help, initial, allowNone }: GoogleColorPickerProps) {
  const [selected, setSelected] = useState<string>(initial ?? (allowNone ? '' : DEFAULT_UNASSIGNED_COLOR_ID));
  const t = useT('adminSchedule');

  return (
    <fieldset>
      <legend className="block text-xs font-medium uppercase tracking-wider text-zinc-600 mb-2">
        {label}
      </legend>
      <input type="hidden" name={name} value={selected} />
      <div className="flex flex-wrap gap-2">
        {allowNone && (
          <button
            type="button"
            onClick={() => setSelected('')}
            aria-pressed={selected === ''}
            title={t('googleColors.none')}
            aria-label={t('googleColors.none')}
            className={`h-9 w-9 rounded-full border-2 bg-white flex items-center justify-center text-xs text-zinc-400 transition
              ${selected === '' ? 'border-zinc-900 ring-2 ring-zinc-900/20' : 'border-zinc-300 hover:border-zinc-500'}`}
          >
            ✕
          </button>
        )}
        {GOOGLE_COLOR_IDS.map((id) => {
          const swatch = GOOGLE_EVENT_COLORS[id];
          const isSelected = selected === id;
          const colourName = t.dynamic(`googleColors.${swatch.key}`, undefined, swatch.label);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelected(id)}
              aria-pressed={isSelected}
              title={colourName}
              className={`h-9 w-9 rounded-full border-2 transition ${swatch.swatch}
                ${isSelected ? 'border-zinc-900 ring-2 ring-zinc-900/20' : 'border-transparent hover:border-zinc-400'}`}
            >
              <span className="sr-only">{colourName}</span>
            </button>
          );
        })}
      </div>
      {help && <p className="text-xs text-zinc-500 mt-2">{help}</p>}
    </fieldset>
  );
}
