'use client';

import { useState } from 'react';

type Stylist = { id: string; name: string };
type Employee = {
  id: string; name: string; title: string; payType: string;
  hourlyRate: string | null; monthlySalary: string | null; commissionRate: string | null;
  overtimeEnabled: boolean; overtimeThresholdHours: string | null; overtimeMultiplier: string | null;
  stylistId: string | null;
};

export default function EmployeeForm({
  action,
  stylists,
  employee,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  stylists: Stylist[];
  employee?: Employee;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const res = await action(formData);
    setPending(false);
    if (res && 'error' in res && res.error) setError(res.error);
    else setError(null);
  }

  return (
    <form action={onSubmit} className="space-y-4 max-w-xl">
      {error && <p className="text-red-600 text-sm">{error}</p>}
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
      <select name="stylistId" defaultValue={employee?.stylistId ?? ''} className="w-full border p-2 rounded">
        <option value="">— Not a bookable stylist —</option>
        {stylists.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {!employee && (
        <input name="pin" inputMode="numeric" pattern="\d{4,6}" placeholder="Clock-in PIN (4–6 digits)" required className="w-full border p-2 rounded" />
      )}
      <button type="submit" disabled={pending} className="bg-accent text-black px-6 py-3 uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-colors disabled:opacity-50">
        {employee ? 'Save changes' : 'Add employee'}
      </button>
    </form>
  );
}
