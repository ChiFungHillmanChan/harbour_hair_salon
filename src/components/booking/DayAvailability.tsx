'use client';

import { useT } from '@/i18n/client';

/** A date in the booking strip. An unavailable day is greyed but still opens, so the customer sees why. */
export function DayChip({ weekday, dayOfMonth, month, fullLabel, selected, unavailable, onSelect }: {
  weekday: string; dayOfMonth: number; month: string; fullLabel: string;
  selected: boolean; unavailable: boolean; onSelect: () => void;
}) {
  const t = useT('booking');
  const tone = selected
    ? (unavailable ? 'border-zinc-500 bg-zinc-200 text-zinc-600 shadow-md' : 'border-zinc-900 bg-zinc-900 text-white shadow-md')
    : unavailable
      ? 'border-zinc-200 bg-zinc-100 text-zinc-400 hover:border-zinc-300'
      : 'border-zinc-200 hover:border-zinc-400 hover:bg-white bg-white text-zinc-700';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={unavailable ? t('date.dayUnavailableLabel', { date: fullLabel }) : fullLabel}
      className={`flex-shrink-0 snap-start w-20 lg:w-full p-3 rounded-lg border flex lg:flex-row flex-col items-center lg:justify-between justify-center transition-all ${tone}`}
    >
      <div className="text-center lg:text-left">
        <span className={`text-xs uppercase font-bold block ${selected && !unavailable ? 'text-zinc-300' : unavailable ? 'text-zinc-400' : 'text-zinc-500'}`}>{weekday}</span>
        <span className={`text-lg font-bold block leading-tight ${unavailable ? 'line-through decoration-zinc-400' : ''}`}>{dayOfMonth}</span>
      </div>
      <span className={`text-xs ${unavailable ? 'font-medium text-zinc-500' : 'text-zinc-400'}`}>{unavailable ? t('date.unavailable') : month}</span>
    </button>
  );
}

/** The day has no bookable time: one big block, like a booking or Fresha's "Pause". Never says why. */
export function UnavailableDayBlock({ hours, stylistName }: { hours: { start: string; end: string } | null; stylistName: string | null }) {
  const t = useT('booking');
  return (
    <div
      role="status"
      className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-zinc-300 border-l-4 border-l-zinc-500 bg-[repeating-linear-gradient(135deg,var(--color-zinc-200)_0_8px,var(--color-zinc-100)_8px_16px)] p-6 text-center"
    >
      <p className="text-lg font-semibold text-zinc-800">{t('date.unavailable')}</p>
      {hours && <p className="mt-1 text-sm tabular-nums text-zinc-700">{`${hours.start} – ${hours.end}`}</p>}
      <p className="mt-3 max-w-xs text-sm text-zinc-700">{stylistName ? t('date.unavailableHelp', { name: stylistName }) : t('date.unavailableHelpAnyone')}</p>
    </div>
  );
}

const PERIODS = ['morning', 'afternoon', 'evening'] as const;
const periodOf = (time: string) => {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
};

/** Every time of an open day; taken ones greyed and untappable. */
export function TimeSlotGrid({ slots, selectedTime, onSelect }: {
  slots: { time: string; available: boolean }[]; selectedTime: string | null; onSelect: (time: string) => void;
}) {
  const t = useT('booking');
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {PERIODS.map((period) => {
        const group = slots.filter((slot) => periodOf(slot.time) === period);
        if (group.length === 0) return null;
        return (
          <div key={period}>
            <h4 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-3 border-b border-zinc-100 pb-1">{t(`date.${period}`)}</h4>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {group.map((slot) => {
                const isSelected = slot.available && selectedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => { if (slot.available) onSelect(slot.time); }}
                    aria-pressed={slot.available ? isSelected : undefined}
                    aria-label={slot.available ? slot.time : t('date.slotUnavailableLabel', { time: slot.time })}
                    className={`min-h-[44px] py-3 px-2 text-sm font-medium border rounded-lg transition-all relative overflow-hidden ${
                      !slot.available
                        ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 line-through'
                        : isSelected
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-md z-10'
                          : 'border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 bg-white hover:bg-zinc-50'
                    }`}
                  >
                    {isSelected && <div className="absolute inset-0 bg-white/10 animate-pulse" aria-hidden="true"></div>}
                    {slot.time}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
