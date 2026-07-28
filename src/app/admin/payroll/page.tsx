// src/app/admin/payroll/page.tsx
import prisma from '@/app/lib/prisma';
import { toZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { toPayrollCsv } from '@/app/services/payroll-csv';
import { finalizePayrollAction, reopenPayrollAction } from '@/app/actions/payroll';
import PayrollAdjustmentForm from '@/components/admin/PayrollAdjustmentForm';
import { PayrollRunButton } from '@/components/admin/PayrollRunButton';
import { RowActionButton } from '@/components/admin/RowActionButton';
import { MonthSelector, shiftMonth } from '@/components/admin/MonthSelector';

function inRange(value: number, min: number, max: number): number | null {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = toZonedTime(new Date(), SALON_TIMEZONE);
  // Payroll is run for a month that has finished, so default to the previous
  // one — on the 1st the owner wants last month, not the empty month just begun.
  const previous = shiftMonth(now.getFullYear(), now.getMonth() + 1, -1);
  const year = inRange(Number(sp.year), 2020, 2100) ?? previous.year;
  const month = inRange(Number(sp.month), 1, 12) ?? previous.month;

  const period = await prisma.payrollPeriod.findUnique({
    where: { year_month: { year, month } },
    include: { lines: { include: { employee: { select: { name: true, payType: true } } }, orderBy: { employee: { name: 'asc' } } } },
  });

  const csvRows = (period?.lines ?? []).map((l) => ({
    employeeName: l.employee.name,
    payType: l.employee.payType,
    totalHours: Number(l.totalHours.toString()),
    regularHours: Number(l.regularHours.toString()),
    overtimeHours: Number(l.overtimeHours.toString()),
    basePay: Number(l.basePay.toString()),
    overtimePay: Number(l.overtimePay.toString()),
    commissionPay: Number(l.commissionPay.toString()),
    adjustments: Number(l.adjustments.toString()),
    grossPay: Number(l.grossPay.toString()),
  }));
  const csv = toPayrollCsv(csvRows);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <h1 className="font-serif text-2xl sm:text-3xl text-zinc-900">Payroll — {year}-{String(month).padStart(2, '0')}</h1>
      <p className="text-sm text-zinc-500">Gross pay only. Phase 1: commission excluded (added in Phase 2).</p>

      <MonthSelector basePath="/admin/payroll" year={year} month={month} />

      {period?.status !== 'FINALIZED' && <PayrollRunButton year={year} month={month} />}

      {period && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Employee</th><th className="p-2">Hours</th><th className="p-2">Base</th>
                  <th className="p-2">Overtime</th><th className="p-2">Commission</th><th className="p-2">Adjustments</th><th className="p-2">Gross</th>
                </tr>
              </thead>
              <tbody>
                {period.lines.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="p-2">{l.employee.name}</td>
                    <td className="p-2">{Number(l.totalHours.toString()).toFixed(2)}</td>
                    <td className="p-2">£{Number(l.basePay.toString()).toFixed(2)}</td>
                    <td className="p-2">£{Number(l.overtimePay.toString()).toFixed(2)}</td>
                    <td className="p-2">£{Number(l.commissionPay.toString()).toFixed(2)}</td>
                    <td className="p-2">
                      {period.status === 'DRAFT' ? (
                        <PayrollAdjustmentForm lineId={l.id} amount={Number(l.adjustments.toString())} note={l.adjustmentNote ?? ''} />
                      ) : (
                        <span>£{Number(l.adjustments.toString()).toFixed(2)}</span>
                      )}
                    </td>
                    <td className="p-2 font-bold">£{Number(l.grossPay.toString()).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-4 items-center">
            <a href={csvHref} download={`payroll-${year}-${String(month).padStart(2, '0')}.csv`} className="border border-zinc-300 text-zinc-900 px-4 py-2 rounded">
              Download CSV
            </a>
            {period.status === 'DRAFT' ? (
              <RowActionButton
                action={finalizePayrollAction.bind(null, period.id)}
                label="Finalize"
                pendingLabel="Finalizing…"
                buttonClassName="bg-zinc-900 hover:bg-black text-white px-4 py-2 rounded font-bold transition-colors"
                confirmMessage="Finalize payroll for this month? The figures are locked and snapshotted — changing anything afterwards means reopening the month."
              />
            ) : (
              <>
                <span className="text-zinc-900 font-bold">Finalized</span>
                <RowActionButton
                  action={reopenPayrollAction.bind(null, period.id)}
                  label="Reopen"
                  pendingLabel="Reopening…"
                  buttonClassName="border border-zinc-300 text-zinc-700 hover:bg-zinc-50 px-4 py-2 rounded"
                  confirmMessage="Reopen this month back to draft? The finalized figures stop being locked and can be recomputed."
                />
              </>
            )}
          </div>
        </>
      )}

      {!period && (
        <p className="text-sm text-zinc-500">
          No payroll has been run for this month yet. Run it above once the month&apos;s timesheets are approved.
        </p>
      )}
    </div>
  );
}
