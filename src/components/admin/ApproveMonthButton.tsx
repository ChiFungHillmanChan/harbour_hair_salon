'use client';

import { useActionState } from 'react';
import { approveMonth } from '@/app/actions/timesheets';

type State = { error?: string; count?: number };

/**
 * Bulk-approves a month's closed entries. approveMonth returns how many rows it
 * touched; without this wrapper that count was discarded and the owner had no
 * way to tell "approved 12" from "matched nothing".
 */
export function ApproveMonthButton({ year, month }: { year: number; month: number }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async () => approveMonth(year, month),
    {},
  );

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Approve every closed entry in this month? Each one can still be un-approved individually.')) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="bg-zinc-900 hover:bg-black text-white px-4 py-2 rounded transition-colors disabled:opacity-50"
      >
        {pending ? 'Approving…' : 'Approve all (closed) for this month'}
      </button>
      {state.error && <p className="mt-1 text-sm text-red-600" role="alert">{state.error}</p>}
      {state.count !== undefined && (
        <p className="mt-1 text-sm text-zinc-600" role="status">
          {state.count === 0 ? 'Nothing to approve — every closed entry this month is already approved.' : `${state.count} ${state.count === 1 ? 'entry' : 'entries'} approved.`}
        </p>
      )}
    </form>
  );
}
