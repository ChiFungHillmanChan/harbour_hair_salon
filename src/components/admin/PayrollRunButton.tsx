'use client';

import { useActionState } from 'react';
import { runPayrollAction } from '@/app/actions/payroll';

type State = { error?: string; success?: boolean };

/**
 * Runs / recomputes a payroll month. runPayrollAction returns an { error } for
 * an invalid or already-finalized period; the plain server-action form this
 * replaces swallowed it, so a refused run looked identical to a successful one.
 */
export function PayrollRunButton({ year, month }: { year: number; month: number }) {
  const [state, action, pending] = useActionState<State, FormData>(
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
        {pending ? 'Running…' : 'Run / recompute from approved timesheets'}
      </button>
      {state.error && <p className="mt-1 text-sm text-red-600" role="alert">{state.error}</p>}
      {state.success && <p className="mt-1 text-sm text-zinc-600" role="status">Payroll recomputed from approved timesheets.</p>}
    </form>
  );
}
