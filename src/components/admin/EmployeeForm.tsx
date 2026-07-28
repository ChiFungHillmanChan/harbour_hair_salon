'use client';

import { useActionState, useId, useState } from 'react';
import type { EmployeeActionState } from '@/app/actions/employees';

type Stylist = { id: string; name: string };
type Employee = {
  id: string; name: string; title: string; payType: string;
  hourlyRate: string | null; monthlySalary: string | null; commissionRate: string | null;
  overtimeEnabled: boolean; overtimeThresholdHours: string | null; overtimeMultiplier: string | null;
  unpaidBreakMinutes: string | null;
  stylistId: string | null;
};

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
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

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
  }

  return (
    <form action={onSubmit} className="space-y-4 max-w-xl">
      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      {saved && !error && (
        <p className="text-green-700 text-sm">{employee ? 'Changes saved.' : 'Employee added.'}</p>
      )}
      <input name="name" defaultValue={employee?.name} placeholder="Full name" required className="w-full border p-2 rounded" />
      <input name="title" defaultValue={employee?.title} placeholder="Title (e.g. Senior Stylist)" required className="w-full border p-2 rounded" />
      <select name="payType" defaultValue={employee?.payType ?? 'HOURLY'} className="w-full border p-2 rounded">
        <option value="HOURLY">Hourly</option>
        <option value="SALARY">Fixed monthly salary</option>
        <option value="COMMISSION">Commission only</option>
        <option value="HYBRID">Hybrid (base + commission)</option>
      </select>
      <input name="hourlyRate" type="number" step="0.01" defaultValue={employee?.hourlyRate ?? ''} placeholder="Hourly rate (£)" className="w-full border p-2 rounded" />
      <input name="monthlySalary" type="number" step="0.01" defaultValue={employee?.monthlySalary ?? ''} placeholder="Monthly salary (£)" className="w-full border p-2 rounded" />
      <input name="commissionRate" type="number" step="0.01" min="0" max="1" defaultValue={employee?.commissionRate ?? ''} placeholder="Commission rate (fraction, e.g. 0.4)" className="w-full border p-2 rounded" />
      <label className="flex items-center gap-2">
        <input name="overtimeEnabled" type="checkbox" defaultChecked={employee?.overtimeEnabled} /> Enable overtime
      </label>
      <input name="overtimeThresholdHours" type="number" step="0.5" defaultValue={employee?.overtimeThresholdHours ?? ''} placeholder="Overtime threshold (hours per month)" className="w-full border p-2 rounded" />
      <input name="overtimeMultiplier" type="number" step="0.1" min="1" defaultValue={employee?.overtimeMultiplier ?? ''} placeholder="Overtime multiplier (e.g. 1.5)" className="w-full border p-2 rounded" />
      <input name="unpaidBreakMinutes" type="number" min="0" max="480" step="5" defaultValue={employee?.unpaidBreakMinutes ?? ''} placeholder="Fixed unpaid break (mins/day) — leave blank if breaks are clocked" className="w-full border p-2 rounded" />
      <select name="stylistId" defaultValue={employee?.stylistId ?? ''} className="w-full border p-2 rounded">
        <option value="">— Not a bookable stylist —</option>
        {selectableStylists.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {!employee && (
        <input name="pin" inputMode="numeric" pattern="\d{4,6}" placeholder="Clock-in PIN (4–6 digits)" required className="w-full border p-2 rounded" />
      )}
      <button type="submit" disabled={pending} className="bg-zinc-900 text-white px-6 py-3 uppercase tracking-[0.15em] font-bold hover:bg-black transition-colors disabled:opacity-50">
        {employee ? 'Save changes' : 'Add employee'}
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
  const [state, formAction, pending] = useActionState<EmployeeActionState, FormData>(action, {});
  const inputId = useId();

  return (
    <form action={formAction} className="flex items-center gap-1">
      <label className="sr-only" htmlFor={inputId}>New PIN for {employeeName}</label>
      <input
        id={inputId}
        name="pin"
        inputMode="numeric"
        pattern="\d{4,6}"
        required
        placeholder="New PIN"
        className="w-24 border p-1 rounded text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-zinc-700 hover:text-zinc-900 font-medium disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Set PIN'}
      </button>
      {state.error && <span className="text-xs text-red-600" role="alert">{state.error}</span>}
      {state.success && <span className="text-xs text-green-700">PIN updated</span>}
    </form>
  );
}
