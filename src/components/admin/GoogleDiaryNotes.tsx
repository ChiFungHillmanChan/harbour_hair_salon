'use client';

import { googleEventSwatch } from '@/app/lib/calendar-colors';
import { diaryRange, type CalendarDiaryEntry, type PlacedDiaryEntry } from '@/app/lib/calendar-diary-display';
import { useT } from '@/i18n/client';

/**
 * The salon diary's notes (Google entries that block nothing: "卡機", reminders)
 * for one day, in a strip above the board's columns — never in a column, where
 * they would read as someone's time. Read-only: a note opens GoogleDiaryPanel.
 * `compact` is the week grid's day heading: no strip title.
 */
export function GoogleDiaryNotes({ notes, onSelect, compact = false }: {
  notes: readonly PlacedDiaryEntry[];
  onSelect?: (entry: CalendarDiaryEntry) => void;
  compact?: boolean;
}) {
  const t = useT('adminSchedule');
  if (notes.length === 0) return null;
  return (
    <div
      data-testid="diary-notes"
      className={compact ? 'mt-1 flex flex-col gap-0.5 text-left' : 'flex flex-wrap items-center gap-1.5 border-b border-zinc-200 bg-white px-2 py-1.5'}
    >
      {!compact && <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{t('diary.notes')}</span>}
      {notes.map((note) => {
        const title = note.title || t('diary.noTitle');
        const range = note.allDay ? t('diary.allDay') : diaryRange(note);
        const label = t('diary.detail', { title, range });
        return (
          <button
            key={note.id}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => onSelect?.(note)}
            className={`flex min-w-0 items-center gap-1 rounded border border-zinc-200 bg-zinc-50 text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-900 ${
              compact ? 'w-full px-0.5 text-[9px] leading-tight' : 'max-w-full px-1.5 py-0.5 text-[11px]'
            }`}
          >
            <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full ${googleEventSwatch(note.colorId).swatch}`} />
            <span className="flex-shrink-0 tabular-nums text-zinc-500">{range}</span>
            <span className="truncate">{title}</span>
          </button>
        );
      })}
    </div>
  );
}
