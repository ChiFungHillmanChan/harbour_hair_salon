'use client';

import { useTransition } from 'react';
import type { LateArrivalBoard } from '@/app/services/late-arrival-board';
import { LATE_ARRIVAL_CANCEL_MINUTES } from '@/app/lib/booking-constants';
import { hasAppointmentStarted } from '@/app/lib/appointment-timing';
import { formatSalonClock, formatSalonDateTime } from '@/i18n/dates';
import { useLocale, useT } from '@/i18n/client';
import { useLocalizedRouter } from '@/i18n/navigation';

// Admin → Schedule's arrivals panel (late-arrival rule,
// docs/superpowers/specs/2026-10-16-late-arrival-auto-cancel-design.md §4.4).
// The grids hide cancelled bookings and their blocks are drag targets, so
// Arrived and Restore live here rather than on the blocks.

type DueRow = LateArrivalBoard['due'][number];
type CancelledRow = LateArrivalBoard['lateCancelled'][number];

export function LateArrivalPanel({ board }: { board: LateArrivalBoard }) {
  const t = useT('adminSchedule');
  const router = useLocalizedRouter();
  if (board.due.length === 0 && board.lateCancelled.length === 0) return null;
  // After every answer, refusals included: the rule or a colleague may have got there first.
  const refresh = () => router.refresh();
  return (
    <section aria-label={t('arrivals.title')} className="mb-4 rounded-lg border border-zinc-300 bg-white p-4">
      <h2 className="font-semibold text-zinc-900">{t('arrivals.title')}</h2>
      {/* The terms cancel only customers who didn't let us know. */}
      {board.ruleOn && <p className="mt-1 text-sm text-zinc-600">{t('arrivals.lateCallHint')}</p>}
      {board.due.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200">
          {board.due.map((row) => <DueArrival key={row.id} row={row} onDone={refresh} />)}
        </ul>
      )}
      {board.lateCancelled.length > 0 && (
        <ul className={`divide-y divide-zinc-200 ${board.due.length > 0 ? 'mt-3 border-t border-zinc-300' : 'mt-3'}`}>
          {board.lateCancelled.map((row) => <LateCancelled key={row.id} row={row} onDone={refresh} />)}
        </ul>
      )}
    </section>
  );
}

function Booking({ when, row }: { when: string; row: DueRow | CancelledRow }) {
  const t = useT('adminSchedule');
  return (
    <>
      <p className="text-zinc-900">
        <span className="font-medium tabular-nums">{when}</span> {row.customerName ?? t('appointment.customerFallback')}
      </p>
      <p className="text-zinc-600">{row.stylistName} · {row.serviceName}</p>
    </>
  );
}

function DueArrival({ row, onDone }: { row: DueRow; onDone: () => void }) {
  const t = useT('adminSchedule');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const arrive = () => startTransition(async () => {
    try {
      const { markArrived } = await import('@/app/actions/admin-arrivals');
      const result = await markArrived(row.id, true);
      if (!result.success) alert(result.error);
    } catch {
      // The request itself failed: say so, never the error boundary.
      alert(t('appointment.updateFailed'));
    }
    onDone();
  });
  // Said only once the start has passed, and only when the rule will reach this booking.
  const cancelsAt = row.cancelsAt && hasAppointmentStarted(row.date) ? row.cancelsAt : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <Booking when={formatSalonClock(locale, new Date(row.date))} row={row} />
        {cancelsAt && (
          <p className="font-semibold text-zinc-900">{t('arrivals.cancelsAt', { time: formatSalonClock(locale, new Date(cancelsAt)) })}</p>
        )}
      </div>
      <button type="button" disabled={pending} onClick={arrive} aria-busy={pending}
        className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60">
        {t('arrivals.markArrived')}
      </button>
    </li>
  );
}

function LateCancelled({ row, onDone }: { row: CancelledRow; onDone: () => void }) {
  const t = useT('adminSchedule');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const restore = () => startTransition(async () => {
    try {
      const { restoreLateCancellation } = await import('@/app/actions/admin-arrivals');
      let result = await restoreLateCancellation(row.id);
      // Fresha may have resold the time; the customer is usually already in the chair.
      if (!result.success && 'clashes' in result) {
        if (!window.confirm(t('arrivals.restoreClash'))) return onDone();
        result = await restoreLateCancellation(row.id, { force: true });
      }
      if (!result.success) alert('error' in result ? result.error : t('appointment.updateFailed'));
    } catch {
      // The request itself failed: say so, never the error boundary.
      alert(t('appointment.updateFailed'));
    }
    onDone();
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        {/* Up to a day old: the date says whether it was today or yesterday. */}
        <Booking when={formatSalonDateTime(locale, new Date(row.date))} row={row} />
        <p className="text-zinc-700">
          {t('arrivals.lateCancelled', { time: formatSalonClock(locale, new Date(row.lateCancelledAt)), minutes: LATE_ARRIVAL_CANCEL_MINUTES })}
        </p>
        {row.customerEmailed && <p className="font-medium text-zinc-900">{t('arrivals.alreadyEmailed')}</p>}
      </div>
      <button type="button" disabled={pending} onClick={restore} aria-busy={pending}
        className="rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60">
        {t('arrivals.restore')}
      </button>
    </li>
  );
}
