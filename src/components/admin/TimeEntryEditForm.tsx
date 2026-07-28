'use client';

import { useActionState } from 'react';
import { updateTimeEntry } from '@/app/actions/timesheets';

type State = { error?: string; success?: boolean };

interface TimeEntryEditFormProps {
  entryId: string;
  /** Salon-local values, pre-formatted by the page: YYYY-MM-DD and HH:mm. */
  date: string;
  clockInTime: string;
  /** Empty string for an entry that is still open (no clock-out yet). */
  clockOutTime: string;
  breakMinutes: number;
  note: string;
}

const fieldClass = 'border border-zinc-300 rounded px-2 py-1 text-sm w-full';

/**
 * Per-row correction form for a time entry. Saving flips the entry to EDITED,
 * so a corrected entry has to be approved again before payroll picks it up.
 */
export function TimeEntryEditForm({ entryId, date, clockInTime, clockOutTime, breakMinutes, note }: TimeEntryEditFormProps) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => updateTimeEntry(entryId, formData),
    {},
  );

  return (
    <form action={action} className="mt-2 w-56 space-y-2 whitespace-normal">
      <div>
        <label className="block text-xs font-medium text-zinc-700" htmlFor={`date-${entryId}`}>Date</label>
        <input id={`date-${entryId}`} type="date" name="date" defaultValue={date} required className={fieldClass} />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-700" htmlFor={`clockIn-${entryId}`}>Clock in</label>
        <input id={`clockIn-${entryId}`} type="time" name="clockInTime" defaultValue={clockInTime} required className={fieldClass} />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-700" htmlFor={`clockOut-${entryId}`}>Clock out</label>
        <input id={`clockOut-${entryId}`} type="time" name="clockOutTime" defaultValue={clockOutTime} className={fieldClass} />
        <p className="mt-1 text-xs text-zinc-500">Leave empty to keep the entry open. Clock-out must be later on the same day.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-700" htmlFor={`break-${entryId}`}>Break (minutes)</label>
        <input id={`break-${entryId}`} type="number" name="breakMinutes" min={0} max={1440} step={1} defaultValue={breakMinutes} className={fieldClass} />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-700" htmlFor={`note-${entryId}`}>Note</label>
        <input id={`note-${entryId}`} type="text" name="note" maxLength={500} defaultValue={note} placeholder="Why it was changed" className={fieldClass} />
      </div>
      {state.error && <p className="text-xs text-red-600" role="alert">{state.error}</p>}
      {state.success && <p className="text-xs text-zinc-600" role="status">Saved — this entry now needs approving again.</p>}
      <button
        type="submit"
        disabled={pending}
        className="bg-zinc-900 hover:bg-black text-white px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
