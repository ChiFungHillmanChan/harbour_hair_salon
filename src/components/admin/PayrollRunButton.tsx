'use client';

import { useActionState } from 'react';
import { runPayrollAction, type PayrollRunResult } from '@/app/actions/payroll';
import { useT } from '@/i18n/client';

/**
 * Runs / recomputes a payroll month. runPayrollAction returns an { error } for
 * an invalid or already-finalized period, or for commission that depends on
 * appointments without a recorded price (listed in `details`); the plain
 * server-action form this replaces swallowed it, so a refused run looked
 * identical to a successful one.
 */
export function PayrollRunButton({ year, month }: { year: number; month: number }) {
  const t = useT('adminStaff');
  const [state, action, pending] = useActionState<PayrollRunResult, FormData>(
    async () => runPayrollAction(year, month),
    {},
  );

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="bg-zinc-900 hover:bg-black text-white px-4 py-2 rounded transition-colors disabled:opacity-50"
      >
        {pending ? t('payroll.run.running') : t('payroll.run.button')}
      </button>
      {state.error && (
        <div className="mt-1 text-sm text-red-600" role="alert">
          <p>{state.error}</p>
          {state.details && state.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.details.map((detail, index) => <li key={index}>{detail}</li>)}
            </ul>
          )}
        </div>
      )}
      {state.success && <p className="mt-1 text-sm text-zinc-600" role="status">{t('payroll.run.success')}</p>}
    </form>
  );
}
