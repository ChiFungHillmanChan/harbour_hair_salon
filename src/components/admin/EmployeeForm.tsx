'use client';

import { useActionState, useId, useState } from 'react';
import type { EmployeeActionState } from '@/app/actions/employees';
import { useT } from '@/i18n/client';
import { clearDraft, usePreservedForm } from '@/i18n/draft-store';

type Stylist = { id: string; name: string };
type Employee = {
  id: string; name: string; title: string; payType: string;
  hourlyRate: string | null; monthlySalary: string | null; commissionRate: string | null;
  overtimeEnabled: boolean; overtimeThresholdHours: string | null; overtimeMultiplier: string | null;
  unpaidBreakMinutes: string | null;
  stylistId: string | null;
};

const PAY_TYPES = ['HOURLY', 'SALARY', 'COMMISSION', 'HYBRID'] as const;

export default function EmployeeForm({
  action,
  stylists,
  employee,
  linkedStylistIds = [],
}: {
  action: (formData: FormData) => Promise<EmployeeActionState | void>;
  stylists: Stylist[];
  employee?: Employee;
  /** Stylists already linked to an employee. Each stylist can only be linked once. */
  linkedStylistIds?: string[];
}) {
  const t = useT('adminStaff');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  // Unsaved fields survive a language switch (memory only); the new-employee
  // PIN is deliberately left out and has to be typed again.
  const draftKey = `employee-form:${employee?.id ?? 'new'}`;
  const formRef = usePreservedForm(draftKey);

  // A stylist already claimed by another employee cannot be picked again
  // (Employee.stylistId is unique); the one this employee owns stays selectable.
  const selectableStylists = stylists.filter(
    (s) => s.id === employee?.stylistId || !linkedStylistIds.includes(s.id)
  );

  async function onSubmit(formData: FormData) {
    setPending(true);
    const res = await action(formData);
    setPending(false);
    const message = res && 'error' in res ? res.error : undefined;
    setError(message ?? null);
    setSaved(!message);
    if (!message) clearDraft(draftKey);
  }

  const f = (key: Parameters<typeof t>[0]) => ({ placeholder: t(key), 'aria-label': t(key) });

  return (
    <form ref={formRef} action={onSubmit} className="space-y-4 max-w-xl">
      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      {saved && !error && (
        <p className="text-green-700 text-sm" role="status">{employee ? t('employees.form.saved') : t('employees.form.added')}</p>
      )}
      <input name="name" defaultValue={employee?.name} {...f('employees.form.name')} required className="w-full border p-2 rounded" />
      <input name="title" defaultValue={employee?.title} {...f('employees.form.title')} required className="w-full border p-2 rounded" />
      <select name="payType" defaultValue={employee?.payType ?? 'HOURLY'} aria-label={t('employees.form.payType')} className="w-full border p-2 rounded">
        {PAY_TYPES.map((type) => <option key={type} value={type}>{t.dynamic(`payType.${type}`)}</option>)}
      </select>
      <input name="hourlyRate" type="number" step="0.01" defaultValue={employee?.hourlyRate ?? ''} {...f('employees.form.hourlyRate')} className="w-full border p-2 rounded" />
      <input name="monthlySalary" type="number" step="0.01" defaultValue={employee?.monthlySalary ?? ''} {...f('employees.form.monthlySalary')} className="w-full border p-2 rounded" />
      <input name="commissionRate" type="number" step="0.01" min="0" max="1" defaultValue={employee?.commissionRate ?? ''} {...f('employees.form.commissionRate')} className="w-full border p-2 rounded" />
      <label className="flex items-center gap-2">
        <input name="overtimeEnabled" type="checkbox" defaultChecked={employee?.overtimeEnabled} /> {t('employees.form.overtimeEnabled')}
      </label>
      <input name="overtimeThresholdHours" type="number" step="0.5" defaultValue={employee?.overtimeThresholdHours ?? ''} {...f('employees.form.overtimeThreshold')} className="w-full border p-2 rounded" />
      <input name="overtimeMultiplier" type="number" step="0.1" min="1" defaultValue={employee?.overtimeMultiplier ?? ''} {...f('employees.form.overtimeMultiplier')} className="w-full border p-2 rounded" />
      <input name="unpaidBreakMinutes" type="number" min="0" max="480" step="5" defaultValue={employee?.unpaidBreakMinutes ?? ''} {...f('employees.form.unpaidBreak')} className="w-full border p-2 rounded" />
      <select name="stylistId" defaultValue={employee?.stylistId ?? ''} aria-label={t('employees.form.stylist')} className="w-full border p-2 rounded">
        <option value="">{t('employees.form.noStylist')}</option>
        {selectableStylists.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {!employee && (
        <input name="pin" inputMode="numeric" pattern="\d{4,6}" {...f('employees.form.pin')} required autoComplete="off" data-no-preserve className="w-full border p-2 rounded" />
      )}
      <button type="submit" disabled={pending} className="bg-zinc-900 text-white px-6 py-3 uppercase tracking-[0.15em] font-bold hover:bg-black transition-colors disabled:opacity-50">
        {pending ? t('employees.form.saving') : employee ? t('employees.form.save') : t('employees.form.add')}
      </button>
    </form>
  );
}

/**
 * Per-row PIN reset for the employees table. Lives here rather than in its own
 * file because it is the other half of the employee admin form surface; the
 * table row is a server component, so the input + feedback need a client island.
 */
export function EmployeePinReset({
  action,
  employeeName,
}: {
  /** `resetEmployeePin.bind(null, employee.id)`. */
  action: (prev: EmployeeActionState, formData: FormData) => Promise<EmployeeActionState>;
  employeeName: string;
}) {
  const t = useT('adminStaff');
  const [state, formAction, pending] = useActionState<EmployeeActionState, FormData>(action, {});
  const inputId = useId();

  return (
    <form action={formAction} className="flex items-center gap-1">
      <label className="sr-only" htmlFor={inputId}>{t('employees.pinReset.label', { name: employeeName })}</label>
      <input
        id={inputId}
        name="pin"
        inputMode="numeric"
        pattern="\d{4,6}"
        required
        autoComplete="off"
        placeholder={t('employees.pinReset.placeholder')}
        className="w-24 border p-1 rounded text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-zinc-700 hover:text-zinc-900 font-medium disabled:opacity-50"
      >
        {pending ? t('employees.pinReset.saving') : t('employees.pinReset.set')}
      </button>
      {state.error && <span className="text-xs text-red-600" role="alert">{state.error}</span>}
      {state.success && <span className="text-xs text-green-700" role="status">{t('employees.pinReset.updated')}</span>}
    </form>
  );
}
