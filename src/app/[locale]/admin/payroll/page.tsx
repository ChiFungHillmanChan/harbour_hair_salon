import { requireAdmin } from '@/app/lib/session';
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
import { formatMonth } from '@/i18n/dates';
import { getLocale, getT } from '@/i18n/server';
import { HTML_LANG } from '@/i18n/config';
import { formatGBP, toPence } from '@/app/services/pricing/money';

function inRange(value: number, min: number, max: number): number | null {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  await requireAdmin();
  const [sp, locale, t] = await Promise.all([searchParams, getLocale(), getT('adminStaff')]);
  // Same two-decimal figure as before (toFixed never yields exponent notation), now formatted per language.
  const money = (value: { toString(): string }) => formatGBP(toPence(Number(value.toString()).toFixed(2)), HTML_LANG[locale]);
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
  // The CSV itself never changes with the interface language (fixed English
  // headings and plain numbers), so existing spreadsheets keep reading it.
  const csv = toPayrollCsv(csvRows);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <h1 className="font-serif text-2xl sm:text-3xl text-zinc-900">{t('payroll.title', { period: formatMonth(locale, year, month) })}</h1>
      <p className="text-sm text-zinc-500">{t('payroll.intro')}</p>

      <MonthSelector basePath="/admin/payroll" year={year} month={month} />

      {period?.status !== 'FINALIZED' && <PayrollRunButton year={year} month={month} />}

      {period && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">{t('payroll.columns.employee')}</th><th className="p-2">{t('payroll.columns.hours')}</th><th className="p-2">{t('payroll.columns.base')}</th>
                  <th className="p-2">{t('payroll.columns.overtime')}</th><th className="p-2">{t('payroll.columns.commission')}</th><th className="p-2">{t('payroll.columns.adjustments')}</th><th className="p-2">{t('payroll.columns.gross')}</th>
                </tr>
              </thead>
              <tbody>
                {period.lines.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="p-2">{l.employee.name}</td>
                    <td className="p-2">{Number(l.totalHours.toString()).toFixed(2)}</td>
                    <td className="p-2">{money(l.basePay)}</td>
                    <td className="p-2">{money(l.overtimePay)}</td>
                    <td className="p-2">{money(l.commissionPay)}</td>
                    <td className="p-2">
                      {period.status === 'DRAFT' ? (
                        <PayrollAdjustmentForm lineId={l.id} amount={Number(l.adjustments.toString())} note={l.adjustmentNote ?? ''} />
                      ) : (
                        <span>{money(l.adjustments)}</span>
                      )}
                    </td>
                    <td className="p-2 font-bold">{money(l.grossPay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <a href={csvHref} download={`payroll-${year}-${String(month).padStart(2, '0')}.csv`} aria-describedby="payroll-csv-help" className="border border-zinc-300 text-zinc-900 px-4 py-2 rounded">
              {t('payroll.csv.download')}
            </a>
            {period.status === 'DRAFT' ? (
              <RowActionButton
                action={finalizePayrollAction.bind(null, period.id)}
                label={t('payroll.finalize')}
                pendingLabel={t('payroll.finalizing')}
                buttonClassName="bg-zinc-900 hover:bg-black text-white px-4 py-2 rounded font-bold transition-colors"
                confirmMessage={t('payroll.finalizeConfirm')}
              />
            ) : (
              <>
                <span className="text-zinc-900 font-bold">{t('payroll.finalized')}</span>
                <RowActionButton
                  action={reopenPayrollAction.bind(null, period.id)}
                  label={t('payroll.reopen')}
                  pendingLabel={t('payroll.reopening')}
                  buttonClassName="border border-zinc-300 text-zinc-700 hover:bg-zinc-50 px-4 py-2 rounded"
                  confirmMessage={t('payroll.reopenConfirm')}
                />
              </>
            )}
          </div>
          <p id="payroll-csv-help" className="text-xs text-zinc-500 max-w-prose">{t('payroll.csv.help')}</p>
        </>
      )}

      {!period && (
        <p className="text-sm text-zinc-500">{t('payroll.empty')}</p>
      )}
    </div>
  );
}
