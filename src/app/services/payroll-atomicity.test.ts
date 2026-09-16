import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

type Row = Record<string, unknown>;

function fixture(options: { failSnapshot?: boolean; failClear?: boolean; employees?: number } = {}) {
  let period = { id: 'period', status: 'DRAFT', finalizedAt: null as Date | null };
  let lines: Row[] = [{ id: 'line', periodId: 'period', employeeId: 'e0', totalHours: 0, regularHours: 0, overtimeHours: 0, basePay: 1000, overtimePay: 0, commissionableRevenue: 0, commissionPay: 0, adjustments: 25, adjustmentNote: 'Bonus', grossPay: 1025, snapshotJson: '' }];
  const reads = { entries: 0, appointments: 0, lines: 0 };
  let audits: Row[] = [];
  const employees = Array.from({ length: options.employees ?? 1 }, (_, i) => ({ id: `e${i}`, payType: 'SALARY', hourlyRate: null, monthlySalary: 1000, commissionRate: null, overtimeEnabled: false, overtimeThresholdHours: null, overtimeMultiplier: null, unpaidBreakMinutes: 0, stylistId: `s${i}` }));
  const db = {
    auditEvent: { create: async ({ data }: { data: Row }) => { audits.push(data); } },
    payrollPeriod: {
      upsert: async () => ({ ...period }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (where.status && where.status !== period.status) return { count: 0 };
        Object.assign(period, data);
        return { count: 1 };
      },
    },
    employee: { findMany: async () => employees },
    timeEntry: { findMany: async () => { reads.entries++; return []; } },
    appointment: { findMany: async () => { reads.appointments++; return []; } },
    payrollLine: {
      findMany: async () => { reads.lines++; return structuredClone(lines); },
      findUnique: async ({ where }: { where: Row }) => {
        const key = where.periodId_employeeId as Row | undefined;
        const line = lines.find((line) => key ? line.employeeId === key.employeeId : line.id === where.id);
        return line ? { ...structuredClone(line), period: { ...period } } : null;
      },
      upsert: async ({ where, update, create }: { where: { periodId_employeeId: { employeeId: string } }; update: Row; create: Row }) => {
        const line = lines.find((line) => line.employeeId === where.periodId_employeeId.employeeId);
        if (line) Object.assign(line, update);
        else lines.push({ id: `line-${lines.length}`, ...create });
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        if (options.failSnapshot && data.snapshotJson) throw new Error('snapshot write failed');
        Object.assign(lines.find((line) => line.id === where.id)!, data);
      },
      updateMany: async ({ data }: { data: Row }) => {
        if (options.failClear) throw new Error('snapshot clear failed');
        for (const line of lines) Object.assign(line, data);
        return { count: lines.length };
      },
    },
    $transaction: async (run: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => {
      const before = structuredClone({ period, lines, audits });
      try { return await (Array.isArray(run) ? Promise.all(run) : run(db)); }
      catch (error) { period = before.period; lines = before.lines; audits = before.audits; throw error; }
    },
  };
  const service = loadServerModule<typeof import('./payroll-service')>('src/app/services/payroll-service.ts', { '@/app/lib/prisma': db });
  return { service, reads, period: () => period, lines: () => lines, audits: () => audits };
}

test('failed snapshot writes roll back payroll finalization and allow retry', async () => {
  const f = fixture({ failSnapshot: true });
  await assert.rejects(f.service.finalizePayroll('period', 'admin'), /snapshot write failed/);
  assert.equal(f.period().status, 'DRAFT');
  assert.equal(f.period().finalizedAt, null);
});

test('reopen rolls back status when clearing snapshots fails', async () => {
  const f = fixture({ failClear: true });
  await f.service.finalizePayroll('period', 'admin');
  const snapshot = f.lines()[0].snapshotJson;
  await assert.rejects(f.service.reopenPayroll('period'), /snapshot clear failed/);
  assert.equal(f.period().status, 'FINALIZED');
  assert.equal(f.lines()[0].snapshotJson, snapshot);
});

test('payroll batches source reads independently of employee count and preserves adjustments', async () => {
  const f = fixture({ employees: 12 });
  await f.service.runPayroll(2026, 8);
  assert.equal(f.reads.entries, 1);
  assert.equal(f.reads.appointments, 1);
  assert.equal(f.reads.lines, 1);
  assert.equal(f.lines().length, 12);
  assert.equal(f.lines()[0].grossPay, 1025);
  assert.equal(f.lines()[0].adjustmentNote, 'Bonus');
});

test('finalized figures reject recomputation and adjustments; reopen permits a new snapshot', async () => {
  const f = fixture();
  await f.service.finalizePayroll('period', 'admin');
  await assert.rejects(f.service.runPayroll(2026, 8), /finalized/);
  assert.ok((await f.service.updateAdjustment('line', 50, 'changed')).error);
  await f.service.reopenPayroll('period');
  assert.equal(f.lines()[0].snapshotJson, '');
  await f.service.updateAdjustment('line', 50, 'changed');
  await f.service.finalizePayroll('period', 'admin');
  assert.equal(JSON.parse(String(f.lines()[0].snapshotJson)).grossPay, 1050);
});

test('every successful payroll mutation records its actor and period without adjustment notes', async () => {
  const f = fixture();
  await f.service.runPayroll(2026, 8, 'admin');
  await f.service.updateAdjustment('line', 50, 'Private adjustment note', 'admin');
  await f.service.finalizePayroll('period', 'admin');
  await f.service.reopenPayroll('period', 'admin');
  assert.deepEqual(f.audits().map((event) => event.action), ['PAYROLL_RUN', 'PAYROLL_ADJUST', 'PAYROLL_FINALIZE', 'PAYROLL_REOPEN']);
  assert.ok(f.audits().every((event) => event.actorUserId === 'admin' && event.targetType === 'PayrollPeriod' && event.targetId === 'period'));
  assert.ok(!JSON.stringify(f.audits()).includes('Private adjustment note'));
});
