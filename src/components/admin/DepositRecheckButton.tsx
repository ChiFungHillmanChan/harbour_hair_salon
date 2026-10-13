'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/i18n/client';

/**
 * "Re-check payment", next to a booking's deposit chip in the booking dialog:
 * asks Square about this booking's deposit and refunds now
 * (actions/admin-payments.ts) and shows what is true, then refreshes the
 * board behind the dialog so its chips follow. Monochrome, like the chip.
 */
export function DepositRecheckButton({ appointmentId }: { appointmentId: string }) {
  const t = useT('adminSchedule');
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; lines: string[] } | null>(null);
  // A second click before the button re-renders as disabled asks nothing more.
  const inFlight = useRef(false);

  const recheck = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const { recheckAppointmentPayment } = await import('@/app/actions/admin-payments');
      const result = await recheckAppointmentPayment(appointmentId);
      setAnswer(result.success ? { ok: true, lines: result.lines } : { ok: false, lines: [result.error] });
      if (result.success) router.refresh();
    } catch {
      setAnswer({ ok: false, lines: [t('deposit.recheck.failed')] });
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={recheck}
        disabled={checking}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60"
      >
        {checking ? t('deposit.recheck.checking') : t('deposit.recheck.button')}
      </button>
      {answer && (
        <div role="status" className={`mt-2 space-y-1 rounded border px-2 py-1.5 text-xs ${answer.ok ? 'border-zinc-200 bg-white text-zinc-700' : 'border-zinc-500 bg-white text-zinc-900'}`}>
          {answer.lines.map((line, index) => <p key={index}>{line}</p>)}
        </div>
      )}
    </div>
  );
}
