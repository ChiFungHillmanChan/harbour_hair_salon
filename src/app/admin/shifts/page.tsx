import prisma from '@/app/lib/prisma';
import { createShift, deleteShift } from '@/app/actions/shifts';

async function handleCreateShift(formData: FormData): Promise<void> {
  'use server';
  await createShift(null, formData);
}

export default async function AdminShiftsPage() {
  const [employees, shifts] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.shift.findMany({
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      take: 100,
      include: { employee: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="p-6 space-y-8">
      <h1 className="font-serif text-3xl text-brand">Shifts</h1>

      <section>
        <h2 className="text-xl mb-3">Add shift</h2>
        <form action={handleCreateShift} className="flex flex-wrap gap-3 items-end">
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
            className="bg-accent hover:bg-accent-light text-white px-4 py-2 rounded text-sm font-medium transition-colors"
          >
            Add shift
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-xl mb-3">Upcoming shifts</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Employee</th>
              <th className="p-2">Date</th>
              <th className="p-2">Start</th>
              <th className="p-2">End</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id} className="border-b">
                <td className="p-2">{s.employee.name}</td>
                <td className="p-2">{s.date.toISOString().slice(0, 10)}</td>
                <td className="p-2">{s.startTime}</td>
                <td className="p-2">{s.endTime}</td>
                <td className="p-2">
                  <form
                    action={async () => {
                      'use server';
                      await deleteShift(s.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="text-red-600 hover:text-red-800 text-xs"
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td colSpan={5} className="p-2 text-center text-zinc-500">
                  No shifts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
