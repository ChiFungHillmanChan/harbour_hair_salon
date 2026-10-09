'use client';

import { useEffect, useTransition } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addDays, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import { ScheduleWeekGrid, type WeekStylist } from './ScheduleWeekGrid';
import { AppointmentDialog, type DialogService, type DialogTarget } from './AppointmentDialog';
import type { CalendarAppointment, PendingAppointment, RescheduleRequestRow } from '@/app/services/admin-calendar-data';
import { RescheduleRequestActions } from './RescheduleRequestActions';
import { ScheduleDayGrid, type GridAppointment, type GridBusyBlock, type GridStylist } from './ScheduleDayGrid';
import { resolveCalendarColor } from '@/app/lib/calendar-colors';
import { formatSalonTime, resolveSalonDateTime, salonDateKey } from '@/app/services/salon-time';
import type { CalendarView } from '@/app/services/admin-calendar-range';
import { moveAppointmentByAdmin } from '@/app/actions/admin-schedule';
import { weekDayKeys } from '@/app/services/admin-calendar-range';
import { calendarBusyForDay, calendarBusyLabel, isWholeDayBlock, salonWorkingWindow } from '@/app/lib/calendar-busy-display';
import { payloadArrival, shouldRefreshCalendar } from '@/app/services/calendar-sync-window';
import { describeBoardPrice } from '@/app/lib/board-price';
import { useLocale, useT } from '@/i18n/client';
import { useLocalizedRouter } from '@/i18n/navigation';
import { useDraftState } from '@/i18n/draft-store';
import { formatCalendarDay, formatMonth, formatMonthName, formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';

// Browser arrival time of each server payload this tab has shown; see payloadArrival.
const payloadFirstSeen = new Map<string, number>();

type AppointmentWithDetails = CalendarAppointment;

type RosterStylist = {
  id: string;
  name: string;
  calendarColor: string | null;
  availabilities: { dayOfWeek: number; startTime: string; endTime: string; isOff: boolean }[];
};

type BusyBlockRow = GridBusyBlock;

type ScheduleT = Translate<Messages['adminSchedule']>;

/** A known Sunday, for weekday column labels in the page language. */
const WEEK_FROM_SUNDAY = ['2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05', '2023-01-06', '2023-01-07'];

/** Status codes stay stable; only their label follows the page language. */
const statusLabel = (t: ScheduleT, status: string) => t.dynamic(`status.${status}`, undefined, status);

const statusChipClass = (status: string) =>
  status === 'CONFIRMED'
    ? 'bg-green-100 text-green-700'
    : status === 'PENDING'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-zinc-100 text-zinc-600';

async function setAppointmentStatus(
  apptId: string,
  status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED',
  onDone: () => void,
  failed: string,
) {
  const { updateAppointmentStatus } = await import('@/app/actions/admin');
  const res = await updateAppointmentStatus(apptId, status);
  if (res.success) { onDone(); } else { alert(res.error ?? failed); }
}

// Approve / decline buttons for a PENDING booking request (double-confirm flow:
// customers submit requests, the salon confirms them here). Confirming can take
// a few seconds because out-of-date marketplace feeds are re-imported first, so
// both buttons show progress and cannot be pressed twice.
function PendingActions({ apptId, onDone }: { apptId: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const t = useT('adminSchedule');
  const run = (status: 'CONFIRMED' | 'CANCELLED') =>
    startTransition(async () => { await setAppointmentStatus(apptId, status, onDone, t('appointment.updateFailed')); });
  return (
    <div className="flex gap-2" aria-busy={pending}>
      <button
        type="button"
        disabled={pending}
        onClick={() => run('CONFIRMED')}
        className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? t('pending.checking') : t('pending.confirm')}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(t('pending.declineConfirm'))) {
            run('CANCELLED');
          }
        }}
        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
      >
        {t('pending.decline')}
      </button>
    </div>
  );
}

interface YearViewProps {
  currentDate: Date;
  onSelectMonth: (date: Date) => void;
  monthCounts: number[];
}

const YearView = ({ currentDate, onSelectMonth, monthCounts }: YearViewProps) => {
  const t = useT('adminSchedule');
  const yearStart = startOfYear(currentDate);
  const yearEnd = endOfYear(currentDate);
  const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {months.map((month, index) => {
          return (
            <button 
              key={month.toString()} 
              onClick={() => onSelectMonth(month)}
              className="bg-white p-4 rounded-lg shadow hover:bg-zinc-50 text-left border border-zinc-200"
            >
              <h3 className="font-bold text-zinc-900">{formatMonthName(t.locale, index + 1)}</h3>
              <p className="text-sm text-zinc-700">{t('year.bookings', { count: monthCounts[index] ?? 0 })}</p>
            </button>
          );
      })}
    </div>
  );
};

interface MonthViewProps {
  currentDate: Date;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  getDayAppointments: (date: Date) => AppointmentWithDetails[];
}

const MonthView = ({ currentDate, selectedDate, setSelectedDate, getDayAppointments }: MonthViewProps) => {
  const t = useT('adminSchedule');
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = WEEK_FROM_SUNDAY.map((key) => formatCalendarDay(t.locale, key, { weekday: 'short' }));

  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
        {weekDays.map(day => (
          <div key={day} className="py-2 text-center text-xs font-bold text-zinc-700 uppercase tracking-wide">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const dayAppts = getDayAppointments(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = isSameDay(day, selectedDate);
          const isTodayDate = format(day, 'yyyy-MM-dd') === salonDateKey(new Date());

          return (
            <div 
              key={day.toString()}
              onClick={() => {
                setSelectedDate(day);
              }}
              className={`min-h-[100px] p-2 border-b border-r border-zinc-100 cursor-pointer transition-colors
                ${!isCurrentMonth ? 'bg-zinc-100 text-zinc-400' : 'bg-white text-zinc-900'}
                ${isSelected ? 'bg-zinc-100 ring-1 ring-inset ring-zinc-900' : !isCurrentMonth ? 'hover:bg-zinc-200/70' : 'hover:bg-zinc-50'}
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full
                  ${isTodayDate ? 'bg-red-500 text-white' : isCurrentMonth ? 'text-zinc-900' : 'text-zinc-400'}
                `}>
                  {format(day, 'd')}
                </span>
                {dayAppts.length > 0 && (
                  <span className="text-[10px] bg-zinc-200 text-zinc-600 px-1.5 rounded-full">
                    {dayAppts.length}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayAppts.slice(0, 3).map(appt => (
                  <div
                    key={appt.id}
                    // Pending stays amber so an unconfirmed request is never
                    // disguised as a booked one by a stylist's colour.
                    className={`text-[10px] truncate rounded px-1 py-0.5 ${
                      appt.status === 'PENDING'
                        ? 'bg-amber-600 text-white'
                        : `${resolveCalendarColor(appt.stylist.calendarColor).fill} ${resolveCalendarColor(appt.stylist.calendarColor).text}`
                    }`}
                  >
                    {formatSalonClock(t.locale, new Date(appt.date))} {appt.user.name}
                  </div>
                ))}
                {dayAppts.length > 3 && (
                  <div className="text-[10px] text-zinc-400 pl-1">
                    {t('month.more', { count: dayAppts.length - 3 })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface DayViewProps {
  dateStr: string;
  dayAppts: AppointmentWithDetails[];
  busyBlocks: ReturnType<typeof calendarBusyForDay>;
  stylists: RosterStylist[];
  onRefresh: () => void;
  onEdit: (appointment: AppointmentWithDetails) => void;
}

/** "3 appointments · 1 imported" */
function dayCountLabel(t: ScheduleT, appointments: number, imported: number): string {
  const count = t('day.appointments', { count: appointments });
  return imported > 0 ? `${count} · ${t('day.imported', { count: imported })}` : count;
}

function BusyAgenda({ blocks, stylists, dayKey }: { blocks: ReturnType<typeof calendarBusyForDay>; stylists: RosterStylist[]; dayKey: string }) {
  const t = useT('adminSchedule');
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  const hoursOf = (entry: RosterStylist | undefined) => {
    const row = entry?.availabilities.find((a) => a.dayOfWeek === weekday && !a.isOff);
    return row ? { startTime: row.startTime, endTime: row.endTime } : null;
  };
  const salonWindow = salonWorkingWindow(stylists.map(hoursOf));
  return <ul className="divide-y divide-zinc-100">
    {blocks.map((block) => {
      const entry = stylists.find((candidate) => candidate.id === block.stylistId);
      const stylist = entry?.name ?? t('appointment.stylistFallback');
      const wholeDay = isWholeDayBlock(block, hoursOf(entry) ?? salonWindow);
      const label = calendarBusyLabel(block, stylist, block.startMin, block.endMin, t, wholeDay);
      return <li key={block.id} role="note" aria-label={label.detail} className="border-l-4 border-l-zinc-400 bg-zinc-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2 font-semibold text-zinc-800"><span>{label.provider}</span><span className="tabular-nums">{label.range}</span></div>
        <p className="mt-1 text-zinc-600">{wholeDay ? t('busy.agendaUnavailable', { stylist }) : t('busy.agendaImported', { stylist })}</p>
        <p className="mt-1 text-xs text-zinc-500">{t('busy.agendaSynced', { synced: label.synced })}</p>
      </li>;
    })}
  </ul>;
}

const DayView = ({ dateStr, dayAppts, busyBlocks, stylists, onRefresh, onEdit }: DayViewProps) => {
  const t = useT('adminSchedule');
  const tp = useT('pricing');
  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden flex flex-col">
      <div className="p-4 border-b border-zinc-200 bg-zinc-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">{formatCalendarDay(t.locale, dateStr, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <span className="text-sm text-zinc-500">{dayCountLabel(t, dayAppts.length, busyBlocks.length)}</span>
      </div>
      <div className="divide-y divide-zinc-100 overflow-y-auto max-h-[600px]">
          {dayAppts.length === 0 && busyBlocks.length === 0 ? (
              <div className="p-12 text-center text-zinc-500">{t('day.empty')}</div>
          ) : (
              dayAppts.map(appt => {
                // The price recorded on the booking, or "Price not recorded" —
                // never today's service price.
                const price = describeBoardPrice(appt.price, tp);
                return (
                  <div key={appt.id} className="flex p-4 hover:bg-zinc-50 group">
                      <div className="w-20 flex-shrink-0 text-zinc-700 text-sm pt-1 font-medium">
                          {formatSalonClock(t.locale, new Date(appt.date))}
                      </div>
                      <div className="flex-1 bg-zinc-50 rounded-lg p-3 border border-zinc-200 group-hover:border-zinc-300 transition-colors">
                          <div className="flex justify-between items-start">
                              <div>
                                  <h4 className="font-semibold text-zinc-900">{appt.user.name}</h4>
                                  <p className="text-zinc-600 text-sm">{appt.service.name} • {tp('minutes', { count: appt.durationAtBooking ?? appt.service.duration })}</p>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusChipClass(appt.status)}`}>
                                  {statusLabel(t, appt.status)}
                              </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                              <span>{t('appointment.stylist', { name: appt.stylist.name })}</span>
                              <span>
                                <span className="font-medium text-zinc-700 tabular-nums">{price.amount}</span>
                                {price.notes.length > 0 && <span className="ml-1">({price.notes.join(' · ')})</span>}
                              </span>
                          </div>
                          <button type="button" onClick={() => onEdit(appt)} className="mt-2 mr-2 rounded border border-zinc-300 px-3 py-2 text-xs font-semibold text-[#174F7F] hover:bg-white">{t('appointment.edit')}</button>
                          {appt.status === 'PENDING' && (
                            <div className="mt-2">
                              <PendingActions apptId={appt.id} onDone={onRefresh} />
                            </div>
                          )}
                          {appt.status === 'CONFIRMED' && (
                            <button
                              type="button"
                              onClick={() => setAppointmentStatus(appt.id, 'COMPLETED', onRefresh, t('appointment.updateFailed'))}
                              className="mt-2 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                            >
                              {t('appointment.markCompleted')}
                            </button>
                          )}
                      </div>
                  </div>
                );
              })
          )}
          <BusyAgenda blocks={busyBlocks} stylists={stylists} dayKey={dateStr} />
      </div>
    </div>
  );
};

export function ScheduleCalendar({
  dateStr,
  view,
  appointments,
  pendingAppointments,
  rescheduleRequests,
  stylists,
  busyBlocks,
  services = [],
  monthCounts = [],
  pendingNext = null,
  pendingHasPrevious = false,
  loadedAt,
}: {
  dateStr: string;
  view: CalendarView;
  appointments: AppointmentWithDetails[];
  pendingAppointments: PendingAppointment[];
  rescheduleRequests: RescheduleRequestRow[];
  stylists: RosterStylist[];
  busyBlocks: BusyBlockRow[];
  services?: DialogService[];
  monthCounts?: number[];
  pendingNext?: string | null;
  pendingHasPrevious?: boolean;
  loadedAt?: string;
}) {
  // The period and date live in the URL, so a language switch keeps them; the
  // localized router keeps every navigation in the current language.
  const router = useLocalizedRouter();
  const t = useT('adminSchedule');
  const locale = useLocale();
  const [isNavigating, startNavigation] = useTransition();
  // date-fns uses local calendar fields. This noon date is only a display carrier
  // for the requested London calendar day, never an appointment instant.
  const currentDate = new Date(`${dateStr}T12:00:00`);
  // Client-only board state (the month's picked day, an open booking dialog)
  // survives an interface-language switch; see i18n/draft-store.
  const [localSelection, setLocalSelection] = useDraftState<{ month: string; date: string } | null>('schedule-board:selection', null);
  const [dialog, setDialog] = useDraftState<DialogTarget | null>('schedule-board:dialog', null);
  const selectedDate = localSelection?.month === dateStr.slice(0, 7) ? new Date(`${localSelection.date}T12:00:00`) : currentDate;
  const viewMode = view;
  const navigate = (date: Date, nextView: CalendarView = viewMode) => {
    const params = new URLSearchParams({ date: format(date, 'yyyy-MM-dd'), view: nextView });
    startNavigation(() => router.push(`/admin?${params}`, { scroll: false }));
  };
  const setViewMode = (nextView: CalendarView) => navigate(currentDate, nextView);

  // Local timer only; hidden or overnight boards must not hold Neon awake.
  // `lastLoaded` uses the BROWSER clock, like `now` below: `loadedAt` is server
  // time, and comparing it with a fast device clock refreshed every minute. A
  // payload restored by Back/Forward keeps its first arrival time, so it still
  // refreshes after the next import. The effect re-runs on every new `loadedAt`.
  useEffect(() => {
    let lastLoaded = new Date(payloadArrival(payloadFirstSeen, loadedAt, Date.now()));
    const hours = stylists.flatMap(stylist => stylist.availabilities);
    const refreshIfVisible = () => {
      const now = new Date();
      if (shouldRefreshCalendar(hours, now, lastLoaded, document.visibilityState === 'visible')) {
        lastLoaded = now;
        router.refresh();
      }
    };
    const id = setInterval(refreshIfVisible, 60_000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [router, stylists, loadedAt]);

  // Navigation Handlers
  const step = (direction: 1 | -1) => {
    if (viewMode === 'day') navigate(addDays(currentDate, direction));
    else if (viewMode === 'week') navigate(addDays(currentDate, 7 * direction));
    else if (viewMode === 'month') navigate(direction === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    else navigate(direction === 1 ? addMonths(currentDate, 12) : subMonths(currentDate, 12));
  };

  const next = () => step(1);
  const prev = () => step(-1);

  const goToToday = () => {
    navigate(new Date(`${salonDateKey(new Date())}T12:00:00`));
  };

  const appointmentsByDay = new Map<string, CalendarAppointment[]>();
  for (const appointment of appointments) {
    const key = salonDateKey(new Date(appointment.date));
    const bucket = appointmentsByDay.get(key) ?? [];
    bucket.push(appointment);
    appointmentsByDay.set(key, bucket);
  }
  const getDayAppointments = (date: Date) => appointmentsByDay.get(format(date, 'yyyy-MM-dd')) ?? [];
  const pendingPage = (cursor?: string) => {
    const params = new URLSearchParams({ date: dateStr, view });
    if (cursor) params.set('pending', cursor);
    startNavigation(() => router.push(`/admin?${params}`, { scroll: false }));
  };

  // Shapes the grid needs. Working hours are resolved for the day on show, and
  // a stylist only gets a column if they work that day or already have work in
  // the diary for it — an empty column for someone who is off is just noise.
  const salonWeekday = new Date(currentDate).getDay();
  const dayKey = dateStr;
  const busyForDay: GridBusyBlock[] = busyBlocks.map((block) => ({
    ...block,
    id: block.id,
    stylistId: block.stylistId,
    start: new Date(block.start).toISOString(),
    end: new Date(block.end).toISOString(),
  }));
  const gridBusyBlocks = busyForDay;
  const gridAppointments: GridAppointment[] = appointments
    .filter((appt) => salonDateKey(new Date(appt.date)) === dayKey)
    .map((appt) => ({
      id: appt.id,
      stylistId: appt.stylistId,
      date: new Date(appt.date).toISOString(),
      durationMin: appt.durationAtBooking ?? appt.service.duration,
      status: appt.status,
      customerName: appt.user.name,
      serviceName: appt.service.name,
      serviceColor: appt.service.calendarColor,
      updatedAt: new Date(appt.updatedAt).toISOString(),
      moveRequested: Boolean(appt.rescheduleRequestedAt),
    }));
  const weekKeys = weekDayKeys(dateStr);
  const weekAppointments: GridAppointment[] = appointments.map((appt) => ({
    id: appt.id,
    stylistId: appt.stylistId,
    date: new Date(appt.date).toISOString(),
    durationMin: appt.durationAtBooking ?? appt.service.duration,
    status: appt.status,
    customerName: appt.user.name,
    serviceName: appt.service.name,
    serviceColor: appt.service.calendarColor,
    updatedAt: new Date(appt.updatedAt).toISOString(),
    moveRequested: Boolean(appt.rescheduleRequestedAt),
  }));
  const weekStylists: WeekStylist[] = stylists.map((stylist) => ({
    id: stylist.id,
    name: stylist.name,
    calendarColor: stylist.calendarColor,
    availability: null,
    availabilityByWeekday: Object.fromEntries(
      stylist.availabilities
        .filter((a) => !a.isOff)
        .map((a) => [a.dayOfWeek, { startTime: a.startTime, endTime: a.endTime }]),
    ),
  }));

  // Opening a booking needs the row behind the block, not just its grid shape.
  const appointmentById = new Map(appointments.map((appt) => [appt.id, appt]));
  const openEditor = (grid: Pick<GridAppointment, 'id'>) => {
    const appt = appointmentById.get(grid.id);
    if (!appt) return;
    setDialog({
      mode: 'edit',
      appointmentId: appt.id,
      dateStr: salonDateKey(new Date(appt.date)),
      time: formatSalonTime(new Date(appt.date)),
      stylistId: appt.stylistId,
      serviceId: appt.serviceId,
      durationMin: appt.durationAtBooking ?? appt.service.duration,
      notes: appt.notes ?? '',
      customerName: appt.user.name ?? t('appointment.customerFallback'),
      status: appt.status,
      updatedAt: appt.updatedAt,
      price: appt.price,
      rescheduleRequestedDate: appt.rescheduleRequestedDate,
      rescheduleRequestedAt: appt.rescheduleRequestedAt,
    });
  };
  const closeDialog = () => setDialog(null);
  const savedDialog = () => { setDialog(null); router.refresh(); };

  const busyStylistIds = new Set([
    ...gridAppointments.map((appt) => appt.stylistId),
    ...gridBusyBlocks.map((block) => block.stylistId),
  ]);
  const gridStylists: GridStylist[] = stylists
    .map((stylist) => {
      const availability = stylist.availabilities.find((a) => a.dayOfWeek === salonWeekday && !a.isOff);
      return {
        id: stylist.id,
        name: stylist.name,
        calendarColor: stylist.calendarColor,
        availability: availability ? { startTime: availability.startTime, endTime: availability.endTime } : null,
      };
    })
    .filter((stylist) => stylist.availability !== null || busyStylistIds.has(stylist.id));

  const title = viewMode === 'year'
    ? formatCalendarDay(locale, dateStr, { year: 'numeric' })
    : viewMode === 'week'
      ? `${formatCalendarDay(locale, weekKeys[0], { day: 'numeric', month: 'short' })} – ${formatCalendarDay(locale, weekKeys[6], { day: 'numeric', month: 'short', year: 'numeric' })}`
      : viewMode === 'day'
        ? formatCalendarDay(locale, dateStr, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : formatMonth(locale, Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)));
  const selectedKey = format(selectedDate, 'yyyy-MM-dd');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600">
        <p>
          {loadedAt && <>{t('refresh.loadedAt', { date: formatSalonLongDate(locale, new Date(loadedAt)), time: formatSalonClock(locale, new Date(loadedAt)) })} </>}
          {view === 'year' ? t('refresh.yearNote') : t('refresh.autoNote')}
          {' '}{t('refresh.savedNote')}
        </p>
        <button type="button" onClick={() => startNavigation(() => router.refresh())} disabled={isNavigating} className="shrink-0 rounded border border-zinc-300 px-3 py-2 font-semibold text-[#174F7F] disabled:opacity-50">{t('refresh.button')}</button>
      </div>
      {(pendingAppointments.length > 0 || pendingHasPrevious) && (
        <section aria-label={t('pending.sectionLabel')} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">{t('pending.title')}</h2>
          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-amber-200">
            {pendingAppointments.map((appt) => (
              <div key={appt.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <button type="button" onClick={() => navigate(new Date(`${salonDateKey(new Date(appt.date))}T12:00:00`), 'day')} className="text-left text-sm font-medium text-zinc-900 underline">
                    {t('pending.item', { date: formatSalonLongDate(locale, new Date(appt.date)), time: formatSalonClock(locale, new Date(appt.date)), customer: appt.user.name ?? t('appointment.customerFallback') })}
                  </button>
                  <p className="text-sm text-zinc-600">{t('appointment.withStylist', { service: appt.service.name, stylist: appt.stylist.name })}</p>
                </div>
                <PendingActions apptId={appt.id} onDone={() => router.refresh()} />
              </div>
            ))}
          </div>
          {(pendingNext || pendingHasPrevious) && <nav aria-label={t('pending.pagination')} className="mt-3 flex gap-4 text-sm underline">
            {pendingHasPrevious && <button type="button" onClick={() => pendingPage()}>{t('pending.firstPage')}</button>}
            {pendingNext && <button type="button" onClick={() => pendingPage(pendingNext)}>{t('pending.nextPage')}</button>}
          </nav>}
        </section>
      )}
      {rescheduleRequests.length > 0 && (
        <section aria-label={t('rescheduleRequests.sectionLabel')} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">{t('rescheduleRequests.title')}</h2>
          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-amber-200">
            {rescheduleRequests.map((request) => {
              const from = `${formatSalonLongDate(locale, new Date(request.date))} ${formatSalonClock(locale, new Date(request.date))}`;
              const to = `${formatSalonLongDate(locale, new Date(request.requestedDate))} ${formatSalonClock(locale, new Date(request.requestedDate))}`;
              return (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {t('rescheduleRequests.item', { customer: request.user.name ?? t('appointment.customerFallback'), service: request.service.name, stylist: request.stylist.name })}
                      {request.user.phone && <> · <a href={`tel:${request.user.phone}`} className="underline">{request.user.phone}</a></>}
                    </p>
                    <p className="text-sm text-zinc-700">
                      {t('rescheduleRequests.move', { from, to })}{' '}
                      <span className="text-zinc-500">({t('rescheduleRequests.asked', { when: `${formatSalonLongDate(locale, new Date(request.requestedAt))} ${formatSalonClock(locale, new Date(request.requestedAt))}` })})</span>
                    </p>
                    {request.expired && <p className="text-xs font-medium uppercase text-zinc-500">{t('rescheduleRequests.expired')}</p>}
                  </div>
                  <RescheduleRequestActions appointmentId={request.id} requestedAt={request.requestedAt} expired={request.expired} onDone={() => router.refresh()} />
                </div>
              );
            })}
          </div>
        </section>
      )}
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg shadow border border-zinc-200">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md shadow-sm" role="group" aria-label={t('views.label')}>
            {(['day', 'week', 'month', 'year'] as const).map((period, index, all) => (
              <button
                key={period}
                onClick={() => setViewMode(period)}
                aria-pressed={viewMode === period}
                className={`px-3 sm:px-4 py-2 text-sm font-medium border-t border-b border-gray-200 capitalize
                  ${index === 0 ? 'border-l rounded-l-lg' : ''}
                  ${index === all.length - 1 ? 'border-r rounded-r-lg' : ''}
                  ${viewMode === period ? 'bg-zinc-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}
              >
                {t(`views.${period}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={prev} disabled={isNavigating} aria-label={t('toolbar.previous')} className="p-2 hover:bg-zinc-100 rounded-full disabled:opacity-50">
             ←
          </button>
          <h2 className="text-xl font-bold min-w-[200px] text-center">
            {title}
          </h2>
          <button onClick={next} disabled={isNavigating} aria-label={t('toolbar.next')} className="p-2 hover:bg-zinc-100 rounded-full disabled:opacity-50">
             →
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={goToToday} className="text-sm font-medium text-zinc-900 hover:underline">
            {t('toolbar.today')}
          </button>
          {viewMode !== 'year' && services.some((service) => service.isBookable) && stylists.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog({ mode: 'create', dateStr, time: formatSalonTime(new Date()) })}
              className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              {t('toolbar.newBooking')}
            </button>
          )}
        </div>
      </div>
      {isNavigating && <p role="status" className="text-sm text-zinc-600">{t('toolbar.loading')}</p>}

      {/* Content */}
      <div>
        {viewMode === 'year' && (
          <YearView 
            currentDate={currentDate}
            onSelectMonth={(month) => navigate(month, 'month')}
            monthCounts={monthCounts}
          />
        )}
        {viewMode === 'month' && (
          <MonthView 
            currentDate={currentDate}
            selectedDate={selectedDate}
            setSelectedDate={(date) => {
              const nextDate = format(date, 'yyyy-MM-dd');
              if (nextDate.slice(0, 7) !== dateStr.slice(0, 7)) navigate(date);
              else setLocalSelection({ month: dateStr.slice(0, 7), date: nextDate });
            }}
            getDayAppointments={getDayAppointments}
          />
        )}
        {viewMode === 'week' && (
          <>
            {/* Seven columns of draggable blocks need a pointer and a screen;
                the phone gets the same week as a scrollable agenda instead. */}
            <div className="hidden md:block">
              <ScheduleWeekGrid
                dayKeys={weekKeys}
                todayKey={salonDateKey(new Date())}
                stylists={weekStylists}
                appointments={weekAppointments}
                busyBlocks={gridBusyBlocks}
                onMove={moveAppointmentByAdmin}
                onMoved={() => router.refresh()}
                onSelect={openEditor}
                onCreate={(day, time) => setDialog({ mode: 'create', dateStr: day, time })}
              />
            </div>
            <div className="md:hidden space-y-3">
              {weekKeys.map((key) => {
                const dayAppts = getDayAppointments(new Date(`${key}T12:00:00`));
                const dayBusy = calendarBusyForDay(gridBusyBlocks, key);
                return (
                  <div key={key} className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => navigate(new Date(`${key}T12:00:00`), 'day')}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left ${key === salonDateKey(new Date()) ? 'bg-zinc-900 text-white' : 'bg-zinc-50 text-zinc-900'}`}
                    >
                      <span className="font-semibold">{formatCalendarDay(locale, key, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                      <span className="text-xs opacity-80">{dayCountLabel(t, dayAppts.length, dayBusy.length)}</span>
                    </button>
                    {dayAppts.length === 0 && dayBusy.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-zinc-500">{t('day.nothingBooked')}</p>
                    ) : (
                      <ul className="divide-y divide-zinc-100">
                        {dayAppts.map((appt) => (
                          <li key={appt.id} className="px-4 py-2 text-sm">
                            <span className="font-medium text-zinc-900">{formatSalonClock(locale, new Date(appt.date))}</span>
                            <span className="ml-2 text-zinc-700">{appt.user.name}</span>
                            <span className={`ml-2 inline-block rounded px-2 py-1 text-xs font-medium ${statusChipClass(appt.status)}`}>{statusLabel(t, appt.status)}</span>
                            <span className="block text-xs text-zinc-500">{t('appointment.withStylist', { service: appt.service.name, stylist: appt.stylist.name })}</span>
                            <button type="button" onClick={() => openEditor(appt)} className="mt-2 rounded border border-zinc-300 px-3 py-2 text-xs font-semibold text-[#174F7F] hover:bg-zinc-50">{t('appointment.edit')}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <BusyAgenda blocks={dayBusy} stylists={stylists} dayKey={key} />
                  </div>
                );
              })}
            </div>
          </>
        )}
        {viewMode === 'day' && (
          <>
            {/* Dragging inside a multi-column time grid is unusable on a phone,
                so the grid is sm:+ only and the list remains the mobile view. */}
            <div className="hidden sm:block">
              <ScheduleDayGrid
                day={resolveSalonDateTime(dateStr, '12:00').utc}
                stylists={gridStylists}
                appointments={gridAppointments}
                busyBlocks={gridBusyBlocks}
                onMove={moveAppointmentByAdmin}
                onMoved={() => router.refresh()}
                onSelect={openEditor}
                onCreate={(day, time, stylistId) => setDialog({ mode: 'create', dateStr: day, time, stylistId })}
              />
            </div>
            <div className="sm:hidden">
              <DayView
                dateStr={dateStr}
                dayAppts={getDayAppointments(currentDate)}
                busyBlocks={calendarBusyForDay(gridBusyBlocks, dateStr)}
                stylists={stylists}
                onRefresh={() => router.refresh()}
                onEdit={openEditor}
              />
            </div>
          </>
        )}
      </div>
      
      {viewMode === 'month' && (
         <div className="mt-6">
             <h3 className="text-lg font-bold mb-4">{t('month.selectedDate', { date: formatCalendarDay(locale, selectedKey, { day: 'numeric', month: 'short', year: 'numeric' }) })}</h3>
             <div className="bg-white rounded-lg shadow border border-zinc-200 p-6">
                 {getDayAppointments(selectedDate).length > 0 ? (
                     <div className="space-y-4">
                         {getDayAppointments(selectedDate).map(appt => (
                             <div key={appt.id} className="flex justify-between items-center border-b border-zinc-100 last:border-0 pb-2 last:pb-0">
                                 <div>
                                     <p className="font-medium text-zinc-900">{formatSalonClock(locale, new Date(appt.date))} - {appt.user.name}</p>
                                     <p className="text-sm text-zinc-500">{t('appointment.withStylist', { service: appt.service.name, stylist: appt.stylist.name })}</p>
                                 </div>
                                 <div className="flex flex-wrap items-center gap-2">
                                     <button type="button" onClick={() => openEditor(appt)} className="rounded border border-zinc-300 px-3 py-2 text-xs font-semibold text-[#174F7F] hover:bg-zinc-50">{t('appointment.edit')}</button>
                                     <div className={`text-xs px-2 py-1 rounded font-medium ${statusChipClass(appt.status)}`}>
                                         {statusLabel(t, appt.status)}
                                     </div>
                                     {appt.status === 'PENDING' && (
                                       <PendingActions apptId={appt.id} onDone={() => router.refresh()} />
                                     )}
                                     {appt.status === 'CONFIRMED' && (
                                       <button
                                         type="button"
                                         onClick={() => setAppointmentStatus(appt.id, 'COMPLETED', () => router.refresh(), t('appointment.updateFailed'))}
                                         className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                                       >
                                         {t('appointment.markCompleted')}
                                       </button>
                                     )}
                                 </div>
                             </div>
                         ))}
                     </div>
                 ) : (
                     <p className="text-zinc-500">{t('month.noneSelected')}</p>
                 )}
             </div>
         </div>
      )}

      {dialog && (
        <AppointmentDialog
          key={dialog.mode === 'edit' ? dialog.appointmentId : 'new'}
          target={dialog}
          services={services}
          stylists={stylists.map(({ id, name }) => ({ id, name }))}
          onClose={closeDialog}
          onSaved={savedDialog}
        />
      )}
    </div>
  );
}
