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
import { overlaps } from '@/app/services/scheduling';
import type { MoveClash } from '@/app/services/admin-move-clashes';
import { describeClash } from '@/app/lib/describe-clash';
import { calendarBusyForDay, calendarBusyLabel, isWholeDayBlock, salonWorkingWindow, type CalendarBusyBlock } from '@/app/lib/calendar-busy-display';
import { useT } from '@/i18n/client';

/** 15 minutes = 18px. Tall enough to grab an edge, short enough to fit a day. */
const PX_PER_MINUTE = 1.2;

export type GridStylist = {
  id: string;
  name: string;
  calendarColor: string | null;
  /** Working hours for the day being shown; null when off. */
  availability: { startTime: string; endTime: string } | null;
};

export type GridAppointment = {
  id: string;
  stylistId: string;
  /** ISO instant. */
  date: string;
  durationMin: number;
  status: string;
  customerName: string | null;
  serviceName: string;
  serviceColor: string | null;
  /** ISO instant, for the optimistic-concurrency guard. */
  updatedAt: string;
  /** A customer has asked to move this booking (an open reschedule request). */
  moveRequested?: boolean;
};

export type GridBusyBlock = CalendarBusyBlock;

export type MoveResult =
  | { success: true }
  | { success: false; error: string }
  | { success: false; clashes: MoveClash[] };

interface ScheduleDayGridProps {
  day: Date;
  stylists: GridStylist[];
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
  onCreate: (dateStr: string, time: string, stylistId: string) => void;
}

type DragMode = 'move' | 'top' | 'bottom';

type DragState = {
  appointmentId: string;
  mode: DragMode;
  originX: number;
  originY: number;
  originStylistId: string;
  startMin: number;
  durationMin: number;
  currentStartMin: number;
  currentDurationMin: number;
  currentStylistId: string;
  moved: boolean;
};

type PendingConfirm = {
  clashes: MoveClash[];
  retry: () => Promise<void>;
};

const minutesOf = (iso: string) => salonMinutesOfDay(new Date(iso));

/** A pointer that never really travelled is a click, not a drag. */
const CLICK_SLOP_PX = 4;

function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function ScheduleDayGrid({
  day,
  stylists,
  appointments,
  busyBlocks,
  onMove,
  onMoved,
  onSelect,
  onCreate,
}: ScheduleDayGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
  const t = useT('adminSchedule');
  const gridRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const dayKey = salonDateKey(day);
  const dayAppointments = useMemo(
    () => appointments.filter((a) => salonDateKey(new Date(a.date)) === dayKey),
    [appointments, dayKey],
  );
  const dayBusy = useMemo(
    () => calendarBusyForDay(busyBlocks, dayKey),
    [busyBlocks, dayKey],
  );
  // A stylist who is off in our rota can still have a Fresha "Pause" that day;
  // it is judged against the salon's working day instead.
  const salonWindow = useMemo(() => salonWorkingWindow(stylists.map((stylist) => stylist.availability)), [stylists]);

  // The grid spans the widest working day on show, then widens further to cover
  // anything already booked outside those hours — an admin may deliberately
  // confirm an over-running job, and it must never become invisible.
  const bounds: Bounds = useMemo(() => {
    let start = 24 * 60;
    let end = 0;
    for (const stylist of stylists) {
      if (!stylist.availability) continue;
      const [sh, sm] = stylist.availability.startTime.split(':').map(Number);
      const [eh, em] = stylist.availability.endTime.split(':').map(Number);
      start = Math.min(start, sh * 60 + sm);
      end = Math.max(end, eh * 60 + em);
    }
    if (start > end) { start = 9 * 60; end = 18 * 60; }
    for (const appt of dayAppointments) {
      const s = minutesOf(appt.date);
      start = Math.min(start, s);
      end = Math.max(end, s + appt.durationMin);
    }
    for (const block of dayBusy) {
      start = Math.min(start, block.startMin);
      end = Math.max(end, block.endMin);
    }
    // Round out to whole hours so the time gutter reads cleanly.
    return { startMin: Math.floor(start / 60) * 60, endMin: Math.ceil(end / 60) * 60 };
  }, [stylists, dayAppointments, dayBusy]);

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let m = bounds.startMin; m <= bounds.endMin; m += 60) list.push(m);
    return list;
  }, [bounds]);

  const gridHeight = (bounds.endMin - bounds.startMin) * PX_PER_MINUTE;

  /** Where a block sits right now, accounting for an in-flight drag. */
  const blockPosition = (appt: GridAppointment) => {
    if (drag && drag.appointmentId === appt.id) {
      return { startMin: drag.currentStartMin, durationMin: drag.currentDurationMin, stylistId: drag.currentStylistId };
    }
    return { startMin: minutesOf(appt.date), durationMin: appt.durationMin, stylistId: appt.stylistId };
  };

  /** Blocks the dragged appointment would land on top of, for live highlighting. */
  const clashingIds = useMemo(() => {
    if (!drag) return new Set<string>();
    const ghostStart = new Date(day);
    const ids = new Set<string>();
    const ghostStartMs = new Date(ghostStart).setHours(0, 0, 0, 0) + drag.currentStartMin * 60_000;
    for (const appt of dayAppointments) {
      if (appt.id === drag.appointmentId) continue;
      if (appt.stylistId !== drag.currentStylistId) continue;
      if (appt.status === 'CANCELLED') continue;
      const otherMs = new Date(ghostStart).setHours(0, 0, 0, 0) + minutesOf(appt.date) * 60_000;
      if (overlaps(new Date(ghostStartMs), drag.currentDurationMin, new Date(otherMs), appt.durationMin)) {
        ids.add(appt.id);
      }
    }
    return ids;
  }, [drag, dayAppointments, day]);

  const stylistIdAtX = (clientX: number): string | null => {
    for (const [id, element] of columnRefs.current) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return id;
    }
    return null;
  };

  const beginDrag = (appt: GridAppointment, mode: DragMode) => (event: React.PointerEvent) => {
    if (saving || appt.status === 'CANCELLED') return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const startMin = minutesOf(appt.date);
    setError(null);
    setDrag({
      appointmentId: appt.id,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      originStylistId: appt.stylistId,
      startMin,
      durationMin: appt.durationMin,
      currentStartMin: startMin,
      currentDurationMin: appt.durationMin,
      currentStylistId: appt.stylistId,
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

    // Only a whole-block move may change column; a resize stays with its stylist.
    const column = drag.mode === 'move' ? stylistIdAtX(event.clientX) : null;
    setDrag({
      ...drag,
      moved: drag.moved || travelled,
      currentStartMin: next.startMin,
      currentDurationMin: next.durationMin,
      currentStylistId: column ?? drag.currentStylistId,
    });
  };

  const commit = async (state: DragState) => {
    const appt = dayAppointments.find((a) => a.id === state.appointmentId);
    if (!appt) return;

    const unchanged =
      state.currentStartMin === state.startMin &&
      state.currentDurationMin === state.durationMin &&
      state.currentStylistId === state.originStylistId;
    // A press that changed nothing is how you open a booking, not a failed drag.
    if (unchanged) {
      if (!state.moved) onSelect(appt);
      return;
    }

    const payload = {
      appointmentId: appt.id,
      dateStr: dayKey,
      time: timeLabel(state.currentStartMin),
      durationMin: state.currentDurationMin,
      stylistId: state.currentStylistId,
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

  /** Click a gap in a stylist's column to start a booking with them, then. */
  const createAt = (stylistId: string) => (event: React.MouseEvent<HTMLDivElement>) => {
    if (drag || saving) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = bounds.startMin + (event.clientY - rect.top) / PX_PER_MINUTE;
    const snapped = Math.max(
      bounds.startMin,
      Math.min(bounds.endMin - MIN_DURATION_MINUTES, Math.floor(minutes / MIN_DURATION_MINUTES) * MIN_DURATION_MINUTES),
    );
    onCreate(dayKey, timeLabel(snapped), stylistId);
  };

  if (stylists.length === 0) {
    return <div className="p-12 text-center text-zinc-500 bg-white rounded-lg border border-zinc-200">{t('grid.noStylists')}</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow border border-zinc-200 overflow-hidden">
      {error && (
        <div role="alert" className="px-4 py-2 bg-red-50 text-sm text-red-700 border-b border-red-200">{error}</div>
      )}

      {confirmState && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
          <p className="text-sm font-semibold text-amber-900">{t('clash.moveTitle')}</p>
          <ul className="mt-1 mb-2 list-disc list-inside text-sm text-amber-800">
            {confirmState.clashes.map((clash, index) => (
              <li key={index}>{describeClash(clash, t)}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => confirmState.retry()}
              className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {t('clash.moveAnyway')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmState(null)}
              className="rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              {t('clash.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Column headings */}
      <div className="flex border-b border-zinc-200 bg-zinc-50">
        <div className="w-14 flex-shrink-0" />
        {stylists.map((stylist) => {
          const colour = resolveCalendarColor(stylist.calendarColor);
          return (
            <div key={stylist.id} className="flex-1 min-w-0 px-2 py-2 text-center border-l border-zinc-200">
              <div className="flex items-center justify-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${colour.fill}`} />
                <span className="text-xs font-bold text-zinc-800 truncate">{stylist.name}</span>
              </div>
              <div className="text-[10px] text-zinc-500">
                {stylist.availability ? `${stylist.availability.startTime}–${stylist.availability.endTime}` : t('grid.off')}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div
        ref={gridRef}
        className="flex relative select-none"
        style={{ height: gridHeight }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Time gutter */}
        <div className="w-14 flex-shrink-0 relative">
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

        {stylists.map((stylist) => {
          const stylistColour = resolveCalendarColor(stylist.calendarColor);
          return (
            <div
              key={stylist.id}
              ref={(element) => {
                if (element) columnRefs.current.set(stylist.id, element);
                else columnRefs.current.delete(stylist.id);
              }}
              onClick={createAt(stylist.id)}
              className={`flex-1 min-w-0 relative border-l border-zinc-200 cursor-copy
                ${drag?.currentStylistId === stylist.id ? 'bg-zinc-50' : ''}`}
            >
              {/* Hour lines */}
              {hours.map((minute) => (
                <div
                  key={minute}
                  className="absolute left-0 right-0 border-t border-zinc-100"
                  style={{ top: minutesToOffset(minute, bounds.startMin, PX_PER_MINUTE) }}
                />
              ))}

              {/* Outside working hours */}
              {stylist.availability && (() => {
                const [sh, sm] = stylist.availability.startTime.split(':').map(Number);
                const [eh, em] = stylist.availability.endTime.split(':').map(Number);
                const openMin = sh * 60 + sm;
                const closeMin = eh * 60 + em;
                return (
                  <>
                    {openMin > bounds.startMin && (
                      <div
                        className="absolute left-0 right-0 bg-zinc-100/70"
                        style={{ top: 0, height: (openMin - bounds.startMin) * PX_PER_MINUTE }}
                      />
                    )}
                    {closeMin < bounds.endMin && (
                      <div
                        className="absolute left-0 right-0 bg-zinc-100/70"
                        style={{
                          top: minutesToOffset(closeMin, bounds.startMin, PX_PER_MINUTE),
                          height: (bounds.endMin - closeMin) * PX_PER_MINUTE,
                        }}
                      />
                    )}
                  </>
                );
              })()}

              {/* Synced busy time — visible, never draggable */}
              {dayBusy
                .filter((block) => block.stylistId === stylist.id)
                .map((block) => {
                  const { startMin, endMin } = block;
                  const wholeDay = isWholeDayBlock(block, stylist.availability ?? salonWindow);
                  const label = calendarBusyLabel(block, stylist.name, startMin, endMin, t, wholeDay);
                  return (
                    <div
                      key={block.id}
                      role="note"
                      tabIndex={0}
                      aria-label={label.detail}
                      title={label.detail}
                      onClick={(event) => event.stopPropagation()}
                      className={`absolute left-1 right-1 overflow-hidden rounded border px-1 leading-4 focus-visible:outline-2 focus-visible:outline-[#174F7F] ${
                        wholeDay
                          ? 'border-zinc-400 border-l-4 border-l-zinc-600 bg-[repeating-linear-gradient(135deg,var(--color-zinc-200)_0_6px,var(--color-zinc-100)_6px_12px)] py-1 text-xs text-zinc-800'
                          : 'border-zinc-300 border-l-4 border-l-zinc-500 bg-zinc-100 text-[10px] text-zinc-700'
                      }`}
                      style={{
                        top: minutesToOffset(startMin, bounds.startMin, PX_PER_MINUTE),
                        height: Math.max(18, (endMin - startMin) * PX_PER_MINUTE),
                      }}
                    >
                      <span className="mr-1 font-semibold">{label.provider}</span>
                      <span className="whitespace-nowrap tabular-nums">{label.range}</span>
                    </div>
                  );
                })}

              {/* Appointments */}
              {dayAppointments
                .filter((appt) => appt.status !== 'CANCELLED')
                .filter((appt) => blockPosition(appt).stylistId === stylist.id)
                .map((appt) => {
                  const position = blockPosition(appt);
                  const serviceColour = resolveCalendarColor(appt.serviceColor);
                  const isDragging = drag?.appointmentId === appt.id;
                  const isClashing = clashingIds.has(appt.id);
                  const height = Math.max(MIN_DURATION_MINUTES * PX_PER_MINUTE, position.durationMin * PX_PER_MINUTE);
                  return (
                    <div
                      key={appt.id}
                      onPointerDown={beginDrag(appt, 'move')}
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        top: minutesToOffset(position.startMin, bounds.startMin, PX_PER_MINUTE),
                        height,
                        touchAction: 'none',
                      }}
                      className={`absolute left-1 right-1 rounded overflow-hidden cursor-grab active:cursor-grabbing
                        ${stylistColour.fill} ${stylistColour.text}
                        ${appt.status === 'PENDING' ? 'border-2 border-dashed border-white/70' : ''}
                        ${isDragging ? 'opacity-80 ring-2 ring-zinc-900 z-20' : 'z-10'}
                        ${isClashing ? 'ring-2 ring-red-500' : ''}`}
                    >
                      <span className={`absolute left-0 top-0 bottom-0 w-1 ${serviceColour.stripe}`} />
                      <div
                        onPointerDown={beginDrag(appt, 'top')}
                        className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
                        style={{ touchAction: 'none' }}
                      />
                      <div className="pl-2.5 pr-1 py-1 text-[10px] leading-tight pointer-events-none">
                        <div className="font-semibold truncate">
                          {timeLabel(position.startMin)} {appt.customerName ?? t('appointment.customerFallback')}
                        </div>
                        <div className="truncate opacity-90">{appt.serviceName}</div>
                        {appt.moveRequested && <div className="font-semibold uppercase">{t('rescheduleRequests.badge')}</div>}
                        <div className="opacity-80">{t('grid.minutes', { count: position.durationMin })}</div>
                      </div>
                      <div
                        onPointerDown={beginDrag(appt, 'bottom')}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
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
        {t('grid.dayHint', { minutes: MIN_DURATION_MINUTES })}
        {saving && <span role="status" className="ml-2 font-medium text-zinc-700">{t('grid.saving')}</span>}
      </div>
    </div>
  );
}
