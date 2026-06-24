// src/app/services/payroll-service.ts
import 'server-only';
import prisma from '@/app/lib/prisma';
import { fromZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE, salonDateKey } from '@/app/services/salon-time';
import { totalWorkedMinutes, applyBreakDeduction, splitRegularOvertime } from '@/app/services/timesheet-calc';
import { computeGross, round2, sumCommissionable, type PayType } from '@/app/services/payroll-calc';

function monthBounds(year: number, month: number) {
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = fromZonedTime(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  return { start, end };
}

const num = (d: { toString(): string } | null | undefined): number | null =>
  d == null ? null : Number(d.toString());

export async function runPayroll(year: number, month: number) {
  const { start, end } = monthBounds(year, month);

  const period = await prisma.payrollPeriod.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month, status: 'DRAFT' },
  });

  if (period.status === 'FINALIZED') {
    throw new Error(`Payroll period ${year}-${month} is already finalized and cannot be recomputed.`);
  }

  // Include active employees AND anyone with approved in-month hours or an existing
  // line for this period, so leavers (deactivated mid-month) are still paid and their
  // lines are refreshed rather than left stale.
  const approvedEntryEmployees = await prisma.timeEntry.findMany({
    where: { status: 'APPROVED', clockOut: { not: null }, clockIn: { gte: start, lt: end } },
    select: { employeeId: true },
    distinct: ['employeeId'],
  });
  const existingLineEmployees = await prisma.payrollLine.findMany({
    where: { periodId: period.id },
    select: { employeeId: true },
  });
  const includeIds = Array.from(
    new Set([
      ...approvedEntryEmployees.map((e) => e.employeeId),
      ...existingLineEmployees.map((l) => l.employeeId),
    ]),
  );
  const employees = await prisma.employee.findMany({
    where: { OR: [{ isActive: true }, { id: { in: includeIds } }] },
  });

  for (const e of employees) {
    const entries = await prisma.timeEntry.findMany({
      where: { employeeId: e.id, status: 'APPROVED', clockIn: { gte: start, lt: end }, clockOut: { not: null } },
      select: { clockIn: true, clockOut: true, breakMinutes: true },
    });
    const segments = entries
      .filter((x): x is { clockIn: Date; clockOut: Date; breakMinutes: number } => x.clockOut != null)
      .map((x) => ({ clockIn: x.clockIn, clockOut: x.clockOut, breakMinutes: x.breakMinutes }));

    const workedMinutes = totalWorkedMinutes(segments);
    const workedDays = new Set(segments.map((s) => salonDateKey(s.clockIn))).size;
    const paidMinutes = applyBreakDeduction(workedMinutes, workedDays, e.unpaidBreakMinutes ?? 0);
    const totalHours = paidMinutes / 60;
    const { regularHours, overtimeHours } = splitRegularOvertime(totalHours, {
      enabled: e.overtimeEnabled,
      thresholdHours: num(e.overtimeThresholdHours) ?? 0,
    });

    let commissionableRevenue = 0;
    if (e.stylistId) {
      const appts = await prisma.appointment.findMany({
        where: { stylistId: e.stylistId, status: 'COMPLETED', date: { gte: start, lt: end } },
        select: { service: { select: { price: true } } },
      });
      commissionableRevenue = sumCommissionable(appts.map((a) => Number(a.service.price.toString())));
    }

    const gross = computeGross({
      payType: e.payType as PayType,
      hourlyRate: num(e.hourlyRate),
      monthlySalary: num(e.monthlySalary),
      commissionRate: num(e.commissionRate),
      regularHours,
      overtimeHours,
      overtimeMultiplier: num(e.overtimeMultiplier),
      commissionableRevenue,
      adjustments: 0,
    });

    const existing = await prisma.payrollLine.findUnique({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.id } },
    });
    const adjustments = existing ? Number(existing.adjustments.toString()) : 0;
    const adjustmentNote = existing?.adjustmentNote ?? null;
    const grossWithAdj = round2(gross.grossPay + adjustments);

    await prisma.payrollLine.upsert({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.id } },
      update: {
        totalHours, regularHours, overtimeHours,
        basePay: gross.basePay, overtimePay: gross.overtimePay,
        commissionableRevenue, commissionPay: gross.commissionPay,
        adjustments, adjustmentNote, grossPay: grossWithAdj,
      },
      create: {
        periodId: period.id, employeeId: e.id,
        totalHours, regularHours, overtimeHours,
        basePay: gross.basePay, overtimePay: gross.overtimePay,
        commissionableRevenue, commissionPay: gross.commissionPay,
        adjustments: 0, grossPay: gross.grossPay,
      },
    });
  }

  return { periodId: period.id };
}

export async function updateAdjustment(lineId: string, amount: number, note: string) {
  const line = await prisma.payrollLine.findUnique({ where: { id: lineId }, include: { period: true } });
  if (!line || line.period.status !== 'DRAFT') return;
  const baseGross = Number(line.basePay.toString()) + Number(line.overtimePay.toString()) + Number(line.commissionPay.toString());
  await prisma.payrollLine.update({
    where: { id: lineId },
    data: { adjustments: amount, adjustmentNote: note || null, grossPay: round2(baseGross + amount) },
  });
}

export async function finalizePayroll(periodId: string, adminId: string) {
  const lines = await prisma.payrollLine.findMany({ where: { periodId } });
  const lineUpdates = lines.map((l) =>
    prisma.payrollLine.update({
      where: { id: l.id },
      data: {
        snapshotJson: JSON.stringify({
          totalHours: num(l.totalHours),
          regularHours: num(l.regularHours),
          overtimeHours: num(l.overtimeHours),
          basePay: num(l.basePay),
          overtimePay: num(l.overtimePay),
          commissionableRevenue: num(l.commissionableRevenue),
          commissionPay: num(l.commissionPay),
          adjustments: num(l.adjustments),
          adjustmentNote: l.adjustmentNote,
          grossPay: num(l.grossPay),
        }),
      },
    }),
  );
  await prisma.$transaction([
    ...lineUpdates,
    prisma.payrollPeriod.update({
      where: { id: periodId },
      data: { status: 'FINALIZED', finalizedByAdminId: adminId, finalizedAt: new Date() },
    }),
  ]);
}
