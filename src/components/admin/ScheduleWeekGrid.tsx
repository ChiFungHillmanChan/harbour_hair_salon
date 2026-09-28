'use client';

import { useMemo, useRef, useState } from 'react';
import { resolveCalendarColor } from '@/app/lib/calendar-colors';
import {
  MIN_DURATION_MINUTES,
  applyMove,
  applyResizeBottom,
  applyResizeTop,
  minutesToOffset,
  type Bounds,
} from '@/app/lib/calendar-geometry';
import { salonDateKey, salonMinutesOfDay } from '@/app/services/salon-time';
import { describeClash } from '@/app/lib/describe-clash';
import type { MoveClash } from '@/app/services/admin-move-clashes';
import type { GridAppointment, GridBusyBlock, GridStylist, MoveResult } from './ScheduleDayGrid';
import { calendarBusyForDay, calendarBusyLabel } from '@/app/lib/calendar-busy-display';
import { useT } from '@/i18n/client';
import { formatCalendarDay } from '@/i18n/dates';

/**
 * The week board.
 *
 * Same time-grid mechanics as ScheduleDayGrid, rotated one axis: a column is a
 * DAY rather than a stylist, and dragging sideways changes the DATE rather than
 * the stylist. Everything a stylist is doing that day stacks inside their day's
 * column, so the salon can see the shape of the week — which days are full,
 * where the gaps are — without stepping through seven day views.
 *
 * The geometry, snapping and clamping come from lib/calendar-geometry, shared
 * with the day grid, so a 15-minute drag means the same thing on both.
 */

/** Shorter than the day grid: seven columns have to fit the same screen. */
const PX_PER_MINUTE = 0.9;

/**
 * A week column can hold every stylist working at once, so a lane is narrow —
 * roughly 35px on a laptop. Anything longer than a first name is unreadable
 * there, so the block shows the time and who is in the chair, and the full
 * detail lives in the hover title and the day view.
 */
function firstName(name: string | null, fallback: string): string {
  return (name ?? fallback).trim().split(/\s+/)[0];
}

export type WeekStylist = GridStylist & {
  /** Working hours per weekday index, so each column can shade its own day. */
  availabilityByWeekday: Record<number, { startTime: string; endTime: string } | undefined>;
};

type DragMode = 'move' | 'top' | 'bottom';

type DragState = {
  appointmentId: string;
  mode: DragMode;
  originX: number;
  originY: number;
  originDayKey: string;
  startMin: number;
  durationMin: number;
  currentStartMin: number;
  currentDurationMin: number;
  currentDayKey: string;
  moved: boolean;
};

type PendingConfirm = { clashes: MoveClash[]; retry: () => Promise<void> };

const minutesOf = (iso: string) => salonMinutesOfDay(new Date(iso));

function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** A pointer that never really travelled is a click, not a drag. */
const CLICK_SLOP_PX = 4;

interface ScheduleWeekGridProps {
  /** Seven salon calendar days, Sunday first. */
  dayKeys: string[];
  todayKey: string;
  stylists: WeekStylist[];
  appointments: GridAppointment[];
  busyBlocks: GridBusyBlock[];
  onMove: (input: {
    appointmentId: string;
    dateStr: string;
    time: string;
    durationMin: number;
    stylistId: string;
    overrideClashes: boolean;
    expectedUpdatedAt: string;
  }) => Promise<MoveResult>;
  onMoved: () => void;
  onSelect: (appointment: GridAppointment) => void;
  onCreate: (dateStr: string, time: string) => void;
}

export function ScheduleWeekGrid({
  dayKeys,
  todayKey,
  stylists,
  appointments,
  busyBlocks,
  onMove,
  onMoved,
  onSelect,
  onCreate,
}: ScheduleWeekGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
  const t = useT('adminSchedule');
  const customerFallback = t('appointment.customerFallback');
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const stylistById = useMemo(
    () => new Map(stylists.map((stylist) => [stylist.id, stylist])),
    [stylists],
  );

  const weekAppointments = useMemo(
    () => appointments.filter((appt) => appt.status !== 'CANCELLED'),
    [appointments],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, GridAppointment[]>();
    for (const key of dayKeys) map.set(key, []);
    for (const appt of weekAppointments) {
      map.get(salonDateKey(new Date(appt.date)))?.push(appt);
    }
    return map;
  }, [weekAppointments, dayKeys]);

  const busyByDay = useMemo(() => {
    return new Map(dayKeys.map((key) => [key, calendarBusyForDay(busyBlocks, key)]));
  }, [busyBlocks, dayKeys]);

  // One shared vertical extent for all seven columns — staggered day grids read
  // as seven unrelated charts. Widen past opening hours for anything already in
  // the diary outside them, exactly as the day grid does.
  const bounds: Bounds = useMemo(() => {
    let start = 24 * 60;
    let end = 0;
    for (const stylist of stylists) {
      for (const availability of Object.values(stylist.availabilityByWeekday)) {
        if (!availability) continue;
        const [sh, sm] = availability.startTime.split(':').map(Number);
        const [eh, em] = availability.endTime.split(':').map(Number);
        start = Math.min(start, sh * 60 + sm);
        end = Math.max(end, eh * 60 + em);
      }
    }
    if (start > end) { start = 9 * 60; end = 18 * 60; }
    for (const appt of weekAppointments) {
      const s = minutesOf(appt.date);
      start = Math.min(start, s);
      end = Math.max(end, s + appt.durationMin);
    }
    for (const block of [...busyByDay.values()].flat()) {
      start = Math.min(start, block.startMin);
      end = Math.max(end, block.endMin);
    }
    return { startMin: Math.floor(start / 60) * 60, endMin: Math.ceil(end / 60) * 60 };
  }, [stylists, weekAppointments, busyByDay]);

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let m = bounds.startMin; m <= bounds.endMin; m += 60) list.push(m);
    return list;
  }, [bounds]);

  const gridHeight = (bounds.endMin - bounds.startMin) * PX_PER_MINUTE;

  const position = (appt: GridAppointment) =>
    drag && drag.appointmentId === appt.id
      ? { startMin: drag.currentStartMin, durationMin: drag.currentDurationMin, dayKey: drag.currentDayKey }
      : { startMin: minutesOf(appt.date), durationMin: appt.durationMin, dayKey: salonDateKey(new Date(appt.date)) };

  const dayKeyAtX = (clientX: number): string | null => {
    for (const [key, element] of columnRefs.current) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return key;
    }
    return null;
  };

  /**
   * Side-by-side lanes for bookings that share a day and a time. Two stylists
   * working at 10:00 are not a clash, so they must not be drawn on top of each
   * other — the week column shows both, narrowed.
   */
  const lanesFor = (dayAppointments: GridAppointment[], dayBusy: ReturnType<typeof calendarBusyForDay>) => {
    const sorted = [
      ...dayAppointments.map((appt) => ({ id: appt.id, ...position(appt) })),
      ...dayBusy.map((block) => ({ id: `busy-${block.id}`, startMin: block.startMin, durationMin: block.endMin - block.startMin })),
    ].sort((a, b) => a.startMin - b.startMin);
    const laneEnds: number[] = [];
    const lane = new Map<string, number>();
    for (const place of sorted) {
      const index = laneEnds.findIndex((end) => end <= place.startMin);
      const slot = index === -1 ? laneEnds.length : index;
      laneEnds[slot] = place.startMin + place.durationMin;
      lane.set(place.id, slot);
    }
    return { lane, laneCount: Math.max(1, laneEnds.length) };
  };

  const beginDrag = (appt: GridAppointment, mode: DragMode) => (event: React.PointerEvent) => {
    if (saving || appt.status === 'CANCELLED') return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const startMin = minutesOf(appt.date);
    const dayKey = salonDateKey(new Date(appt.date));
    setError(null);
    setDrag({
      appointmentId: appt.id,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      originDayKey: dayKey,
      startMin,
      durationMin: appt.durationMin,
      currentStartMin: startMin,
      currentDurationMin: appt.durationMin,
      currentDayKey: dayKey,
      moved: false,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const travelled =
      Math.abs(event.clientX - drag.originX) > CLICK_SLOP_PX ||
      Math.abs(event.clientY - drag.originY) > CLICK_SLOP_PX;
    const deltaMinutes = (event.clientY - drag.originY) / PX_PER_MINUTE;
    const base = { startMin: drag.startMin, durationMin: drag.durationMin };
    const next =
      drag.mode === 'move'
        ? applyMove(base, deltaMinutes, bounds)
        : drag.mode === 'top'
          ? applyResizeTop(base, deltaMinutes, bounds)
          : applyResizeBottom(base, deltaMinutes, bounds);
    // Only a whole-block move may change day; a resize stays on its own date.
    const column = drag.mode === 'move' ? dayKeyAtX(event.clientX) : null;
    setDrag({
      ...drag,
      moved: drag.moved || travelled,
      currentStartMin: next.startMin,
      currentDurationMin: next.durationMin,
      currentDayKey: column ?? drag.currentDayKey,
    });
  };

  const commit = async (state: DragState) => {
    const appt = weekAppointments.find((a) => a.id === state.appointmentId);
    if (!appt) return;

    const unchanged =
      state.currentStartMin === state.startMin &&
      state.currentDurationMin === state.durationMin &&
      state.currentDayKey === state.originDayKey;
    // A press that changed nothing is how you open a booking, not a failed drag.
    if (unchanged) {
      if (!state.moved) onSelect(appt);
      return;
    }

    const payload = {
      appointmentId: appt.id,
      dateStr: state.currentDayKey,
      time: timeLabel(state.currentStartMin),
      durationMin: state.currentDurationMin,
      // The week board never reassigns work; it moves it through time.
      stylistId: appt.stylistId,
      expectedUpdatedAt: appt.updatedAt,
    };

    const send = async (overrideClashes: boolean) => {
      setSaving(true);
      try {
        const result = await onMove({ ...payload, overrideClashes });
        if (result.success) {
          setConfirmState(null);
          onMoved();
          return;
        }
        if ('clashes' in result) {
          setConfirmState({ clashes: result.clashes, retry: () => send(true) });
          return;
        }
        setError(result.error);
      } finally {
        setSaving(false);
      }
    };

    await send(false);
  };

  const endDrag = async () => {
    if (!drag) return;
    const state = drag;
    setDrag(null);
    await commit(state);
  };

  /** Click an empty part of a column to start a booking at that day and time. */
  const createAt = (dayKey: string) => (event: React.MouseEvent<HTMLDivElement>) => {
    if (drag || saving) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = bounds.startMin + (event.clientY - rect.top) / PX_PER_MINUTE;
    const snapped = Math.max(
      bounds.startMin,
      Math.min(bounds.endMin - MIN_DURATION_MINUTES, Math.floor(minutes / MIN_DURATION_MINUTES) * MIN_DURATION_MINUTES),
    );
    onCreate(dayKey, timeLabel(snapped));
  };

  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
      {error && <div role="alert" className="px-4 py-2 bg-red-50 text-sm text-red-700 border-b border-red-200">{error}</div>}

      {confirmState && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
          <p className="text-sm font-semibold text-amber-900">{t('clash.moveTitle')}</p>
          <ul className="mt-1 mb-2 list-disc list-inside text-sm text-amber-800">
            {confirmState.clashes.map((clash, index) => <li key={index}>{describeClash(clash, t)}</li>)}
          </ul>
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={() => confirmState.retry()} className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {t('clash.moveAnyway')}
            </button>
            <button type="button" onClick={() => setConfirmState(null)} className="rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
              {t('clash.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Column headings */}
      <div className="flex border-b border-zinc-200 bg-zinc-50">
        <div className="w-12 flex-shrink-0" />
        {dayKeys.map((key) => {
          const isToday = key === todayKey;
          return (
            <div key={key} className={`flex-1 min-w-0 px-1 py-2 text-center border-l border-zinc-200 ${isToday ? 'bg-zinc-900' : ''}`}>
              <div className={`text-[10px] font-medium uppercase tracking-wide ${isToday ? 'text-zinc-300' : 'text-zinc-500'}`}>
                {formatCalendarDay(t.locale, key, { weekday: 'short' })}
              </div>
              <div className={`text-sm font-bold ${isToday ? 'text-white' : 'text-zinc-800'}`}>
                {Number(key.slice(8, 10))}
              </div>
              <div className={`text-[10px] ${isToday ? 'text-zinc-300' : 'text-zinc-500'}`}>
                {t('grid.booked', { count: byDay.get(key)?.length ?? 0 })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div
        className="flex relative select-none"
        style={{ height: gridHeight }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Time gutter */}
        <div className="w-12 flex-shrink-0 relative">
          {hours.map((minute) => (
            <div
              key={minute}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-zinc-400"
              style={{ top: minutesToOffset(minute, bounds.startMin, PX_PER_MINUTE) }}
            >
              {timeLabel(minute)}
            </div>
          ))}
        </div>

        {dayKeys.map((key) => {
          const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
          const dayAppointments = byDay.get(key) ?? [];
          const dayBusy = busyByDay.get(key) ?? [];
          const { lane, laneCount } = lanesFor(dayAppointments, dayBusy);
          // The salon is closed for the slice of the grid no stylist covers.
          const open = stylists.reduce<{ from: number; to: number } | null>((span, stylist) => {
            const availability = stylist.availabilityByWeekday[weekday];
            if (!availability) return span;
            const [sh, sm] = availability.startTime.split(':').map(Number);
            const [eh, em] = availability.endTime.split(':').map(Number);
            const from = sh * 60 + sm;
            const to = eh * 60 + em;
            return span ? { from: Math.min(span.from, from), to: Math.max(span.to, to) } : { from, to };
          }, null);

          return (
            <div
              key={key}
              ref={(element) => {
                if (element) columnRefs.current.set(key, element);
                else columnRefs.current.delete(key);
              }}
              onClick={createAt(key)}
              className={`flex-1 min-w-0 relative border-l border-zinc-200 cursor-copy
                ${drag?.currentDayKey === key ? 'bg-zinc-50' : ''}`}
            >
              {hours.map((minute) => (
                <div
                  key={minute}
                  className="absolute left-0 right-0 border-t border-zinc-100"
                  style={{ top: minutesToOffset(minute, bounds.startMin, PX_PER_MINUTE) }}
                />
              ))}

              {/* Closed hours */}
              {!open && <div className="absolute inset-0 bg-zinc-100/70" />}
              {open && open.from > bounds.startMin && (
                <div className="absolute left-0 right-0 bg-zinc-100/70" style={{ top: 0, height: (open.from - bounds.startMin) * PX_PER_MINUTE }} />
              )}
              {open && open.to < bounds.endMin && (
                <div
                  className="absolute left-0 right-0 bg-zinc-100/70"
                  style={{ top: minutesToOffset(open.to, bounds.startMin, PX_PER_MINUTE), height: (bounds.endMin - open.to) * PX_PER_MINUTE }}
                />
              )}

              {/* Synced busy time — visible, never draggable */}
              {dayBusy.map((block) => {
                const { startMin, endMin } = block;
                const label = calendarBusyLabel(block, stylistById.get(block.stylistId)?.name ?? t('appointment.stylistFallback'), startMin, endMin, t);
                return (
                  <div
                    key={block.id}
                    role="note"
                    tabIndex={0}
                    aria-label={label.detail}
                    title={label.detail}
                    onClick={(event) => event.stopPropagation()}
                    className="absolute overflow-hidden rounded border border-zinc-300 border-l-2 border-l-zinc-500 bg-zinc-100 px-0.5 text-[9px] leading-3 text-zinc-700 focus-visible:outline-2 focus-visible:outline-[#174F7F]"
                    style={{
                      top: minutesToOffset(startMin, bounds.startMin, PX_PER_MINUTE),
                      height: Math.max(14, (endMin - startMin) * PX_PER_MINUTE),
                      left: `${(lane.get(`busy-${block.id}`) ?? 0) * 100 / laneCount}%`,
                      width: `${100 / laneCount}%`,
                    }}
                  >
                    <span className="mr-1 font-semibold">{label.provider}</span>
                    <span className="whitespace-nowrap tabular-nums">{label.range}</span>
                  </div>
                );
              })}

              {/* Appointments */}
              {dayAppointments.map((appt) => {
                const place = position(appt);
                if (place.dayKey !== key) return null;
                const stylist = stylistById.get(appt.stylistId);
                const stylistColour = resolveCalendarColor(stylist?.calendarColor ?? null);
                const serviceColour = resolveCalendarColor(appt.serviceColor);
                const isDragging = drag?.appointmentId === appt.id;
                const slot = lane.get(appt.id) ?? 0;
                const width = 100 / laneCount;
                const height = Math.max(MIN_DURATION_MINUTES * PX_PER_MINUTE, place.durationMin * PX_PER_MINUTE);
                return (
                  <div
                    key={appt.id}
                    onPointerDown={beginDrag(appt, 'move')}
                    onClick={(event) => event.stopPropagation()}
                    title={t('grid.blockTitle', { time: timeLabel(place.startMin), customer: appt.customerName ?? customerFallback, service: appt.serviceName, stylist: stylist?.name ?? '' })}
                    style={{
                      top: minutesToOffset(place.startMin, bounds.startMin, PX_PER_MINUTE),
                      height,
                      left: `${slot * width}%`,
                      width: `${width}%`,
                      touchAction: 'none',
                    }}
                    className={`absolute rounded-sm overflow-hidden cursor-grab active:cursor-grabbing border border-white/40
                      ${stylistColour.fill} ${stylistColour.text}
                      ${appt.status === 'PENDING' ? 'border-2 border-dashed border-white/70' : ''}
                      ${isDragging ? 'opacity-80 ring-2 ring-zinc-900 z-20' : 'z-10'}`}
                  >
                    <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${serviceColour.stripe}`} />
                    <div
                      onPointerDown={beginDrag(appt, 'top')}
                      className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                      style={{ touchAction: 'none' }}
                    />
                    <div className="pl-1 pr-0.5 py-0.5 text-[10px] leading-[1.15] pointer-events-none">
                      <div className="font-semibold tabular-nums">{timeLabel(place.startMin)}</div>
                      <div className="truncate">{firstName(appt.customerName, customerFallback)}</div>
                    </div>
                    <div
                      onPointerDown={beginDrag(appt, 'bottom')}
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      style={{ touchAction: 'none' }}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 text-[11px] text-zinc-500 border-t border-zinc-200 bg-zinc-50">
        {t('grid.weekHint', { minutes: MIN_DURATION_MINUTES })}
        {saving && <span role="status" className="ml-2 font-medium text-zinc-700">{t('grid.saving')}</span>}
      </div>
    </div>
  );
}
