'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  updateStylistAvailability,
  type OpeningHoursState,
} from '@/app/actions/admin-availability';
import { DAY_NAMES, countSlots } from '@/app/services/opening-hours';

export type DayRow = {
  dayOfWeek: number;
  isOff: boolean;
  startTime: string;
  endTime: string;
};

export type StylistWeek = {
  id: string;
  name: string;
  days: DayRow[];
};

interface OpeningHoursFormProps {
  stylists: StylistWeek[];
  bookingEnabled: boolean;
}

/** Monday-first for readability; the values stay 0-6 Sun-Sat as stored. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The slot counts are a preview, so they need one stated service length. */
const PREVIEW_DURATION = 60;

export function OpeningHoursForm({ stylists, bookingEnabled }: OpeningHoursFormProps) {
  const [activeId, setActiveId] = useState(stylists[0]?.id ?? '');
  // The whole roster is held here so switching tabs keeps unsaved edits.
  const [weeks, setWeeks] = useState<Record<string, DayRow[]>>(() =>
    Object.fromEntries(stylists.map((s) => [s.id, s.days]))
  );
  const [dirty, setDirty] = useState(false);
  const [state, formAction, pending] = useActionState<OpeningHoursState, FormData>(
    updateStylistAvailability,
    { status: 'idle' }
  );

  // A successful save makes the local edits the saved state — without this the
  // banner says "saved" while the counter still says "Unsaved changes".
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the dirty flag once the action reports success, same idiom as AdminSidebar
    if (state.status === 'success') setDirty(false);
  }, [state]);

  const active = stylists.find((s) => s.id === activeId);
  const week = weeks[activeId] ?? [];

  if (!active) {
    return (
      <p className="text-sm text-zinc-500">
        No stylists yet — add one under Stylists first.
      </p>
    );
  }

  function patchDay(dayOfWeek: number, patch: Partial<DayRow>) {
    setWeeks((prev) => ({
      ...prev,
      [activeId]: (prev[activeId] ?? []).map((d) =>
        d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d
      ),
    }));
    setDirty(true);
  }

  function copyFirstOpenDayToAll() {
    const source = DISPLAY_ORDER.map((n) => week.find((d) => d.dayOfWeek === n)).find(
      (d) => d && !d.isOff
    );
    if (!source) return;
    setWeeks((prev) => ({
      ...prev,
      [activeId]: (prev[activeId] ?? []).map((d) =>
        d.isOff ? d : { ...d, startTime: source.startTime, endTime: source.endTime }
      ),
    }));
    setDirty(true);
  }

  const firstOpen = DISPLAY_ORDER.map((n) => week.find((d) => d.dayOfWeek === n)).find(
    (d) => d && !d.isOff
  );
  const weekSlots = week.reduce(
    (n, d) => n + (d.isOff ? 0 : countSlots(d.startTime, d.endTime, PREVIEW_DURATION)),
    0
  );

  return (
    <div className="space-y-5">
      {!bookingEnabled && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm leading-6 text-amber-900">
            <strong>Online booking is currently OFF.</strong> You can set these hours now and
            check them — nothing goes live until you switch booking on in{' '}
            <a href="/admin/settings" className="font-semibold underline">
              Site Settings
            </a>
            .
          </p>
        </div>
      )}

      {state.status === 'success' && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ Opening hours saved.
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.message}
        </div>
      )}

      {/* Stylist tabs */}
      <div className="flex gap-5 overflow-x-auto border-b border-zinc-200">
        {stylists.map((s) => {
          const on = s.id === activeId;
          const openDays = (weeks[s.id] ?? []).filter((d) => !d.isOff).length;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              aria-current={on ? 'true' : undefined}
              className={`flex shrink-0 items-center gap-2.5 border-b-2 px-1 py-3 text-[15px] transition-colors ${
                on
                  ? 'border-zinc-900 font-bold text-zinc-900'
                  : 'border-transparent font-medium text-zinc-500 hover:text-zinc-800'
              }`}
            >
              {s.name}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  on ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'
                }`}
              >
                {openDays} days
              </span>
            </button>
          );
        })}
      </div>

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="stylistId" value={activeId} />

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="hidden gap-0 border-b border-zinc-200 bg-zinc-100 px-6 py-3 sm:grid sm:grid-cols-[150px_120px_1fr_140px]">
            {['Day', 'Open', 'Hours', 'Bookable slots'].map((h, i) => (
              <div
                key={h}
                className={`text-[11px] font-bold uppercase tracking-wider text-zinc-600 ${
                  i === 3 ? 'text-right' : ''
                }`}
              >
                {h}
              </div>
            ))}
          </div>

          {DISPLAY_ORDER.map((dayOfWeek, i) => {
            const day = week.find((d) => d.dayOfWeek === dayOfWeek);
            if (!day) return null;
            const open = !day.isOff;
            const slots = open ? countSlots(day.startTime, day.endTime, PREVIEW_DURATION) : 0;
            return (
              <div
                key={dayOfWeek}
                className={`grid grid-cols-1 items-center gap-3 px-6 py-4 sm:grid-cols-[150px_120px_1fr_140px] sm:gap-0 ${
                  i < DISPLAY_ORDER.length - 1 ? 'border-b border-zinc-100' : ''
                } ${open ? '' : 'bg-zinc-50'}`}
              >
                <div className="flex flex-col">
                  <span
                    className={`text-[15px] font-semibold ${open ? 'text-zinc-900' : 'text-zinc-400'}`}
                  >
                    {DAY_NAMES[dayOfWeek]}
                  </span>
                  <span className="text-[11px] text-zinc-400">dayOfWeek {dayOfWeek}</span>
                </div>

                <label className="flex min-h-11 items-center gap-3 sm:min-h-0">
                  <input
                    type="checkbox"
                    name={`open-${dayOfWeek}`}
                    checked={open}
                    onChange={(e) => patchDay(dayOfWeek, { isOff: !e.target.checked })}
                    className="h-5 w-5 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-900"
                  />
                  <span className="text-sm text-zinc-600 sm:hidden">Open</span>
                </label>

                <div className="flex items-center gap-2.5">
                  {open ? (
                    <>
                      <input
                        type="time"
                        name={`start-${dayOfWeek}`}
                        value={day.startTime}
                        onChange={(e) => patchDay(dayOfWeek, { startTime: e.target.value })}
                        className="min-h-11 w-[128px] rounded border border-zinc-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      />
                      <span className="text-sm text-zinc-400">to</span>
                      <input
                        type="time"
                        name={`end-${dayOfWeek}`}
                        value={day.endTime}
                        onChange={(e) => patchDay(dayOfWeek, { endTime: e.target.value })}
                        className="min-h-11 w-[128px] rounded border border-zinc-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-zinc-900"
                      />
                    </>
                  ) : (
                    <>
                      {/* Keep the values submitted so a closed day round-trips
                          its hours instead of losing them. */}
                      <input type="hidden" name={`start-${dayOfWeek}`} value={day.startTime} />
                      <input type="hidden" name={`end-${dayOfWeek}`} value={day.endTime} />
                      <span className="text-sm italic text-zinc-400">
                        Closed — no slots offered
                      </span>
                    </>
                  )}
                </div>

                <div className="sm:text-right">
                  <span
                    className={`text-sm tabular-nums ${open ? 'text-zinc-600' : 'text-zinc-300'}`}
                  >
                    {open ? `${slots} slots` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={copyFirstOpenDayToAll}
            disabled={!firstOpen}
            className="inline-flex min-h-11 items-center justify-center rounded border border-zinc-300 bg-white px-5 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            Copy {firstOpen ? DAY_NAMES[firstOpen.dayOfWeek] : 'Monday'} to every open day
          </button>

          <div className="flex items-center gap-4">
            <span
              className={`text-[13px] ${dirty ? 'font-semibold text-amber-700' : 'text-zinc-500'}`}
            >
              {dirty
                ? 'Unsaved changes'
                : `${weekSlots} bookable slots a week (${PREVIEW_DURATION}-minute service)`}
            </span>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded bg-zinc-900 px-8 text-[13px] font-bold uppercase tracking-[0.15em] text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save opening hours'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
