import { requireAdmin } from '@/app/lib/session';
import prisma from '@/app/lib/prisma';
import { deleteShift } from '@/app/actions/shifts';
import { ShiftForm } from '@/components/admin/ShiftForm';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { salonDateKey } from '@/app/services/salon-time';

import { pageNumber } from '@/app/lib/pagination';
import { Pagination } from '@/components/admin/Pagination';

export const dynamic = 'force-dynamic';

export default async function AdminShiftsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const page = pageNumber((await searchParams).page);
  // createShift stores a shift at UTC midnight of its salon calendar date, so
  // today's floor is that same midnight for the salon's current date. Without
  // this filter the "Upcoming shifts" table was the OLDEST 100 rows ever
  // created, and newly added shifts stopped appearing once the salon passed
  // 100 historic shifts.
  const todayStart = new Date(`${salonDateKey(new Date())}T00:00:00.000Z`);

  const [employees, rows] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.shift.findMany({
      where: { date: { gte: todayStart } },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      take: 26, skip: (page - 1) * 25,
      select: { id: true, date: true, startTime: true, endTime: true, employee: { select: { name: true } } },
    }),
  ]);
  const shifts = rows.slice(0, 25);

  return (
    <div className="p-4 sm:p-6 space-y-8">
      <h1 className="font-serif text-2xl sm:text-3xl text-zinc-900">Shifts</h1>

      <section>
        <h2 className="text-xl mb-3">Add shift</h2>
        <ShiftForm employees={employees} />
      </section>

      <section>
        <h2 className="text-xl mb-3">Upcoming shifts</h2>
        <div className="overflow-x-auto">
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
              {shifts.map((s) => {
                const dateStr = s.date.toISOString().slice(0, 10);

                return (
                  <tr key={s.id} className="border-b">
                    <td className="p-2">{s.employee.name}</td>
                    <td className="p-2">{dateStr}</td>
                    <td className="p-2">{s.startTime}</td>
                    <td className="p-2">{s.endTime}</td>
                    <td className="p-2">
                      <RowActionButton
                        action={deleteShift.bind(null, s.id)}
                        label="Delete"
                        pendingLabel="Deleting…"
                        buttonClassName="text-red-600 hover:text-red-800 text-xs font-medium"
                        confirmMessage={`Delete ${s.employee.name}'s shift on ${dateStr} (${s.startTime}–${s.endTime})?`}
                      />
                    </td>
                  </tr>
                );
              })}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-2 text-center text-zinc-500">
                    No upcoming shifts.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination path="/admin/shifts" page={page} hasMore={rows.length > 25} />
      </section>
    </div>
  );
}
