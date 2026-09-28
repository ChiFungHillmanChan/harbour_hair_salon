'use client';

import { useActionState, useEffect } from 'react';
import { createShift } from '@/app/actions/shifts';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type Employee = { id: string; name: string };

const DRAFT_KEY = 'shift-form';

export function ShiftForm({ employees }: { employees: Employee[] }) {
  const t = useT('adminStaff');
  const formRef = usePreservedForm(DRAFT_KEY);
  const [state, action, isPending] = useActionState(createShift, undefined);

  // An added shift starts the next one clean.
  useEffect(() => {
    if (state && !state.error) clearDraft(DRAFT_KEY);
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap gap-3 items-end">
      {state?.error && (
        <p className="w-full text-sm text-red-600" role="alert">{state.error}</p>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="employeeId">{t('shifts.form.employee')}</label>
        <select
          id="employeeId"
          name="employeeId"
          required
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">{t('shifts.form.selectEmployee')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="date">{t('shifts.form.date')}</label>
        <input
          id="date"
          type="date"
          name="date"
          required
          className="border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="startTime">{t('shifts.form.start')}</label>
        <input
          id="startTime"
          type="time"
          name="startTime"
          required
          className="border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="endTime">{t('shifts.form.end')}</label>
        <input
          id="endTime"
          type="time"
          name="endTime"
          required
          className="border rounded px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="bg-zinc-900 hover:bg-black text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
      >
        {isPending ? t('shifts.form.adding') : t('shifts.form.add')}
      </button>
    </form>
  );
}
