import prisma from '@/app/lib/prisma';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { segmentWorkedMinutes } from '@/app/services/timesheet-calc';
import { approveTimeEntry, approveMonth } from '@/app/actions/timesheets';

function monthBounds(year: number, month: number) {
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = fromZonedTime(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  return { start, end };
}

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = toZonedTime(new Date(), SALON_TIMEZONE);
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const entries = await prisma.timeEntry.findMany({
    where: { clockIn: { gte: start, lt: end } },
    orderBy: [{ employeeId: 'asc' }, { clockIn: 'asc' }],
    include: { employee: { select: { name: true } } },
  });

  const fmt = (d: Date) => format(toZonedTime(d, SALON_TIMEZONE), 'dd MMM HH:mm');

  return (
    <div className="p-6 space-y-6">
      <h1 className="font-serif text-3xl text-brand">Timesheets — {year}-{String(month).padStart(2, '0')}</h1>

      <form action={async () => { 'use server'; await approveMonth(year, month); }}>
        <button className="bg-brand text-white px-4 py-2 rounded">Approve all (closed) for this month</button>
      </form>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">Employee</th><th className="p-2">Clock in</th><th className="p-2">Clock out</th>
            <th className="p-2">Hours</th><th className="p-2">Status</th><th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const hours = e.clockOut ? (segmentWorkedMinutes({ clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: e.breakMinutes }) / 60).toFixed(2) : '—';
            return (
              <tr key={e.id} className="border-b">
                <td className="p-2">{e.employee.name}</td>
                <td className="p-2">{fmt(e.clockIn)}</td>
                <td className="p-2">{e.clockOut ? fmt(e.clockOut) : <span className="text-amber-600">OPEN</span>}</td>
                <td className="p-2">{hours}</td>
                <td className="p-2">{e.status}</td>
                <td className="p-2">
                  {e.clockOut && e.status !== 'APPROVED' && (
                    <form action={async () => { 'use server'; await approveTimeEntry(e.id); }}>
                      <button className="text-brand underline">Approve</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
          {entries.length === 0 && <tr><td className="p-2" colSpan={6}>No entries this month.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
