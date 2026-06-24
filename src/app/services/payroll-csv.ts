export type PayrollCsvRow = {
  employeeName: string;
  payType: string;
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  commissionPay: number;
  adjustments: number;
  grossPay: number;
};

const HEADER = [
  'Employee', 'Pay Type', 'Total Hours', 'Regular Hours', 'Overtime Hours',
  'Base Pay', 'Overtime Pay', 'Commission', 'Adjustments', 'Gross Pay',
];

function cell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toPayrollCsv(rows: PayrollCsvRow[]): string {
  const lines = [HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        cell(r.employeeName), cell(r.payType), cell(r.totalHours), cell(r.regularHours),
        cell(r.overtimeHours), cell(r.basePay), cell(r.overtimePay), cell(r.commissionPay),
        cell(r.adjustments), cell(r.grossPay),
      ].join(','),
    );
  }
  return lines.join('\n');
}
