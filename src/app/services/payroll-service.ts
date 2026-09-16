import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE, salonDateKey } from '@/app/services/salon-time';
import { totalWorkedMinutes, applyBreakDeduction, splitRegularOvertime } from '@/app/services/timesheet-calc';
import { computeGross, round2, sumCommissionable, type PayType } from '@/app/services/payroll-calc';

export function monthBounds(year: number, month: number) {
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = fromZonedTime(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  return { start, end };
}

const num = (d: { toString(): string } | null | undefined): number | null =>
  d == null ? null : Number(d.toString());

export type PayrollDb = Pick<PrismaClient, '$transaction'>;
export type PayrollMutationResult = { error?: string; success?: boolean };

/** All payroll mutations lock the same period row before reading/writing figures. */
async function payrollTransaction<T>(db: PayrollDb, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, { isolationLevel: 'Serializable', timeout: 30_000 });
    } catch (error) {
      // P2002 can occur when two first runs try to create the same monthly period.
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
      throw error;
    }
  }
}

const employeePaySelect = {
  id: true, payType: true, hourlyRate: true, monthlySalary: true, commissionRate: true,
  overtimeEnabled: true, overtimeThresholdHours: true, overtimeMultiplier: true,
  unpaidBreakMinutes: true, stylistId: true,
} satisfies Prisma.EmployeeSelect;

export async function runPayrollWith(db: PayrollDb, year: number, month: number, actorUserId?: string) {
  return payrollTransaction(db, async (tx) => {
    const { start, end } = monthBounds(year, month);
    // A real update takes a row lock even when the period already exists. Every
    // adjustment, finalize and reopen takes this same lock in its transaction.
    const period = await tx.payrollPeriod.upsert({
      where: { year_month: { year, month } },
      update: { updatedAt: new Date() },
      create: { year, month, status: 'DRAFT' },
      select: { id: true, status: true },
    });
    if (period.status === 'FINALIZED') throw new Error(`Payroll period ${year}-${month} is already finalized and cannot be recomputed.`);

    const [entries, existingLines] = await Promise.all([
      tx.timeEntry.findMany({
        where: { status: 'APPROVED', clockOut: { not: null }, clockIn: { gte: start, lt: end } },
        select: { employeeId: true, clockIn: true, clockOut: true, breakMinutes: true },
      }),
      tx.payrollLine.findMany({
        where: { periodId: period.id },
        select: { employeeId: true, adjustments: true, adjustmentNote: true },
      }),
    ]);
    // Leavers with approved hours or an existing line remain included.
    const includeIds = [...new Set([...entries.map((e) => e.employeeId), ...existingLines.map((l) => l.employeeId)])];
    const employees = await tx.employee.findMany({
      where: { OR: [{ isActive: true }, { id: { in: includeIds } }] },
      select: employeePaySelect,
    });
    const stylistIds = employees.flatMap((e) => e.stylistId ? [e.stylistId] : []);
    const appointments = stylistIds.length ? await tx.appointment.findMany({
      where: { stylistId: { in: stylistIds }, status: 'COMPLETED', date: { gte: start, lt: end } },
      select: { stylistId: true, priceAtBooking: true, service: { select: { price: true } } },
    }) : [];
    const entriesByEmployee = new Map<string, typeof entries>();
    for (const entry of entries) {
      const bucket = entriesByEmployee.get(entry.employeeId) ?? [];
      bucket.push(entry);
      entriesByEmployee.set(entry.employeeId, bucket);
    }
    const pricesByStylist = new Map<string, number[]>();
    for (const appointment of appointments) {
      const prices = pricesByStylist.get(appointment.stylistId) ?? [];
      prices.push(Number(appointment.priceAtBooking ?? appointment.service.price));
      pricesByStylist.set(appointment.stylistId, prices);
    }
    const linesByEmployee = new Map(existingLines.map((line) => [line.employeeId, line]));

    for (const employee of employees) {
      const segments = (entriesByEmployee.get(employee.id) ?? [])
        .flatMap((entry) => entry.clockOut ? [{ clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes }] : []);
      const workedMinutes = totalWorkedMinutes(segments);
      const workedDays = new Set(segments.map((s) => salonDateKey(s.clockIn))).size;
      const totalHours = applyBreakDeduction(workedMinutes, workedDays, employee.unpaidBreakMinutes ?? 0) / 60;
      const threshold = num(employee.overtimeThresholdHours);
      const { regularHours, overtimeHours } = splitRegularOvertime(totalHours, {
        enabled: employee.overtimeEnabled && threshold != null && threshold > 0,
        thresholdHours: threshold ?? 0,
      });
      const commissionableRevenue = sumCommissionable(pricesByStylist.get(employee.stylistId ?? '') ?? []);
      const existing = linesByEmployee.get(employee.id);
      const adjustments = Number(existing?.adjustments ?? 0);
      const gross = computeGross({
        payType: employee.payType as PayType,
        hourlyRate: num(employee.hourlyRate), monthlySalary: num(employee.monthlySalary),
        commissionRate: num(employee.commissionRate), regularHours, overtimeHours,
        overtimeMultiplier: num(employee.overtimeMultiplier), commissionableRevenue, adjustments: 0,
      });
      const figures = {
        totalHours, regularHours, overtimeHours, basePay: gross.basePay,
        overtimePay: gross.overtimePay, commissionableRevenue, commissionPay: gross.commissionPay,
        adjustments, adjustmentNote: existing?.adjustmentNote ?? null, grossPay: round2(gross.grossPay + adjustments),
      } satisfies Prisma.PayrollLineUpdateInput;
      await tx.payrollLine.upsert({
        where: { periodId_employeeId: { periodId: period.id, employeeId: employee.id } },
        update: figures,
        create: { periodId: period.id, employeeId: employee.id, ...figures },
        select: { id: true },
      });
    }
    await tx.auditEvent.create({ data: {
      actorUserId, action: 'PAYROLL_RUN', targetType: 'PayrollPeriod', targetId: period.id,
      metadataJson: JSON.stringify({ year, month, employeeCount: employees.length }),
    } });
    return { periodId: period.id };
  });
}

export async function runPayroll(year: number, month: number, actorUserId?: string) {
  const { default: prisma } = await import('@/app/lib/prisma');
  return runPayrollWith(prisma, year, month, actorUserId);
}

export async function updateAdjustment(lineId: string, amount: number, note: string, actorUserId?: string): Promise<PayrollMutationResult> {
  const { default: prisma } = await import('@/app/lib/prisma');
  return payrollTransaction(prisma, async (tx) => {
    const reference = await tx.payrollLine.findUnique({ where: { id: lineId }, select: { periodId: true } });
    if (!reference) return { error: 'That payroll line no longer exists.' };
    const claim = await tx.payrollPeriod.updateMany({
      where: { id: reference.periodId, status: 'DRAFT' }, data: { updatedAt: new Date() },
    });
    if (!claim.count) return { error: 'This payroll month is finalized. Reopen it before changing adjustments.' };
    const line = await tx.payrollLine.findUnique({
      where: { id: lineId }, select: { basePay: true, overtimePay: true, commissionPay: true },
    });
    if (!line) return { error: 'That payroll line no longer exists.' };
    const baseGross = Number(line.basePay) + Number(line.overtimePay) + Number(line.commissionPay);
    await tx.payrollLine.update({
      where: { id: lineId },
      data: { adjustments: amount, adjustmentNote: note || null, grossPay: round2(baseGross + amount) },
    });
    await tx.auditEvent.create({ data: {
      actorUserId, action: 'PAYROLL_ADJUST', targetType: 'PayrollPeriod', targetId: reference.periodId,
      metadataJson: JSON.stringify({ lineId }),
    } });
    return { success: true };
  });
}

export async function finalizePayroll(periodId: string, adminId: string): Promise<PayrollMutationResult> {
  const { default: prisma } = await import('@/app/lib/prisma');
  return payrollTransaction(prisma, async (tx) => {
    const claim = await tx.payrollPeriod.updateMany({
      where: { id: periodId, status: 'DRAFT' },
      data: { status: 'FINALIZED', finalizedByAdminId: adminId, finalizedAt: new Date() },
    });
    if (!claim.count) return { error: 'That payroll month is not a draft — it may already be finalized.' };
    const lines = await tx.payrollLine.findMany({ where: { periodId } });
    for (const line of lines) {
      await tx.payrollLine.update({ where: { id: line.id }, data: { snapshotJson: JSON.stringify({
        totalHours: num(line.totalHours), regularHours: num(line.regularHours), overtimeHours: num(line.overtimeHours),
        basePay: num(line.basePay), overtimePay: num(line.overtimePay), commissionableRevenue: num(line.commissionableRevenue),
        commissionPay: num(line.commissionPay), adjustments: num(line.adjustments), adjustmentNote: line.adjustmentNote,
        grossPay: num(line.grossPay),
      }) } });
    }
    await tx.auditEvent.create({ data: {
      actorUserId: adminId, action: 'PAYROLL_FINALIZE', targetType: 'PayrollPeriod', targetId: periodId,
      metadataJson: JSON.stringify({ lineCount: lines.length }),
    } });
    return { success: true };
  });
}

export async function reopenPayroll(periodId: string, actorUserId?: string): Promise<PayrollMutationResult> {
  const { default: prisma } = await import('@/app/lib/prisma');
  return payrollTransaction(prisma, async (tx) => {
    const claim = await tx.payrollPeriod.updateMany({
      where: { id: periodId, status: 'FINALIZED' },
      data: { status: 'DRAFT', finalizedByAdminId: null, finalizedAt: null },
    });
    if (!claim.count) return { error: 'That payroll month is not finalized, so there is nothing to reopen.' };
    await tx.payrollLine.updateMany({ where: { periodId }, data: { snapshotJson: '' } });
    await tx.auditEvent.create({ data: {
      actorUserId, action: 'PAYROLL_REOPEN', targetType: 'PayrollPeriod', targetId: periodId,
    } });
    return { success: true };
  });
}
