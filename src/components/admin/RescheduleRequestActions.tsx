'use client';

import { useTransition } from 'react';
import { useT } from '@/i18n/client';

// Approve / decline for a customer's request to move a CONFIRMED booking.
export function RescheduleRequestActions({ appointmentId, requestedAt, expired, onDone }: { appointmentId: string; requestedAt: string; expired: boolean; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const t = useT('adminSchedule');
  const run = (decision: 'APPROVE' | 'DECLINE') => startTransition(async () => {
    const { decideRescheduleRequest } = await import('@/app/actions/admin');
    const res = await decideRescheduleRequest(appointmentId, decision, requestedAt);
    if (res.success) onDone(); else alert(res.error ?? t('appointment.updateFailed'));
  });
  return (
    <div className="flex gap-2" aria-busy={pending}>
      {!expired && (
        <button type="button" disabled={pending} onClick={() => run('APPROVE')}
          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-wait disabled:opacity-60">
          {pending ? t('rescheduleRequests.approving') : t('rescheduleRequests.approve')}
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => { if (window.confirm(t('rescheduleRequests.declineConfirm'))) run('DECLINE'); }}
        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60">
        {t('rescheduleRequests.decline')}
      </button>
    </div>
  );
}
