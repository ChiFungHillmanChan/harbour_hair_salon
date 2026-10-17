'use client';

import { GOOGLE_EVENT_COLORS, googleEventSwatch, isGoogleColorId } from '@/app/lib/calendar-colors';
import type { CalendarDiaryEntry } from '@/app/lib/calendar-diary-display';
import { salonDateKey } from '@/app/services/salon-time';
import { useT } from '@/i18n/client';
import { formatCalendarDay, formatSalonClock } from '@/i18n/dates';

/**
 * One salon-diary entry, read-only (diary mirror spec §9): the board never
 * edits Google, so the panel says where to change it. The link is only ever a
 * www.google.com/calendar/event address (google-diary-classify.ts safeLink).
 * Monochrome like the rest of the admin chrome; only the colour chip is Google's.
 */
export function GoogleDiaryPanel({ entry, stylistNames, onClose }: {
  entry: CalendarDiaryEntry;
  stylistNames: Record<string, string>;
  onClose: () => void;
}) {
  const t = useT('adminSchedule');
  const start = new Date(entry.start);
  const end = new Date(entry.end);
  const day = formatCalendarDay(t.locale, salonDateKey(start), { weekday: 'long', day: 'numeric', month: 'long' });
  const time = entry.allDay ? t('diary.allDay') : `${formatSalonClock(t.locale, start)}–${formatSalonClock(t.locale, end)}`;
  const colour = isGoogleColorId(entry.colorId)
    ? t.dynamic(`googleColors.${GOOGLE_EVENT_COLORS[entry.colorId].key}`)
    : t('googleColors.none');
  const stylists = entry.stylistIds.map((id) => stylistNames[id] ?? t('appointment.stylistFallback')).join(', ');
  const row = 'text-xs font-medium uppercase tracking-wide text-zinc-500';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-diary-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <button type="button" tabIndex={-1} aria-label={t('diary.close')} onClick={onClose} className="absolute inset-0 cursor-default bg-zinc-900/50" />
      <div className="relative w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="google-diary-title" className="min-w-0 break-words text-base font-semibold text-zinc-900">{entry.title || t('diary.noTitle')}</h2>
          <span className="flex-shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700">{t('diary.google')}</span>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className={row}>{t('diary.when')}</dt>
            <dd className="tabular-nums text-zinc-900">{day} · {time}</dd>
          </div>
          <div>
            <dt className={row}>{t('diary.kindLabel')}</dt>
            <dd className="text-zinc-900">{t(`diary.kind.${entry.kind}`)}</dd>
          </div>
          {entry.stylistIds.length > 0 && (
            <div>
              <dt className={row}>{t('diary.stylists')}</dt>
              <dd className="text-zinc-900">{stylists}</dd>
            </div>
          )}
          <div>
            <dt className={row}>{t('diary.colour')}</dt>
            <dd className="flex items-center gap-2 text-zinc-900">
              <span aria-hidden="true" className={`h-3 w-3 flex-shrink-0 rounded-full ${googleEventSwatch(entry.colorId).swatch}`} />
              {colour}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-zinc-600">{t('diary.readOnly')}</p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {entry.htmlLink && (
            <a
              href={entry.htmlLink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 underline-offset-2 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-900"
            >
              {t('diary.openInGoogle')}
            </a>
          )}
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            {t('diary.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
