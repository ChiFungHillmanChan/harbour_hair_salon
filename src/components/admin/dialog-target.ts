import type { DepositView } from '@/app/lib/deposit-display';
import type { DialogTarget } from './AppointmentDialog';

/**
 * The booking dialog keeps the row it was opened with (a draft, so it survives
 * a language switch), but its deposit must follow the board: "Re-check
 * payment" and "Mark refund as settled outside the website" refresh the board,
 * and an open dialog kept showing the pending refund and its settle button
 * until reopened (sandbox acceptance, 15 October 2026). Only the deposit is
 * taken from the fresh row: `updatedAt` stays the one the dialog opened with,
 * so saving still detects a change someone made meanwhile.
 */
export function withLiveDeposit(
  target: DialogTarget,
  rows: ReadonlyMap<string, { deposit?: DepositView | null }>,
): DialogTarget {
  if (target.mode !== 'edit') return target;
  const row = rows.get(target.appointmentId);
  if (!row) return target;
  return { ...target, deposit: row.deposit ?? null };
}
