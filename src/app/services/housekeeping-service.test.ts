import test from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { runHousekeeping } from './housekeeping-service';

const now = new Date('2026-09-16T12:00:00Z');
type Row = Record<string, unknown> & { id: string };
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, value]) => {
    if (field === 'OR') return (value as Record<string, unknown>[]).some((branch) => matches(row, branch));
    if (field === 'AND') return (value as Record<string, unknown>[]).every((branch) => matches(row, branch));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, expected]) => {
        const actual = row[field] as string | number;
        if (operator === 'in') return (expected as unknown[]).includes(actual);
        if (operator === 'not') return actual !== expected;
        if (operator === 'lt') return actual != null && actual < (expected as string | number);
        if (operator === 'lte') return actual != null && actual <= (expected as string | number);
        throw new Error(`Unhandled operator ${operator}`);
      });
    }
    return row[field] === value;
  });
}
function table(rows: Row[]) {
  return {
    findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => rows.filter((row) => matches(row, where)).slice(0, take).map(({ id }) => ({ id })),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const selected = rows.filter((row) => matches(row, where));
      selected.forEach((row) => Object.assign(row, data));
      return { count: selected.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const selected = rows.filter((row) => matches(row, where));
      rows.splice(0, rows.length, ...rows.filter((row) => !selected.includes(row)));
      return { count: selected.length };
    },
  };
}
function fixture() {
  const notices: Row[] = [];
  const busy: Row[] = [];
  const kiosks: Row[] = [];
  const jobs: Row[] = [];
  const db = {
    notificationDelivery: table(notices), externalBusyBlock: table(busy), kioskSession: table(kiosks),
    backgroundJobState: {
      ...table(jobs),
      upsert: async ({ where, create }: { where: { name: string }; create: Record<string, unknown> }) => {
        if (!jobs.some((row) => row.name === where.name)) jobs.push({ id: where.name, lockedUntil: null, lockToken: null, ...create });
      },
    },
  } as unknown as PrismaClient;
  return { db, notices, busy, kiosks, jobs };
}
function notice(id: string, changes: Record<string, unknown> = {}): Row {
  return { id, status: 'PENDING', payloadJson: '{"email":"fixture@example.invalid"}', createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-01'), lockedAt: null, lockToken: null, attempts: 2, firstAttemptAt: new Date('2026-08-01'), ...changes };
}

test('housekeeping scrubs expired unsent payloads without sending notifications or rewriting scrubbed rows', async () => {
  const f = fixture();
  f.notices.push(notice('old'), notice('clean', { status: 'SKIPPED', payloadJson: '{}', lastError: 'unchanged' }), notice('recent', { createdAt: now }));
  const result = await runHousekeeping({ db: f.db, now });
  assert.equal(result.scrubbed, 1);
  assert.equal(f.notices[0].payloadJson, '{}');
  assert.equal(f.notices[0].status, 'SKIPPED');
  assert.equal(f.notices[1].lastError, 'unchanged');
  assert.notEqual(f.notices[2].payloadJson, '{}');
  assert.equal((await runHousekeeping({ db: f.db, now })).scrubbed, 0);
});

test('expired claims recover without changing retry identity; live claims retain their payload and lease', async () => {
  const f = fixture();
  f.notices.push(notice('stale', { status: 'PROCESSING', createdAt: now, lockedAt: new Date('2026-09-16T11:50:00Z'), lockToken: 'old-owner' }), notice('live', { status: 'PROCESSING', lockedAt: new Date('2026-09-16T11:59:00Z'), lockToken: 'live-owner' }));
  const result = await runHousekeeping({ db: f.db, now });
  assert.equal(result.recovered, 1);
  assert.equal(f.notices[0].status, 'PENDING');
  assert.equal(f.notices[0].attempts, 2);
  assert.equal(f.notices[0].firstAttemptAt instanceof Date && f.notices[0].firstAttemptAt.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(f.notices[1].lockToken, 'live-owner');
  assert.notEqual(f.notices[1].payloadJson, '{}');
});

test('retention deletes old terminal metadata, expired busy intervals and retired kiosk grants only', async () => {
  const f = fixture();
  f.notices.push(notice('ancient', { status: 'SENT', payloadJson: '{}', createdAt: new Date('2025-01-01') }), notice('recent', { status: 'SENT', payloadJson: '{}', createdAt: now }));
  f.busy.push({ id: 'old', end: new Date('2026-08-01') }, { id: 'current', end: now }, { id: 'future', end: new Date('2027-01-01') });
  f.kiosks.push({ id: 'expired', expiresAt: new Date('2026-08-01'), revokedAt: null }, { id: 'revoked', expiresAt: new Date('2027-01-01'), revokedAt: new Date('2026-08-01') }, { id: 'active', expiresAt: new Date('2027-01-01'), revokedAt: null });
  const result = await runHousekeeping({ db: f.db, now });
  assert.equal(result.deletedNotifications, 1);
  assert.deepEqual(f.notices.map((row) => row.id), ['recent']);
  assert.deepEqual(f.busy.map((row) => row.id), ['current', 'future']);
  assert.deepEqual(f.kiosks.map((row) => row.id), ['active']);
});

test('a large backlog is processed in bounded batches across runs', async () => {
  const f = fixture();
  f.notices.push(...Array.from({ length: 501 }, (_, index) => notice(`n-${index}`)));
  assert.equal((await runHousekeeping({ db: f.db, now })).scrubbed, 250);
  assert.equal((await runHousekeeping({ db: f.db, now })).scrubbed, 250);
  assert.equal((await runHousekeeping({ db: f.db, now })).scrubbed, 1);
});
