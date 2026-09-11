'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { processDueNotificationsAction, runOperationsDiagnosticsAction, type OperationsActionState } from '@/app/actions/admin-operations';

const initialState: OperationsActionState = { status: 'idle' };

function SubmitButton({ children, busy }: { children: React.ReactNode; busy: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="rounded-lg bg-[#174F7F] px-4 py-3 text-sm font-semibold text-white hover:bg-[#123e64] disabled:opacity-50">{pending ? busy : children}</button>;
}

export function OperationsControls({ notificationsEnabled }: { notificationsEnabled: boolean }) {
  const [diagnosticState, diagnosticAction] = useActionState(runOperationsDiagnosticsAction, initialState);
  const [deliveryState, deliveryAction] = useActionState(processDueNotificationsAction, initialState);
  return <div className="grid gap-5 md:grid-cols-2">
    <form action={diagnosticAction} className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Check connections</h2>
      <p className="my-3 text-sm text-zinc-600">Check the database, email domain and shared Redis connection. This only reads provider status and saves the report.</p>
      <SubmitButton busy="Checking…">Run read-only diagnostics</SubmitButton>
      {diagnosticState.message && <p role="status" className="mt-3 text-sm text-zinc-700">{diagnosticState.message}</p>}
    </form>
    <form action={deliveryAction} className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Send due notifications</h2>
      <p className="my-3 text-sm text-zinc-600">Process up to ten eligible notifications already in the queue. This can send real emails to customers and the salon.</p>
      {notificationsEnabled ? <>
        <label className="mb-4 flex items-start gap-2 text-sm text-zinc-700"><input type="checkbox" name="confirmSend" required className="mt-1 h-4 w-4" />I intend to send these due booking notifications.</label>
        <SubmitButton busy="Processing…">Process due notifications</SubmitButton>
      </> : <p className="text-sm font-medium text-amber-800">Notification delivery is disabled.</p>}
      {deliveryState.message && <p role="status" className="mt-3 text-sm text-zinc-700">{deliveryState.message}</p>}
    </form>
  </div>;
}
