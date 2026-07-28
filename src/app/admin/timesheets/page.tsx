import prisma from '@/app/lib/prisma';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { SALON_TIMEZONE, salonDateKey, salonMinutesOfDay } from '@/app/services/salon-time';
import { segmentWorkedMinutes } from '@/app/services/timesheet-calc';
import { approveTimeEntry, unapproveTimeEntry, deleteTimeEntry } from '@/app/actions/timesheets';
import { evaluateShift, type ShiftEvaluation } from '@/app/services/shift-flags';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { TimeEntryEditForm } from '@/components/admin/TimeEntryEditForm';
import { ApproveMonthButton } from '@/components/admin/ApproveMonthButton';
import { MonthSelector } from '@/components/admin/MonthSelector';

const GRACE_MIN = 5;

/** TimeEntry.status is a raw code in the database; the owner sees plain English. */
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Still clocked in',
  PENDING: 'Needs approval',
  EDITED: 'Edited — needs approval',
  APPROVED: 'Approved',
};

function monthBounds(year: number, month: number) {
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = fromZonedTime(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  return { start, end };
}

function parseShiftMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function inRange(value: number, min: number, max: number): number | null {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = toZonedTime(new Date(), SALON_TIMEZONE);
  // Timesheets default to the month in progress; out-of-range params fall back
  // rather than building nonsense month bounds.
  const year = inRange(Number(sp.year), 2020, 2100) ?? now.getFullYear();
  const month = inRange(Number(sp.month), 1, 12) ?? now.getMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const [entries, shifts] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { clockIn: { gte: start, lt: end } },
      orderBy: [{ employeeId: 'asc' }, { clockIn: 'asc' }],
      include: { employee: { select: { name: true } } },
    }),
    prisma.shift.findMany({
      where: { date: { gte: start, lt: end } },
      select: { employeeId: true, date: true, startTime: true, endTime: true },
    }),
  ]);

  // Build shift evaluation map keyed by `${employeeId}|${salonDateKey}`
  const shiftMap = new Map<string, ShiftEvaluation>();
  for (const shift of shifts) {
    const dayKey = salonDateKey(shift.date);
    const mapKey = `${shift.employeeId}|${dayKey}`;
    const dayEntries = entries.filter(
      (e) => e.employeeId === shift.employeeId && salonDateKey(e.clockIn) === dayKey && e.clockOut !== null,
    );
    if (dayEntries.length === 0) continue;

    const firstInMin = Math.min(...dayEntries.map((e) => salonMinutesOfDay(e.clockIn)));
    const lastOutMin = Math.max(...dayEntries.map((e) => salonMinutesOfDay(e.clockOut!)));

    shiftMap.set(
      mapKey,
      evaluateShift({
        shiftStartMin: parseShiftMin(shift.startTime),
        shiftEndMin: parseShiftMin(shift.endTime),
        firstInMin,
        lastOutMin,
        graceMin: GRACE_MIN,
      }),
    );
  }

  const fmt = (d: Date) => format(toZonedTime(d, SALON_TIMEZONE), 'dd MMM HH:mm');
  const dateInput = (d: Date) => format(toZonedTime(d, SALON_TIMEZONE), 'yyyy-MM-dd');
  const timeInput = (d: Date) => format(toZonedTime(d, SALON_TIMEZONE), 'HH:mm');

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <h1 className="font-serif text-2xl sm:text-3xl text-zinc-900">Timesheets — {year}-{String(month).padStart(2, '0')}</h1>

      <MonthSelector basePath="/admin/timesheets" year={year} month={month} />

      <ApproveMonthButton year={year} month={month} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2 whitespace-nowrap">Employee</th><th className="p-2 whitespace-nowrap">Clock in</th><th className="p-2 whitespace-nowrap">Clock out</th>
              <th className="p-2 whitespace-nowrap">Hours</th><th className="p-2 whitespace-nowrap">Status</th><th className="p-2 whitespace-nowrap">Shift</th><th className="p-2 whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const hours = e.clockOut ? (segmentWorkedMinutes({ clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: e.breakMinutes }) / 60).toFixed(2) : '—';
              const evalKey = `${e.employeeId}|${salonDateKey(e.clockIn)}`;
              const ev = shiftMap.get(evalKey);
              return (
                <tr key={e.id} className="border-b">
                  <td className="p-2 align-top">{e.employee.name}</td>
                  <td className="p-2 align-top whitespace-nowrap">{fmt(e.clockIn)}</td>
                  <td className="p-2 align-top whitespace-nowrap">{e.clockOut ? fmt(e.clockOut) : <span className="text-zinc-900">OPEN</span>}</td>
                  <td className="p-2 align-top whitespace-nowrap">{hours}</td>
                  <td className="p-2 align-top whitespace-nowrap">{STATUS_LABELS[e.status] ?? e.status}</td>
                  <td className="p-2 align-top space-x-1 whitespace-nowrap">
                    {ev?.late && (
                      <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700">
                        Late {ev.lateByMin}m
                      </span>
                    )}
                    {ev?.earlyLeave && (
                      <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700">
                        Left early {ev.earlyByMin}m
                      </span>
                    )}
                  </td>
                  <td className="p-2 align-top">
                    <div className="flex flex-col items-start gap-1">
                      {e.clockOut && e.status !== 'APPROVED' && (
                        <RowActionButton
                          action={approveTimeEntry.bind(null, e.id)}
                          label="Approve"
                          pendingLabel="Approving…"
                          buttonClassName="text-sm text-zinc-900 underline"
                        />
                      )}
                      {e.status === 'APPROVED' && (
                        <RowActionButton
                          action={unapproveTimeEntry.bind(null, e.id)}
                          label="Un-approve"
                          pendingLabel="Un-approving…"
                          buttonClassName="text-sm text-zinc-700 hover:text-zinc-900 underline"
                        />
                      )}
                      <details>
                        <summary className="cursor-pointer text-sm text-zinc-700 hover:text-zinc-900 underline">Edit</summary>
                        <TimeEntryEditForm
                          entryId={e.id}
                          date={dateInput(e.clockIn)}
                          clockInTime={timeInput(e.clockIn)}
                          clockOutTime={e.clockOut ? timeInput(e.clockOut) : ''}
                          breakMinutes={e.breakMinutes}
                          note={e.note ?? ''}
                        />
                      </details>
                      <RowActionButton
                        action={deleteTimeEntry.bind(null, e.id)}
                        label="Delete"
                        pendingLabel="Deleting…"
                        buttonClassName="text-sm text-red-600 hover:text-red-800"
                        confirmMessage="Delete this time entry? This cannot be undone."
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && <tr><td className="p-2" colSpan={7}>No entries this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
