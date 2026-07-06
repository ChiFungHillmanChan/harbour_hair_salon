'use client';

import { useActionState } from 'react';
import { createShift } from '@/app/actions/shifts';

type Employee = { id: string; name: string };

export function ShiftForm({ employees }: { employees: Employee[] }) {
  const [state, action] = useActionState(createShift, undefined);

  return (
    <form action={action} className="flex flex-wrap gap-3 items-end">
      {state?.error && (
        <p className="w-full text-sm text-red-600">{state.error}</p>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="employeeId">Employee</label>
        <select
          id="employeeId"
          name="employeeId"
          required
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">Select employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="date">Date</label>
        <input
          id="date"
          type="date"
          name="date"
          required
          className="border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="startTime">Start</label>
        <input
          id="startTime"
          type="time"
          name="startTime"
          required
          className="border rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="endTime">End</label>
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
        className="bg-zinc-900 hover:bg-black text-white px-4 py-2 rounded text-sm font-medium transition-colors"
      >
        Add shift
      </button>
    </form>
  );
}
