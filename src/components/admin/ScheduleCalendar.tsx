'use client';

import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addDays, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import { ScheduleWeekGrid, type WeekStylist } from './ScheduleWeekGrid';
import { AppointmentDialog, type DialogService, type DialogTarget } from './AppointmentDialog';
import { withLiveDeposit } from './dialog-target';
import type { CalendarAppointment, PendingAppointment, RescheduleRequestRow } from '@/app/services/admin-calendar-data';
import { RescheduleRequestActions } from './RescheduleRequestActions';
import { ScheduleDayGrid, type GridAppointment, type GridBusyBlock, type GridStylist } from './ScheduleDayGrid';
import { googleDisplaySwatch, stylistDisplaySwatch } from '@/app/lib/calendar-colors';
import { diaryForDay, diaryRange, type CalendarDiaryEntry, type PlacedDiaryEntry } from '@/app/lib/calendar-diary-display';
import { GoogleDiaryPanel } from './GoogleDiaryPanel';
import { ScheduleCancelledList } from './ScheduleCancelledList';
import { MobileScheduleDisclosure } from './MobileScheduleDisclosure';
import { diaryStylistNames, filterScheduleForStylist, scheduleAgenda } from '@/app/lib/schedule-agenda';
import { formatSalonTime, resolveSalonDateTime, salonDateKey } from '@/app/services/salon-time';
import type { CalendarView } from '@/app/services/admin-calendar-range';
import { moveAppointmentByAdmin } from '@/app/actions/admin-schedule';
import { weekDayKeys } from '@/app/services/admin-calendar-range';
import { calendarBusyForDay, calendarBusyLabel, isWholeDayBlock, salonWorkingWindow } from '@/app/lib/calendar-busy-display';
import { payloadArrival, shouldRefreshCalendar } from '@/app/services/calendar-sync-window';
import { describeBoardPrice } from '@/app/lib/board-price';
import { hasAppointmentStarted } from '@/app/lib/appointment-timing';
import type { DepositView } from '@/app/lib/deposit-display';
import { formatGBP } from '@/app/services/pricing/money';
import { HTML_LANG } from '@/i18n/config';
import { DepositChip } from './DepositChip';
import { useLocale, useT } from '@/i18n/client';
import { useLocalizedRouter } from '@/i18n/navigation';
import { useDraftState } from '@/i18n/draft-store';
import { formatCalendarDay, formatMonth, formatMonthName, formatSalonClock, formatSalonLongDate } from '@/i18n/dates';
import type { Translate } from '@/i18n/translator';
import type { Messages } from '@/i18n/messages/types-client';
import { displayableEmail } from '@/app/lib/walk-in-customer';

// Browser arrival time of each server payload this tab has shown; see payloadArrival.
const payloadFirstSeen = new Map<string, number>();

type AppointmentWithDetails = CalendarAppointment;

type RosterStylist = {
  id: string;
  name: string;
  calendarColor: string | null;
  googleColorId: string | null;
  availabilities: { dayOfWeek: number; startTime: string; endTime: string; isOff: boolean }[];
};

type BusyBlockRow = GridBusyBlock;

type ScheduleT = Translate<Messages['adminSchedule']>;

/** A known Sunday, for weekday column labels in the page language. */
const WEEK_FROM_SUNDAY = ['2023-01-01', '2023-01-02', '2023-01-03', '2023-01-04', '2023-01-05', '2023-01-06', '2023-01-07'];

/** Status codes stay stable; only their label follows the page language. */
const statusLabel = (t: ScheduleT, status: string) => t.dynamic(`status.${status}`, undefined, status);

/**
 * "Mark completed" is offered once a visit has begun: a confirmed booking, or a
 * request nobody confirmed whose customer came in anyway (often a staff pencil
 * in). The lapse step leaves such a request open until its appointment ends.
 */
const canMarkCompleted = (appt: { status: string; date: Date | string }) =>
  (appt.status === 'CONFIRMED' || appt.status === 'PENDING') && hasAppointmentStarted(appt.date);

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
  if (res.success) { onDone(); return; }
  alert(res.error ?? failed);
  // Refused, but something moved (a deposit's state, or the request was
  // cancelled because its time was taken): show the board as it now is.
  if (res.refresh) onDone();
}

// Approve / decline buttons for a PENDING booking request (double-confirm flow:
// customers submit requests, the salon confirms them here). Confirming can take
// a few seconds because out-of-date marketplace feeds are re-imported first, so
// both buttons show progress and cannot be pressed twice. Once the requested
// time has come the request can no longer be confirmed (the server refuses it,
// and the notifications cron closes it once the appointment has ended), so only
// Decline is offered here — beside "Mark completed" where the board shows it.
// A request holding a card deposit says so: confirming takes it, declining
// releases the hold (actions/admin.ts updateAppointmentStatus).
function PendingActions({ apptId, started, deposit, onDone }: { apptId: string; started: boolean; deposit?: DepositView | null; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const t = useT('adminSchedule');
  const run = (status: 'CONFIRMED' | 'CANCELLED') =>
    startTransition(async () => { await setAppointmentStatus(apptId, status, onDone, t('appointment.updateFailed')); });
  const held = deposit?.state === 'HELD' ? formatGBP(deposit.amountPence, HTML_LANG[t.locale]) : null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      {started ? (
        <span className="text-xs font-medium uppercase text-zinc-500">{t('pending.expired')}</span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run('CONFIRMED')}
          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? t('pending.checking') : held ? t('deposit.confirm', { amount: held }) : t('pending.confirm')}
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(held ? t('deposit.declineConfirm', { amount: held }) : t('pending.declineConfirm'))) {
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

/**
 * What "Mark completed" asks first. Completing releases a deposit hold nobody
 * took (deposit-lifecycle.ts planDepositForClosing), so staff are told to take
 * the full price in the salon; a deposit already taken counts towards it.
 */
function markCompletedQuestion(t: ScheduleT, customer: string, deposit?: DepositView | null): string {
  const amount = deposit ? formatGBP(deposit.amountPence, HTML_LANG[t.locale]) : '';
  if (deposit?.state === 'HELD') return t('deposit.completeHeldConfirm', { customer, amount });
  if (deposit?.state === 'PAID') return t('deposit.completePaidConfirm', { customer, amount });
  return t('appointment.markCompletedConfirm', { customer });
}

// Completion cannot be undone (and the server refuses it before the start
// time), so the control appears only once the visit has begun and asks first.
// "Now" is the browser's clock at render; the board re-renders on refresh.
function MarkCompletedButton({ apptId, customer, deposit, onDone, className }: { apptId: string; customer: string; deposit?: DepositView | null; onDone: () => void; className: string }) {
  const [pending, startTransition] = useTransition();
  const t = useT('adminSchedule');
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(markCompletedQuestion(t, customer, deposit))) return;
        startTransition(async () => { await setAppointmentStatus(apptId, 'COMPLETED', onDone, t('appointment.updateFailed')); });
      }}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {t('appointment.markCompleted')}
    </button>
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
              className={`min-h-[76px] min-w-0 p-1 sm:min-h-[100px] sm:p-2 border-b border-r border-zinc-100 cursor-pointer transition-colors
                ${!isCurrentMonth ? 'bg-zinc-100 text-zinc-400' : 'bg-white text-zinc-900'}
                ${isSelected ? 'bg-zinc-100 ring-1 ring-inset ring-zinc-900' : !isCurrentMonth ? 'hover:bg-zinc-200/70' : 'hover:bg-zinc-50'}
              `}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={`text-xs sm:text-sm font-medium w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full
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
                    className={`relative text-[10px] truncate rounded pl-2 pr-1 py-0.5 ${
                      appt.status === 'PENDING'
                        ? 'bg-amber-50 text-amber-950'
                        : `${stylistDisplaySwatch(appt.stylist).fill} ${stylistDisplaySwatch(appt.stylist).text}`
                    }`}
                  >
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-0.5 ${stylistDisplaySwatch(appt.stylist).stripe}`} />
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
  busyBlocks: ReturnType<typeof calendarBusyForDay<GridBusyBlock>>;
  /** The day's Google diary entries, then its notes. */
  diary: PlacedDiaryEntry[];
  stylists: RosterStylist[];
  onRefresh: () => void;
  onEdit: (appointment: AppointmentWithDetails) => void;
  onSelectDiary: (entry: CalendarDiaryEntry) => void;
  onSelectDay?: () => void;
}

/** "3 appointments · 1 imported · 2 Google diary bookings" */
function dayCountLabel(t: ScheduleT, appointments: number, imported: number, diary: PlacedDiaryEntry[]): string {
  // The diary's bookings only: its leave and notes are not appointments.
  const diaryBookings = diary.filter((entry) => entry.kind === 'STYLIST' || entry.kind === 'UNASSIGNED').length;
  return [
    t('day.appointments', { count: appointments }),
    ...(imported > 0 ? [t('day.imported', { count: imported })] : []),
    ...(diaryBookings > 0 ? [t('day.googleDiary', { count: diaryBookings })] : []),
  ].join(' · ');
}

function BusyAgenda({ blocks, stylists, dayKey }: { blocks: ReturnType<typeof calendarBusyForDay<GridBusyBlock>>; stylists: RosterStylist[]; dayKey: string }) {
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
      const line = wholeDay ? t('busy.agendaUnavailable', { stylist })
        : label.kind === 'blocked' ? t('busy.agendaBlocked', { stylist })
        : label.kind === 'booking' ? t('busy.agendaBooking', { stylist, provider: label.brand })
        : t('busy.agendaImported', { stylist });
      return <li key={block.id} role="note" aria-label={label.detail} className={`border-l-4 border-l-zinc-400 px-4 py-3 text-sm ${label.kind === 'blocked' && !wholeDay ? 'bg-[repeating-linear-gradient(135deg,var(--color-zinc-100)_0_1px,var(--color-white)_1px_8px)]' : 'bg-zinc-50'}`}>
        <div className="flex flex-wrap justify-between gap-2 font-semibold text-zinc-800"><span>{label.provider}</span><span className="tabular-nums">{label.range}</span></div>
        <p className="mt-1 text-zinc-600">{line}</p>
        <p className="mt-1 text-xs text-zinc-500">{t('busy.agendaSynced', { synced: label.synced })}</p>
      </li>;
    })}
  </ul>;
}

/** The phone's view of the salon's Google diary for one day: a line per entry, each opening the read-only panel. */
function DiaryAgenda({ entries, stylists, onSelect }: { entries: PlacedDiaryEntry[]; stylists: RosterStylist[]; onSelect: (entry: CalendarDiaryEntry) => void }) {
  const t = useT('adminSchedule');
  if (entries.length === 0) return null;
  return <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
    {entries.map((entry) => (
      <li key={entry.id}>
        <button type="button" onClick={() => onSelect(entry)} className={`relative flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-zinc-900 ${googleDisplaySwatch(entry.colorId).fill}`}>
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${googleDisplaySwatch(entry.colorId).stripe}`} />
          <span className="w-full font-semibold tabular-nums text-zinc-900">{entry.allDay ? t('diary.allDay') : diaryRange(entry)}</span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-zinc-900">{entry.title || t('diary.noTitle')}</span>
            <span className="block font-medium text-zinc-700">{diaryStylistNames(entry, stylists).join(' · ') || (entry.kind === 'UNASSIGNED' ? t('diary.noStylist') : '')}</span>
            <span className="block text-xs text-zinc-500">{t('diary.google')} · {t(`diary.kind.${entry.kind}`)}</span>
          </span>
        </button>
      </li>
    ))}
  </ul>;
}

const DayView = ({ dateStr, dayAppts, busyBlocks, diary, stylists, onRefresh, onEdit, onSelectDiary, onSelectDay }: DayViewProps) => {
  const t = useT('adminSchedule');
  const tp = useT('pricing');
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const hours = stylists.map(stylist => stylist.availabilities.find(row => row.dayOfWeek === weekday && !row.isOff));
  const salonWindow = salonWorkingWindow(hours);
  const agenda = scheduleAgenda(dayAppts, busyBlocks.map(block => {
    const stylistHours = hours[stylists.findIndex(stylist => stylist.id === block.stylistId)];
    return { ...block, allDay: isWholeDayBlock(block, stylistHours ?? salonWindow) };
  }), diary);
  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden flex flex-col">
      <div className="p-3 border-b border-zinc-200 bg-zinc-50 flex flex-wrap justify-between items-center gap-1">
          <h3 className="font-bold text-base text-zinc-900">{onSelectDay ? <button type="button" onClick={onSelectDay} className="text-left underline-offset-4 hover:underline">{formatCalendarDay(t.locale, dateStr, { weekday: 'long', month: 'long', day: 'numeric' })}</button> : formatCalendarDay(t.locale, dateStr, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <span className="text-sm text-zinc-500">{dayCountLabel(t, dayAppts.length, busyBlocks.length, diary)}</span>
      </div>
      <div className="divide-y divide-zinc-100">
          {dayAppts.length === 0 && busyBlocks.length === 0 && diary.length === 0 ? (
              <div className="p-12 text-center text-zinc-500">{t('day.empty')}</div>
          ) : (
              agenda.timed.map(row => {
                if (row.source === 'busy') return <BusyAgenda key={`busy-${row.value.id}`} blocks={[row.value]} stylists={stylists} dayKey={dateStr} />;
                if (row.source === 'google') return <DiaryAgenda key={`google-${row.value.id}`} entries={[row.value]} stylists={stylists} onSelect={onSelectDiary} />;
                const appt = row.value;
                const tone = stylistDisplaySwatch(appt.stylist);
                // The price recorded on the booking, or "Price not recorded" —
                // never today's service price.
                const price = describeBoardPrice(appt.price, tp);
                return (
                  <div key={`website-${appt.id}`} className="relative p-3 pl-4">
                      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.stripe}`} />
                      <div className="mb-1 text-zinc-900 text-sm font-semibold tabular-nums">
                          {formatSalonClock(t.locale, new Date(appt.date))}
                      </div>
                      <div className={`min-w-0 rounded-lg p-3 border border-zinc-200 ${tone.fill}`}>
                          <div className="flex flex-wrap justify-between items-start gap-2">
                              <div>
                                  <h4 className="font-semibold text-zinc-900">{appt.user.name}</h4>
                                  <p className="text-zinc-600 text-sm">{appt.service.name} • {tp('minutes', { count: appt.durationAtBooking ?? appt.service.duration })}</p>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusChipClass(appt.status)}`}>
                                  {statusLabel(t, appt.status)}
                              </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                              <span className="font-semibold text-zinc-800">{t('appointment.stylist', { name: appt.stylist.name })}</span>
                              <span>{t('agenda.website')}</span>
                              <span>
                                <span className="font-medium text-zinc-700 tabular-nums">{price.amount}</span>
                                {price.notes.length > 0 && <span className="ml-1">({price.notes.join(' · ')})</span>}
                              </span>
                              {/* A cancelled booking deducts nothing: its credit is free again. */}
                              {appt.consultationCredit && appt.status !== 'CANCELLED' && (
                                <span className="tabular-nums">{t('credit.row', { amount: formatGBP(appt.consultationCredit.amountPence, HTML_LANG[t.locale]) })}</span>
                              )}
                              {appt.deposit && <DepositChip deposit={appt.deposit} t={t} />}
                          </div>
                          <button type="button" onClick={() => onEdit(appt)} className="mt-2 mr-2 rounded border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-white">{t('appointment.edit')}</button>
                          {appt.status === 'PENDING' && (
                            <div className="mt-2">
                              <PendingActions apptId={appt.id} started={hasAppointmentStarted(appt.date)} deposit={appt.deposit} onDone={onRefresh} />
                            </div>
                          )}
                          {canMarkCompleted(appt) && (
                            <MarkCompletedButton
                              apptId={appt.id}
                              customer={appt.user.name ?? t('appointment.customerFallback')}
                              deposit={appt.deposit}
                              onDone={onRefresh}
                              className="mt-2 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                            />
                          )}
                      </div>
                  </div>
                );
              })
          )}
          {(agenda.notes.length > 0 || agenda.allDayBusy.length > 0) && <section aria-label={t('agenda.notes')}><h4 className="bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-600">{t('agenda.notes')}</h4><BusyAgenda blocks={agenda.allDayBusy} stylists={stylists} dayKey={dateStr} /><DiaryAgenda entries={agenda.notes} stylists={stylists} onSelect={onSelectDiary} /></section>}
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
  diaryEntries = [],
  services = [],
  monthCounts = [],
  pendingNext = null,
  pendingHasPrevious = false,
  loadedAt,
  openId,
}: {
  dateStr: string;
  view: CalendarView;
  appointments: AppointmentWithDetails[];
  pendingAppointments: PendingAppointment[];
  rescheduleRequests: RescheduleRequestRow[];
  stylists: RosterStylist[];
  busyBlocks: BusyBlockRow[];
  /** The salon's Google diary for the day or week on show (admin-calendar-data.ts). */
  diaryEntries?: CalendarDiaryEntry[];
  services?: DialogService[];
  monthCounts?: number[];
  pendingNext?: string | null;
  pendingHasPrevious?: boolean;
  loadedAt?: string;
  /** A booking to open on arrival: Admin → Operations links a payment to it (`?open=`). */
  openId?: string;
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
  // The Google diary entry whose read-only panel is open.
  const [diaryOpen, setDiaryOpen] = useState<CalendarDiaryEntry | null>(null);
  const [stylistFilter, setStylistFilter] = useDraftState<string>('schedule-board:stylist', '');
  const visible = filterScheduleForStylist(appointments, busyBlocks, diaryEntries, stylistFilter);
  const diaryStylists = stylistFilter ? stylists.filter(stylist => stylist.id === stylistFilter) : stylists;
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
  for (const appointment of visible.appointments) {
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
  const busyForDay: GridBusyBlock[] = visible.busy.map((block) => ({
    ...block,
    id: block.id,
    stylistId: block.stylistId,
    start: new Date(block.start).toISOString(),
    end: new Date(block.end).toISOString(),
  }));
  const gridBusyBlocks = busyForDay;
  const gridAppointments: GridAppointment[] = visible.appointments
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
      arrived: Boolean(appt.arrivedAt),
      ...(appt.deposit ? { deposit: appt.deposit } : {}),
    }));
  const weekKeys = weekDayKeys(dateStr);
  const weekAppointments: GridAppointment[] = visible.appointments.map((appt) => ({
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
    arrived: Boolean(appt.arrivedAt),
    ...(appt.deposit ? { deposit: appt.deposit } : {}),
  }));
  const weekStylists: WeekStylist[] = diaryStylists.map((stylist) => ({
    id: stylist.id,
    name: stylist.name,
    calendarColor: stylist.calendarColor,
    googleColorId: stylist.googleColorId,
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
      // Only what staff can use: a walk-in's or an erased customer's placeholder address is no email.
      ...(appt.user.phone?.trim() ? { customerPhone: appt.user.phone.trim() } : {}),
      ...(displayableEmail(appt.user.email) ? { customerEmail: displayableEmail(appt.user.email) } : {}),
      status: appt.status,
      updatedAt: appt.updatedAt,
      price: appt.price,
      date: appt.date,
      rescheduleRequestedDate: appt.rescheduleRequestedDate,
      rescheduleRequestedAt: appt.rescheduleRequestedAt,
      // Only a booking staff marked arrived carries one.
      ...(appt.arrivedAt ? { arrivedAt: appt.arrivedAt } : {}),
      // Only a booking with a card deposit carries one.
      ...(appt.deposit ? { deposit: appt.deposit } : {}),
      ...(appt.depositLocked ? { depositLocked: true } : {}),
      // Only a booking staff applied a consultation credit to carries one.
      ...(appt.consultationCredit ? { consultationCredit: appt.consultationCredit } : {}),
    });
  };
  // Opened once per link, from the rows the page loaded for that day (a
  // cancelled booking included); a booking outside them is left alone.
  const openedFromLink = useRef<string | null>(null);
  const openLinked = useEffectEvent((id: string) => {
    if (openedFromLink.current === id || !appointmentById.has(id)) return;
    openedFromLink.current = id;
    openEditor({ id });
  });
  useEffect(() => { if (openId) openLinked(openId); }, [openId, appointments]);
  const closeDialog = () => setDialog(null);
  const savedDialog = () => { setDialog(null); router.refresh(); };

  const dayDiary = diaryForDay(visible.diary, dayKey);
  const busyStylistIds = new Set([
    ...gridAppointments.map((appt) => appt.stylistId),
    ...gridBusyBlocks.map((block) => block.stylistId),
    // A stylist the Google diary has booked or away that day gets a column even when off in our rota.
    ...dayDiary.placed.filter((entry) => entry.kind === 'STYLIST' || entry.kind === 'LEAVE').flatMap((entry) => entry.stylistIds),
  ]);
  const gridStylists: GridStylist[] = diaryStylists
    .map((stylist) => {
      const availability = stylist.availabilities.find((a) => a.dayOfWeek === salonWeekday && !a.isOff);
      return {
        id: stylist.id,
        name: stylist.name,
        calendarColor: stylist.calendarColor,
        googleColorId: stylist.googleColorId,
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
    <div className="space-y-2 sm:space-y-4">
      {(pendingAppointments.length > 0 || pendingHasPrevious) && (
        <MobileScheduleDisclosure label={t('stats.awaiting')} attention>
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
                  {appt.deposit && <DepositChip deposit={appt.deposit} t={t} className="mt-1" />}
                </div>
                <PendingActions apptId={appt.id} started={hasAppointmentStarted(appt.date)} deposit={appt.deposit} onDone={() => router.refresh()} />
              </div>
            ))}
          </div>
          {(pendingNext || pendingHasPrevious) && <nav aria-label={t('pending.pagination')} className="mt-3 flex gap-4 text-sm underline">
            {pendingHasPrevious && <button type="button" onClick={() => pendingPage()}>{t('pending.firstPage')}</button>}
            {pendingNext && <button type="button" onClick={() => pendingPage(pendingNext)}>{t('pending.nextPage')}</button>}
          </nav>}
        </section>
        </MobileScheduleDisclosure>
      )}
      {rescheduleRequests.length > 0 && (
        <MobileScheduleDisclosure label={t('rescheduleRequests.title')} count={rescheduleRequests.length} attention>
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
        </MobileScheduleDisclosure>
      )}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm sm:gap-3 sm:p-4">
        <div className="min-w-0 flex-1 sm:flex-none">
          <select
            aria-label={t('views.label')}
            value={viewMode}
            onChange={event => setViewMode(event.target.value as CalendarView)}
            className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm font-medium capitalize text-zinc-900 sm:hidden"
          >
            {(['day', 'week', 'month', 'year'] as const).map(period => <option key={period} value={period}>{t(`views.${period}`)}</option>)}
          </select>
          <div className="hidden rounded-md shadow-sm sm:inline-flex" role="group" aria-label={t('views.label')}>
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

        <div className="order-first flex w-full min-w-0 items-center gap-1 lg:order-none lg:w-auto lg:flex-1">
          <button onClick={prev} disabled={isNavigating} aria-label={t('toolbar.previous')} className="min-h-11 min-w-11 rounded-full p-2 hover:bg-zinc-100 disabled:opacity-50">
             ←
          </button>
          <h2 className="min-w-0 flex-1 text-balance text-center text-sm font-bold text-zinc-900 sm:text-base lg:max-w-80">
            {title}
          </h2>
          <button onClick={next} disabled={isNavigating} aria-label={t('toolbar.next')} className="min-h-11 min-w-11 rounded-full p-2 hover:bg-zinc-100 disabled:opacity-50">
             →
          </button>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
          <button onClick={goToToday} className="min-h-11 min-w-11 px-2 text-sm font-medium text-zinc-900 hover:underline">
            {t('toolbar.today')}
          </button>
          {viewMode !== 'year' && services.some((service) => service.isBookable) && stylists.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog({ mode: 'create', dateStr, time: formatSalonTime(new Date()) })}
              aria-label={t('toolbar.newBooking')}
              title={t('toolbar.newBooking')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 sm:hidden"><path d="M12 5v14M5 12h14" /></svg>
              <span className="hidden sm:inline">{t('toolbar.newBooking')}</span>
            </button>
          )}
          <button
            type="button"
            aria-label={t('refresh.button')}
            title={t('refresh.button')}
            onClick={() => startNavigation(() => router.refresh())}
            disabled={isNavigating}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-5 w-5 ${isNavigating ? 'animate-spin motion-reduce:animate-none' : ''}`}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 19.6 10M4.4 14a8 8 0 0 0 13.5 3.9" /></svg>
          </button>
        </div>
      </div>
      {viewMode !== 'year' && <div className="flex items-center gap-2 text-sm sm:flex-wrap sm:gap-x-3 sm:gap-y-1">
        <label htmlFor="schedule-stylist" className="shrink-0 font-medium text-zinc-700">{t('toolbar.stylist')}</label>
        <select id="schedule-stylist" value={stylistFilter} onChange={event => setStylistFilter(event.target.value)} className="min-h-11 min-w-0 max-w-full flex-1 rounded-md border border-zinc-300 bg-white px-2 py-2 text-zinc-900 sm:flex-none sm:px-3">
          <option value="">{t('toolbar.allStylists')}</option>
          {stylists.map(stylist => <option key={stylist.id} value={stylist.id}>{stylist.name}</option>)}
        </select>
        <span className="hidden text-xs text-zinc-500 sm:inline">{t('toolbar.filterHelp')}</span>
      </div>}
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
                diaryEntries={visible.diary}
                onSelectDiary={setDiaryOpen}
                onMove={moveAppointmentByAdmin}
                onMoved={() => router.refresh()}
                onSelect={openEditor}
                onCreate={(day, time) => setDialog({ mode: 'create', dateStr: day, time })}
              />
              <ScheduleCancelledList
                appointments={weekKeys.flatMap((key) => getDayAppointments(new Date(`${key}T12:00:00`)))}
                showDay
                onEdit={openEditor}
              />
            </div>
            <div className="md:hidden space-y-3">
              {weekKeys.map((key) => {
                const diary = diaryForDay(visible.diary, key);
                return <DayView key={key} dateStr={key}
                  dayAppts={getDayAppointments(new Date(`${key}T12:00:00`))}
                  busyBlocks={calendarBusyForDay(gridBusyBlocks, key)}
                  diary={[...diary.placed, ...diary.notes]} stylists={stylists}
                  onRefresh={() => router.refresh()} onEdit={openEditor} onSelectDiary={setDiaryOpen}
                  onSelectDay={() => navigate(new Date(`${key}T12:00:00`), 'day')} />;
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
                diaryEntries={visible.diary}
                onSelectDiary={setDiaryOpen}
                onMove={moveAppointmentByAdmin}
                onMoved={() => router.refresh()}
                onSelect={openEditor}
                onCreate={(day, time, stylistId) => setDialog({ mode: 'create', dateStr: day, time, stylistId })}
              />
              <ScheduleCancelledList appointments={getDayAppointments(currentDate)} showDay={false} onEdit={openEditor} />
            </div>
            <div className="sm:hidden">
              <DayView
                dateStr={dateStr}
                dayAppts={getDayAppointments(currentDate)}
                busyBlocks={calendarBusyForDay(gridBusyBlocks, dateStr)}
                diary={[...dayDiary.placed, ...dayDiary.notes]}
                stylists={stylists}
                onRefresh={() => router.refresh()}
                onEdit={openEditor}
                onSelectDiary={setDiaryOpen}
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
                                     <button type="button" onClick={() => openEditor(appt)} className="rounded border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-50">{t('appointment.edit')}</button>
                                     <div className={`text-xs px-2 py-1 rounded font-medium ${statusChipClass(appt.status)}`}>
                                         {statusLabel(t, appt.status)}
                                     </div>
                                     {appt.deposit && <DepositChip deposit={appt.deposit} t={t} />}
                                     {appt.status === 'PENDING' && (
                                       <PendingActions apptId={appt.id} started={hasAppointmentStarted(appt.date)} deposit={appt.deposit} onDone={() => router.refresh()} />
                                     )}
                                     {canMarkCompleted(appt) && (
                                       <MarkCompletedButton
                                         apptId={appt.id}
                                         customer={appt.user.name ?? t('appointment.customerFallback')}
                                         deposit={appt.deposit}
                                         onDone={() => router.refresh()}
                                         className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                                       />
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

      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
        {loadedAt && <p>{t('refresh.loadedAt', { date: formatSalonLongDate(locale, new Date(loadedAt)), time: formatSalonClock(locale, new Date(loadedAt)) })}</p>}
        <details className="mt-1"><summary className="cursor-pointer font-medium text-zinc-700">{t('refresh.details')}</summary><p className="mt-2 leading-relaxed">{view === 'year' ? t('refresh.yearNote') : t('refresh.autoNote')}
        {' '}{t('refresh.savedNote')}</p></details>
      </div>

      {dialog && (
        <AppointmentDialog
          key={dialog.mode === 'edit' ? dialog.appointmentId : 'new'}
          target={withLiveDeposit(dialog, appointmentById)}
          services={services}
          stylists={stylists.map(({ id, name }) => ({ id, name }))}
          onClose={closeDialog}
          onSaved={savedDialog}
          onRefresh={() => router.refresh()}
        />
      )}
      {diaryOpen && (
        <GoogleDiaryPanel
          entry={diaryOpen}
          stylistNames={Object.fromEntries(stylists.map((s) => [s.id, s.name]))}
          onClose={() => setDiaryOpen(null)}
        />
      )}
    </div>
  );
}
