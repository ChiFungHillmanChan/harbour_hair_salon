// src/app/services/payroll-service.ts
import 'server-only';
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

/** A value shaped like a Prisma `Decimal` (or a plain number, which also has `toString`). */
type DecimalLike = { toString(): string };

type EmployeeRow = {
  id: string;
  payType: string;
  hourlyRate: DecimalLike | null;
  monthlySalary: DecimalLike | null;
  commissionRate: DecimalLike | null;
  overtimeEnabled: boolean;
  overtimeThresholdHours: DecimalLike | null;
  overtimeMultiplier: DecimalLike | null;
  unpaidBreakMinutes: number | null;
  stylistId: string | null;
};

type PayrollLineWriteFields = {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  commissionableRevenue: number;
  commissionPay: number;
  adjustments: number;
  adjustmentNote?: string | null;
  grossPay: number;
};

/**
 * The exact subset of the Prisma client `runPayrollWith` calls. Narrower than
 * `PrismaClient` so a test fake only needs to implement the calls actually
 * made — no full-client mock required — while still letting a fake assert the
 * where-clauses each call is made with.
 */
export type PayrollDb = {
  payrollPeriod: {
    upsert(args: {
      where: { year_month: { year: number; month: number } };
      update: Record<string, never>;
      create: { year: number; month: number; status: string };
    }): Promise<{ id: string; status: string }>;
  };
  timeEntry: {
    findMany(args: {
      where: { status: string; clockOut: { not: null }; clockIn: { gte: Date; lt: Date } };
      select: { employeeId: true };
      distinct: ['employeeId'];
    }): Promise<{ employeeId: string }[]>;
    findMany(args: {
      where: { employeeId: string; status: string; clockIn: { gte: Date; lt: Date }; clockOut: { not: null } };
      select: { clockIn: true; clockOut: true; breakMinutes: true };
    }): Promise<{ clockIn: Date; clockOut: Date | null; breakMinutes: number }[]>;
  };
  payrollLine: {
    findMany(args: { where: { periodId: string }; select: { employeeId: true } }): Promise<{ employeeId: string }[]>;
    findUnique(args: {
      where: { periodId_employeeId: { periodId: string; employeeId: string } };
    }): Promise<{ adjustments: DecimalLike; adjustmentNote: string | null } | null>;
    upsert(args: {
      where: { periodId_employeeId: { periodId: string; employeeId: string } };
      update: PayrollLineWriteFields;
      create: PayrollLineWriteFields & { periodId: string; employeeId: string };
    }): Promise<unknown>;
  };
  appointment: {
    findMany(args: {
      where: { stylistId: string; status: string; date: { gte: Date; lt: Date } };
      select: { priceAtBooking: true; service: { select: { price: true } } };
    }): Promise<{ priceAtBooking: DecimalLike | null; service: { price: DecimalLike } }[]>;
  };
  employee: {
    findMany(args: {
      where: { OR: [{ isActive: boolean }, { id: { in: string[] } }] };
    }): Promise<EmployeeRow[]>;
  };
};

export async function runPayrollWith(db: PayrollDb, year: number, month: number) {
  const { start, end } = monthBounds(year, month);

  const period = await db.payrollPeriod.upsert({
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
  const approvedEntryEmployees = await db.timeEntry.findMany({
    where: { status: 'APPROVED', clockOut: { not: null }, clockIn: { gte: start, lt: end } },
    select: { employeeId: true },
    distinct: ['employeeId'],
  });
  const existingLineEmployees = await db.payrollLine.findMany({
    where: { periodId: period.id },
    select: { employeeId: true },
  });
  const includeIds = Array.from(
    new Set([
      ...approvedEntryEmployees.map((e) => e.employeeId),
      ...existingLineEmployees.map((l) => l.employeeId),
    ]),
  );
  const employees = await db.employee.findMany({
    where: { OR: [{ isActive: true }, { id: { in: includeIds } }] },
  });

  for (const e of employees) {
    const entries = await db.timeEntry.findMany({
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
    const otThreshold = num(e.overtimeThresholdHours);
    const { regularHours, overtimeHours } = splitRegularOvertime(totalHours, {
      // Overtime only applies when a positive threshold is configured; a null/0
      // threshold must NOT reclassify every hour as overtime.
      enabled: e.overtimeEnabled && otThreshold != null && otThreshold > 0,
      thresholdHours: otThreshold ?? 0,
    });

    let commissionableRevenue = 0;
    if (e.stylistId) {
      const appts = await db.appointment.findMany({
        where: { stylistId: e.stylistId, status: 'COMPLETED', date: { gte: start, lt: end } },
        select: { priceAtBooking: true, service: { select: { price: true } } },
      });
      commissionableRevenue = sumCommissionable(
        appts.map((a) => Number((a.priceAtBooking ?? a.service.price).toString())),
      );
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

    const existing = await db.payrollLine.findUnique({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.id } },
    });
    const adjustments = existing ? Number(existing.adjustments.toString()) : 0;
    const adjustmentNote = existing?.adjustmentNote ?? null;
    const grossWithAdj = round2(gross.grossPay + adjustments);

    await db.payrollLine.upsert({
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

export async function runPayroll(year: number, month: number) {
  // Lazy-load the real Prisma client only when no db is injected, so unit tests
  // (which pass a fake db) never trigger prisma.ts's eager DB-URL resolution.
  const { default: prisma } = await import('@/app/lib/prisma');
  // PrismaClient's generated method signatures are structurally incompatible
  // with the narrow, hand-written PayrollDb (Prisma's `select`/`omit` exclusivity
  // typing rejects a plain object literal type). PayrollDb is a true subset of
  // what PrismaClient exposes at runtime, so this cast is safe.
  return runPayrollWith(prisma as unknown as PayrollDb, year, month);
}

export type PayrollMutationResult = { error?: string; success?: boolean };

export async function updateAdjustment(lineId: string, amount: number, note: string): Promise<PayrollMutationResult> {
  const { default: prisma } = await import('@/app/lib/prisma');
  const line = await prisma.payrollLine.findUnique({ where: { id: lineId }, include: { period: true } });
  if (!line) return { error: 'That payroll line no longer exists.' };
  if (line.period.status !== 'DRAFT') {
    return { error: 'This payroll month is finalized. Reopen it before changing adjustments.' };
  }
  const baseGross = Number(line.basePay.toString()) + Number(line.overtimePay.toString()) + Number(line.commissionPay.toString());
  await prisma.payrollLine.update({
    where: { id: lineId },
    data: { adjustments: amount, adjustmentNote: note || null, grossPay: round2(baseGross + amount) },
  });
  return { success: true };
}

export async function finalizePayroll(periodId: string, adminId: string): Promise<PayrollMutationResult> {
  const { default: prisma } = await import('@/app/lib/prisma');
  // Atomically claim the period: only a DRAFT can be finalized, and only once.
  // Prevents a double-click (or a re-finalize) from re-snapshotting and
  // overwriting finalizedAt / finalizedByAdminId on an already-final period.
  const claim = await prisma.payrollPeriod.updateMany({
    where: { id: periodId, status: 'DRAFT' },
    data: { status: 'FINALIZED', finalizedByAdminId: adminId, finalizedAt: new Date() },
  });
  if (claim.count === 0) return { error: 'That payroll month is not a draft — it may already be finalized.' };

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
  // Status was already flipped atomically above; here we only snapshot the lines.
  await prisma.$transaction(lineUpdates);
  return { success: true };
}

/**
 * Reverses a finalize so a month can be corrected and recomputed. Mirrors
 * finalizePayroll: the FINALIZED precondition and the status flip are one
 * atomic claim, so two clicks can't both "reopen".
 */
export async function reopenPayroll(periodId: string): Promise<PayrollMutationResult> {
  const { default: prisma } = await import('@/app/lib/prisma');
  const claim = await prisma.payrollPeriod.updateMany({
    where: { id: periodId, status: 'FINALIZED' },
    data: { status: 'DRAFT', finalizedByAdminId: null, finalizedAt: null },
  });
  if (claim.count === 0) return { error: 'That payroll month is not finalized, so there is nothing to reopen.' };

  // Clear the finalize-time snapshots: a DRAFT month's lines are recomputable,
  // so a retained snapshot would describe figures that no longer hold. A fresh
  // one is written if the month is finalized again.
  await prisma.payrollLine.updateMany({ where: { periodId }, data: { snapshotJson: '' } });
  return { success: true };
}
