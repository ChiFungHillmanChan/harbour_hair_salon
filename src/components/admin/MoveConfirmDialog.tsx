'use client';

import { useEffect, useId, useRef } from 'react';
import { useT } from '@/i18n/client';

/** One thing a drag or resize would change, already formatted for the page language. */
export type MoveChange = { kind: 'time' | 'stylist' | 'length'; from: string; to: string };

interface MoveConfirmDialogProps {
  customer: string;
  service: string;
  /** Only what changed. */
  changes: MoveChange[];
  onMove: () => void;
  onCancel: () => void;
}

/**
 * On an iPad the tap that ends a drag can arrive a moment later as a click on
 * whatever the dialog has put under the finger. Clicks this soon after the
 * dialog opens are ignored, so nothing is moved — or cancelled — by accident.
 */
const GHOST_TAP_MS = 350;

/**
 * "Move this booking?" — asked after a drop or resize, before anything is
 * saved. Focus starts on Cancel so a stray Enter never moves a booking; Esc and
 * a click outside cancel; Tab stays inside. Clicks in the first GHOST_TAP_MS
 * do nothing.
 */
export function MoveConfirmDialog({ customer, service, changes, onMove, onCancel }: MoveConfirmDialogProps) {
  const t = useT('adminSchedule');
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const moveRef = useRef<HTMLButtonElement>(null);
  // When the dialog mounted; null until then (a click before that is the ghost tap too).
  const openedAt = useRef<number | null>(null);

  useEffect(() => {
    openedAt.current = Date.now();
    cancelRef.current?.focus();
  }, []);

  /** A real click: the dialog has been open long enough to have been read. */
  const settled = () => openedAt.current !== null && Date.now() - openedAt.current >= GHOST_TAP_MS;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === 'Tab') {
      // Two buttons: keep focus on them rather than the page behind.
      event.preventDefault();
      const goingTo = document.activeElement === cancelRef.current ? moveRef.current : cancelRef.current;
      goingTo?.focus();
    }
  };

  const label = (kind: MoveChange['kind']) => t(`moveConfirm.${kind}`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && settled()) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Focusable itself: after a click on its text, Esc and Tab still reach onKeyDown.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-xl focus:outline-none"
      >
        <h2 id={titleId} className="text-base font-semibold text-zinc-900">{t('moveConfirm.title')}</h2>
        <p className="mt-1 text-sm text-zinc-600">{customer} · {service}</p>
        <dl className="mt-3 space-y-2 text-sm">
          {changes.map((change) => {
            const value = change.kind === 'length'
              ? t('moveConfirm.minutes', { from: change.from, to: change.to })
              : `${change.from} → ${change.to}`;
            return (
              <div key={change.kind}>
                <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label(change.kind)}</dt>
                <dd
                  className="tabular-nums text-zinc-900"
                  aria-label={`${label(change.kind)}: ${t('moveConfirm.from')} ${change.from} ${t('moveConfirm.to')} ${change.to}`}
                >
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => {
              if (settled()) onCancel();
            }}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-900"
          >
            {t('moveConfirm.cancel')}
          </button>
          <button
            ref={moveRef}
            type="button"
            onClick={() => {
              if (settled()) onMove();
            }}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            {t('moveConfirm.move')}
          </button>
        </div>
      </div>
    </div>
  );
}
