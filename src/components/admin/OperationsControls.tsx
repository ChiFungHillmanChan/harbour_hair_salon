'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { processDueNotificationsAction, runOperationsDiagnosticsAction, type OperationsActionState } from '@/app/actions/admin-operations';
import { useT } from '@/i18n/client';

const initialState: OperationsActionState = { status: 'idle' };

function SubmitButton({ children, busy }: { children: React.ReactNode; busy: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="rounded-lg bg-[#174F7F] px-4 py-3 text-sm font-semibold text-white hover:bg-[#123e64] disabled:opacity-50">{pending ? busy : children}</button>;
}

export function OperationsControls({ notificationsEnabled }: { notificationsEnabled: boolean }) {
  const t = useT('adminOps');
  const [diagnosticState, diagnosticAction] = useActionState(runOperationsDiagnosticsAction, initialState);
  const [deliveryState, deliveryAction] = useActionState(processDueNotificationsAction, initialState);
  return <div className="grid gap-5 md:grid-cols-2">
    <form action={diagnosticAction} className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">{t('operations.controls.diagnosticsTitle')}</h2>
      <p className="my-3 text-sm text-zinc-600">{t('operations.controls.diagnosticsHelp')}</p>
      <SubmitButton busy={t('operations.controls.checking')}>{t('operations.controls.runDiagnostics')}</SubmitButton>
      {diagnosticState.message && <p role="status" className="mt-3 text-sm text-zinc-700">{diagnosticState.message}</p>}
    </form>
    {/* No draft preservation: the send acknowledgement must be ticked again
        deliberately, never carried over by a language switch. */}
    <form action={deliveryAction} className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">{t('operations.controls.sendTitle')}</h2>
      <p className="my-3 text-sm text-zinc-600">{t('operations.controls.sendHelp')}</p>
      {notificationsEnabled ? <>
        <label className="mb-4 flex items-start gap-2 text-sm text-zinc-700"><input type="checkbox" name="confirmSend" required className="mt-1 h-4 w-4" />{t('operations.controls.confirmSend')}</label>
        <SubmitButton busy={t('operations.controls.processing')}>{t('operations.controls.process')}</SubmitButton>
      </> : <p className="text-sm font-medium text-amber-800">{t('operations.controls.disabled')}</p>}
      {deliveryState.message && <p role="status" className="mt-3 text-sm text-zinc-700">{deliveryState.message}</p>}
    </form>
  </div>;
}
