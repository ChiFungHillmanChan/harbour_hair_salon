'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { processDueNotificationsAction, runOperationsDiagnosticsAction, type OperationsActionState } from '@/app/actions/admin-operations';
import { useT } from '@/i18n/client';
import { MobileScheduleDisclosure } from '@/components/admin/MobileScheduleDisclosure';

const initialState: OperationsActionState = { status: 'idle' };

function SubmitButton({ children, busy }: { children: React.ReactNode; busy: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="min-h-11 w-full sm:w-auto rounded-lg bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50">{pending ? busy : children}</button>;
}

export function OperationsControls({ notificationsEnabled }: { notificationsEnabled: boolean }) {
  const t = useT('adminOps');
  const [diagnosticState, diagnosticAction] = useActionState(runOperationsDiagnosticsAction, initialState);
  const [deliveryState, deliveryAction] = useActionState(processDueNotificationsAction, initialState);
  return <MobileScheduleDisclosure label={t('operations.controls.title')}>
    <div className="grid min-w-0 gap-3 sm:gap-5 md:grid-cols-2">
      <form action={diagnosticAction} className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
        <h2 className="font-semibold text-zinc-900">{t('operations.controls.diagnosticsTitle')}</h2>
        <p className="my-3 text-sm text-zinc-600">{t('operations.controls.diagnosticsHelp')}</p>
        <SubmitButton busy={t('operations.controls.checking')}>{t('operations.controls.runDiagnostics')}</SubmitButton>
        {diagnosticState.message && <p role="status" className="mt-3 text-sm text-zinc-700">{diagnosticState.message}</p>}
      </form>
      {/* No draft preservation: the send acknowledgement must be ticked again
          deliberately, never carried over by a language switch. */}
      <form action={deliveryAction} className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
        <h2 className="font-semibold text-zinc-900">{t('operations.controls.sendTitle')}</h2>
        <p className="my-3 text-sm text-zinc-600">{t('operations.controls.sendHelp')}</p>
        {notificationsEnabled ? <>
          <label className="mb-4 flex min-h-11 items-start gap-3 text-sm text-zinc-700"><input type="checkbox" name="confirmSend" required className="mt-0.5 size-5 shrink-0 accent-zinc-900" />{t('operations.controls.confirmSend')}</label>
          <SubmitButton busy={t('operations.controls.processing')}>{t('operations.controls.process')}</SubmitButton>
        </> : <p className="text-sm font-medium text-amber-800">{t('operations.controls.disabled')}</p>}
        {deliveryState.message && <p role="status" className="mt-3 text-sm text-zinc-700">{deliveryState.message}</p>}
      </form>
    </div>
  </MobileScheduleDisclosure>;
}
