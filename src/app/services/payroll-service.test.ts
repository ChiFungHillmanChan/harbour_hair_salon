import test from 'node:test';
import assert from 'node:assert/strict';
import { monthBounds, runPayrollWith, type PayrollDb } from './payroll-service';

type Entry = { clockIn: Date; clockOut: Date | null; breakMinutes: number };
type Appt = { priceAtBooking: number | null; service: { price: number } };
type Employee = {
  id: string;
  payType: string;
  hourlyRate: number | null;
  monthlySalary: number | null;
  commissionRate: number | null;
  overtimeEnabled: boolean;
  overtimeThresholdHours: number | null;
  overtimeMultiplier: number | null;
  unpaidBreakMinutes: number | null;
  stylistId: string | null;
};

/**
 * Fake `PayrollDb`. `employee.findMany` always returns the full `employees`
 * list regardless of the `where` it's called with — this suite is about the
 * APPROVED/COMPLETED query predicates and the adjustment/overtime glue logic,
 * not the leaver-inclusion `OR` filter itself, so the fake doesn't need to
 * simulate that filtering to exercise those paths.
 */
function makeFakeDb(opts: {
  periodStatus?: string;
  employees: Employee[];
  entriesByEmployee?: Record<string, Entry[]>;
  appointmentsByStylist?: Record<string, Appt[]>;
  existingLines?: Record<string, { adjustments: number; adjustmentNote: string | null }>;
}) {
  const recorded = {
    approvedEntryWheres: [] as unknown[],
    perEmployeeEntryWheres: [] as unknown[],
    appointmentWheres: [] as unknown[],
    upserts: [] as { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }[],
  };

  const db = {
    auditEvent: { create: async () => ({ id: 'audit' }) },
    payrollPeriod: {
      upsert: async () => ({ id: 'period-1', status: opts.periodStatus ?? 'DRAFT' }),
    },
    timeEntry: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        recorded.approvedEntryWheres.push(args.where);
        return Object.entries(opts.entriesByEmployee ?? {}).flatMap(([employeeId, entries]) => entries.map((entry) => ({ employeeId, ...entry })));
      },
    },
    payrollLine: {
      findMany: async () => Object.entries(opts.existingLines ?? {}).map(([employeeId, line]) => ({ employeeId, ...line })),
      findUnique: async (args: { where: { periodId_employeeId: { employeeId: string } } }) => {
        const line = (opts.existingLines ?? {})[args.where.periodId_employeeId.employeeId];
        return line ? { adjustments: line.adjustments, adjustmentNote: line.adjustmentNote } : null;
      },
      upsert: async (args: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        recorded.upserts.push(args);
        return {};
      },
    },
    appointment: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        recorded.appointmentWheres.push(args.where);
        return Object.entries(opts.appointmentsByStylist ?? {}).flatMap(([stylistId, appointments]) => appointments.map((appointment) => ({ stylistId, ...appointment })));
      },
    },
    employee: {
      findMany: async () => opts.employees,
    },
  };

  return { db: { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db) } as unknown as PayrollDb, recorded };
}

// --- monthBounds: salon-timezone (Europe/London) month [start, end) ---

test('monthBounds: BST month (July) bounds are UTC+1 offset from local midnight', () => {
  const { start, end } = monthBounds(2026, 7);
  assert.equal(start.toISOString(), '2026-06-30T23:00:00.000Z');
  assert.equal(end.toISOString(), '2026-07-31T23:00:00.000Z');
});

test('monthBounds: GMT month (January) bounds equal local midnight (UTC+0)', () => {
  const { start, end } = monthBounds(2026, 1);
  assert.equal(start.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-02-01T00:00:00.000Z');
});

test('monthBounds: December rolls the end bound into January of the next year', () => {
  const { start, end } = monthBounds(2026, 12);
  assert.equal(start.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
});

// --- query predicates ---

test('runPayrollWith: the batched time-entry scan requires status APPROVED and clockOut not null', async () => {
  const { start, end } = monthBounds(2026, 7);
  const { db, recorded } = makeFakeDb({
    employees: [{
      id: 'e1', payType: 'HOURLY', hourlyRate: 10, monthlySalary: null, commissionRate: null,
      overtimeEnabled: false, overtimeThresholdHours: null, overtimeMultiplier: 1.5,
      unpaidBreakMinutes: 0, stylistId: null,
    }],
    entriesByEmployee: {
      e1: [{ clockIn: new Date('2026-07-05T09:00:00Z'), clockOut: new Date('2026-07-05T14:00:00Z'), breakMinutes: 0 }],
    },
  });

  await runPayrollWith(db, 2026, 7);

  assert.deepEqual(recorded.approvedEntryWheres[0], {
    status: 'APPROVED',
    clockOut: { not: null },
    clockIn: { gte: start, lt: end },
  });
  assert.equal(recorded.approvedEntryWheres.length, 1);
});

test('runPayrollWith: commission query requires status COMPLETED and uses priceAtBooking over service.price', async () => {
  const { start, end } = monthBounds(2026, 7);
  const { db, recorded } = makeFakeDb({
    employees: [{
      id: 'e1', payType: 'COMMISSION', hourlyRate: null, monthlySalary: null, commissionRate: 0.5,
      overtimeEnabled: false, overtimeThresholdHours: null, overtimeMultiplier: 1.5,
      unpaidBreakMinutes: 0, stylistId: 'stylist-1',
    }],
    appointmentsByStylist: {
      'stylist-1': [{ priceAtBooking: 50, service: { price: 999 } }],
    },
  });

  await runPayrollWith(db, 2026, 7);

  assert.deepEqual(recorded.appointmentWheres[0], {
    stylistId: { in: ['stylist-1'] },
    status: 'COMPLETED',
    date: { gte: start, lt: end },
  });
  // priceAtBooking (50) wins over the stale service.price (999): commission = 50 * 0.5.
  assert.equal(recorded.upserts[0].update.commissionPay, 25);
});

test('runPayrollWith: an existing line\'s adjustments/adjustmentNote survive into the upsert on a re-run', async () => {
  const { db, recorded } = makeFakeDb({
    employees: [{
      id: 'e1', payType: 'SALARY', hourlyRate: null, monthlySalary: 1000, commissionRate: null,
      overtimeEnabled: false, overtimeThresholdHours: null, overtimeMultiplier: 1.5,
      unpaidBreakMinutes: 0, stylistId: null,
    }],
    existingLines: { e1: { adjustments: 25, adjustmentNote: 'Bonus carried over' } },
  });

  await runPayrollWith(db, 2026, 7);

  assert.equal(recorded.upserts[0].update.adjustments, 25);
  assert.equal(recorded.upserts[0].update.adjustmentNote, 'Bonus carried over');
  assert.equal(recorded.upserts[0].update.grossPay, 1025); // 1000 salary + 25 preserved adjustment
});

// --- controller addition #2: null overtime threshold must not classify hours as overtime ---

test('runPayrollWith: overtimeEnabled true but overtimeThresholdHours null classifies ALL hours regular (no overtime pay)', async () => {
  const { db, recorded } = makeFakeDb({
    employees: [{
      id: 'e1', payType: 'HOURLY', hourlyRate: 10, monthlySalary: null, commissionRate: null,
      overtimeEnabled: true, overtimeThresholdHours: null, overtimeMultiplier: 1.5,
      unpaidBreakMinutes: 0, stylistId: null,
    }],
    entriesByEmployee: {
      e1: [{ clockIn: new Date('2026-07-05T08:00:00Z'), clockOut: new Date('2026-07-05T18:00:00Z'), breakMinutes: 0 }],
    },
  });

  await runPayrollWith(db, 2026, 7);

  const u = recorded.upserts[0].update;
  assert.equal(u.totalHours, 10);
  assert.equal(u.regularHours, 10);
  assert.equal(u.overtimeHours, 0);
  assert.equal(u.overtimePay, 0);
  assert.equal(u.basePay, 100); // 10h * £10, all regular
});
