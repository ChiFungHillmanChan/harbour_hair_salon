'use client';

import type { CalendarAppointment } from '@/app/services/admin-calendar-data';
import { salonDateKey } from '@/app/services/salon-time';
import { useLocale, useT } from '@/i18n/client';
import { formatCalendarDay, formatSalonClock } from '@/i18n/dates';
import { DepositChip } from './DepositChip';

/**
 * The cancelled bookings of the day or week on show, under the day and week
 * grids. The grids leave a cancelled booking out (its time is free again), so
 * on a tablet or computer it could only be opened from the month view — and
 * its dialog is where staff record a refund settled outside the website or
 * re-check a deposit. The phone's agenda lists cancelled bookings already.
 */
export function ScheduleCancelledList({ appointments, showDay, onEdit }: {
  appointments: CalendarAppointment[];
  /** The week lists several days: each row says which. */
  showDay: boolean;
  onEdit: (appointment: CalendarAppointment) => void;
}) {
  const t = useT('adminSchedule');
  const locale = useLocale();
  const cancelled = appointments
    .filter((appt) => appt.status === 'CANCELLED')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (cancelled.length === 0) return null;
  return (
    <section aria-label={t('cancelled.title')} className="mt-4 rounded-lg border border-zinc-200 bg-white">
      <h3 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-900">
        {t('cancelled.title')} <span className="font-normal text-zinc-500">({cancelled.length})</span>
      </h3>
      <ul className="divide-y divide-zinc-100">
        {cancelled.map((appt) => {
          const start = new Date(appt.date);
          const when = showDay
            ? `${formatCalendarDay(locale, salonDateKey(start), { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatSalonClock(locale, start)}`
            : formatSalonClock(locale, start);
          return (
            <li key={appt.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold tabular-nums text-zinc-900">{when}</span>
                {' · '}
                <span className="text-zinc-900">{appt.user.name ?? t('appointment.customerFallback')}</span>
                <span className="block text-xs text-zinc-500">{t('appointment.withStylist', { service: appt.service.name, stylist: appt.stylist.name })}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {appt.deposit && <DepositChip deposit={appt.deposit} t={t} />}
                <button type="button" onClick={() => onEdit(appt)} className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50">
                  {t('appointment.edit')}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
