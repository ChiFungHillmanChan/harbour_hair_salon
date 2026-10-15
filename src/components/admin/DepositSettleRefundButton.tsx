'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatGBP } from '@/app/services/pricing/money';
import { HTML_LANG } from '@/i18n/config';
import { useT } from '@/i18n/client';

/**
 * "Mark refund as settled outside the website", next to "Re-check payment" in
 * the booking dialog, for a refund Square has not confirmed
 * (lib/deposit-display.ts `refundToSettle`). Staff who refunded the customer
 * themselves — in the Square Dashboard, or in cash — record it here, after a
 * confirm question naming the amount, so the website never sends that refund
 * to Square again (actions/admin-payments.ts markRefundSettledOutside;
 * docs/square-payments-setup.md §6). Monochrome, like the chip.
 *
 * The dialog keeps it mounted for any deposit, so its answer survives the
 * board refresh: `refund` is null once the refreshed deposit has none left to
 * settle, and a recorded refund leaves only the answer on screen.
 */
export function DepositSettleRefundButton({ appointmentId, refund }: { appointmentId: string; refund: { id: string; amountPence: number } | null }) {
  const t = useT('adminSchedule');
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; line: string } | null>(null);
  // A second click before the button re-renders as disabled asks nothing more.
  const inFlight = useRef(false);
  const amount = refund ? formatGBP(refund.amountPence, HTML_LANG[t.locale]) : '';

  const settle = async () => {
    if (!refund || inFlight.current) return;
    if (!window.confirm(t('deposit.settleOutside.confirm', { amount }))) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const { markRefundSettledOutside } = await import('@/app/actions/admin-payments');
      const result = await markRefundSettledOutside(appointmentId, refund.id);
      setAnswer(result.success ? { ok: true, line: result.message } : { ok: false, line: result.error });
      if (result.success) router.refresh();
    } catch {
      setAnswer({ ok: false, line: t('deposit.settleOutside.failed') });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const offered = refund !== null && !answer?.ok;
  if (!offered && !answer) return null;

  return (
    <div className="mt-2">
      {offered && (
        <>
          <p className="text-xs text-zinc-600">{t('deposit.settleOutside.help', { amount })}</p>
          <button
            type="button"
            onClick={settle}
            disabled={saving}
            className="mt-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? t('deposit.settleOutside.saving') : t('deposit.settleOutside.button')}
          </button>
        </>
      )}
      {answer && (
        <p role="status" className={`mt-2 rounded border px-2 py-1.5 text-xs ${answer.ok ? 'border-zinc-200 bg-white text-zinc-700' : 'border-zinc-500 bg-white text-zinc-900'}`}>
          {answer.line}
        </p>
      )}
    </div>
  );
}
