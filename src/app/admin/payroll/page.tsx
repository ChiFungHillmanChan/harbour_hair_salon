// src/app/admin/payroll/page.tsx
import prisma from '@/app/lib/prisma';
import { toZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { toPayrollCsv } from '@/app/services/payroll-csv';
import { runPayrollAction, finalizePayrollAction } from '@/app/actions/payroll';

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = toZonedTime(new Date(), SALON_TIMEZONE);
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;

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
    <div className="p-6 space-y-6">
      <h1 className="font-serif text-3xl text-brand">Payroll — {year}-{String(month).padStart(2, '0')}</h1>
      <p className="text-sm text-zinc-500">Gross pay only. Phase 1: commission excluded (added in Phase 2).</p>

      <form action={async () => { 'use server'; await runPayrollAction(year, month); }}>
        <button className="bg-brand text-white px-4 py-2 rounded">Run / recompute from approved timesheets</button>
      </form>

      {period && (
        <>
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
                  <td className="p-2">£{Number(l.adjustments.toString()).toFixed(2)}</td>
                  <td className="p-2 font-bold">£{Number(l.grossPay.toString()).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex gap-4 items-center">
            <a href={csvHref} download={`payroll-${year}-${String(month).padStart(2, '0')}.csv`} className="border border-accent text-brand px-4 py-2 rounded">
              Download CSV
            </a>
            {period.status === 'DRAFT' ? (
              <form action={async () => { 'use server'; await finalizePayrollAction(period.id); }}>
                <button className="bg-accent text-black px-4 py-2 rounded font-bold">Finalize</button>
              </form>
            ) : (
              <span className="text-green-700 font-bold">Finalized</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
