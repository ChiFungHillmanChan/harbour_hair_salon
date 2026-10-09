import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarConnection, PrismaClient } from '@prisma/client';
import { refreshStylistCalendarFeeds, syncCalendarFeeds } from './calendar-sync-service';
const now = new Date('2026-09-11T12:00:00Z');
const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
const busy = empty.replace('END:VCALENDAR', 'BEGIN:VEVENT\r\nUID:shared-uid\r\nDTSTART:20260912T100000Z\r\nDTEND:20260912T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR');
function connection(id = 'c1', stylistId = 's1', provider = 'TREATWELL'): CalendarConnection {
  return { id, stylistId, provider, receivesBookings: true, inboundEnabled: true, inboundUrl: 'https://example.com/private?token=secret', outboundConfirmedAt: now, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lockToken: null, lockedUntil: null, createdAt: now, updatedAt: now };
}
type Block = { source: string; stylistId: string; externalUid: string; start: Date; end: Date; lastSyncAt: Date };
function fakeDb(rows = [connection()]) {
  const blocks: Block[] = [];
  const predicates: Record<string, unknown>[] = [];
  const writes = { individual: 0, batches: [] as number[], failBatch: false };
  const db = {
    calendarConnection: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => row.inboundEnabled && row.inboundUrl && (!where.id || row.id === where.id) && (!where.provider || typeof where.provider !== 'string' || row.provider === where.provider)).map((row) => ({ ...row })),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<CalendarConnection> }) => {
        predicates.push(where);
        const row = rows.find((item) => item.id === where.id);
        if (!row || ('lockToken' in where && row.lockToken !== where.lockToken) || ('inboundUrl' in where && row.inboundUrl !== where.inboundUrl)) return { count: 0 };
        if ('OR' in where && row.lockedUntil && row.lockedUntil > now) return { count: 0 };
        if (where.lockedUntil && (!row.lockedUntil || row.lockedUntil <= now)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    externalBusyBlock: {
      upsert: async ({ where, create, update }: { where: { source_stylistId_externalUid: Pick<Block, 'source' | 'stylistId' | 'externalUid'> }; create: Block; update: Partial<Block> }) => {
        writes.individual++;
        const key = where.source_stylistId_externalUid;
        const old = blocks.find((item) => item.source === key.source && item.stylistId === key.stylistId && item.externalUid === key.externalUid);
        if (old) Object.assign(old, update); else blocks.push(create);
      },
      createMany: async ({ data }: { data: Block[] }) => {
        writes.batches.push(data.length);
        if (writes.failBatch) throw new Error('Synthetic insert failure');
        blocks.push(...data);
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { source: string; stylistId: string; externalUid?: { notIn: string[] }; start?: { lt: Date }; end?: { gt: Date }; OR?: ({ externalUid: { in: string[] } } | { start: { lt: Date }; end: { gt: Date } })[] } }) => {
        let count = 0;
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          const match = where.OR
            ? where.OR.some((part) => 'externalUid' in part ? part.externalUid.in.includes(b.externalUid) : b.start < part.start.lt && b.end > part.end.gt)
            : b.start < where.start!.lt && b.end > where.end!.gt && !where.externalUid!.notIn.includes(b.externalUid);
          if (b.source === where.source && b.stylistId === where.stylistId && match) { blocks.splice(i, 1); count++; }
        }
        return { count };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const savedRows = structuredClone(rows);
      const savedBlocks = structuredClone(blocks);
      try { return await fn(db); }
      catch (error) { rows.splice(0, rows.length, ...savedRows); blocks.splice(0, blocks.length, ...savedBlocks); throw error; }
    },
  };
  return { db: db as unknown as PrismaClient, rows, blocks, predicates, writes };
}
test('successful empty feed advances freshness and removes canceled in-progress/future blocks', async () => {
  const state = fakeDb(); state.blocks.push({ source: 'TREATWELL', stylistId: 's1', externalUid: 'old', start: new Date('2026-09-11T11:00:00Z'), end: new Date('2026-09-11T13:00:00Z'), lastSyncAt: now });
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => empty });
  assert.equal(result[0].ok, true); assert.equal(result[0].pruned, 1);
  assert.equal(state.rows[0].lastSuccessAt?.toISOString(), now.toISOString()); assert.equal(state.rows[0].lockToken, null);
});
test('failure preserves blocks and old lastSuccessAt; errors never reveal secret URLs', async () => {
  const state = fakeDb(); state.rows[0].lastSuccessAt = new Date('2026-09-11T11:00:00Z');
  state.blocks.push({ source: 'TREATWELL', stylistId: 's1', externalUid: 'old', start: now, end: new Date('2026-09-12T12:00:00Z'), lastSyncAt: now });
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => { throw new Error('https://example.com/private?token=secret'); } });
  assert.equal(result[0].ok, false); assert.equal(state.blocks.length, 1);
  assert.equal(state.rows[0].lastSuccessAt?.toISOString(), '2026-09-11T11:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /https|secret/); assert.ok(state.rows[0].lastError);
});
test('same UID remains isolated across stylists and providers and prune is source-scoped', async () => {
  const state = fakeDb([connection(), connection('c2', 's2'), connection('c3', 's1', 'FRESHA')]);
  await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => busy }); assert.equal(state.blocks.length, 3);
  await syncCalendarFeeds({ db: state.db, now, connectionId: 'c1', fetchFeed: async () => empty });
  assert.deepEqual(state.blocks.map((b) => `${b.source}/${b.stylistId}`).sort(), ['FRESHA/s1', 'TREATWELL/s2']);
});
test('a concurrent sync cannot steal an unexpired lease and performs no fetch', async () => {
  const state = fakeDb(); state.rows[0].lockToken = 'other'; state.rows[0].lockedUntil = new Date(now.getTime() + 60_000);
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => { throw new Error('must not fetch'); } });
  assert.equal(result[0].skipped, 'locked'); assert.equal(state.rows[0].lockToken, 'other');
});
test('changed configuration invalidates an in-flight sync without overwriting new state', async () => {
  const state = fakeDb();
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => { state.rows[0].inboundUrl = 'https://example.com/new'; state.rows[0].lockToken = null; return busy; } });
  assert.equal(result[0].ok, false); assert.equal(state.blocks.length, 0); assert.equal(state.rows[0].lastSuccessAt, null);
});
test('unreadable feeds are failures and never treated as a successful empty calendar', async () => {
  for (const text of ['<html>Login</html>', busy.replace('END:VEVENT', 'RDATE:20260701T090000Z\r\nEND:VEVENT')]) {
    const state = fakeDb(); const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => text });
    assert.equal(result[0].ok, false); assert.equal(state.rows[0].lastSuccessAt, null);
  }
});

// Recurring blocked time is normal staff behaviour. When this failed the whole
// feed, one stylist's standing commitment closed booking for the entire salon.
test('a recurring feed syncs instead of failing the connection', async () => {
  const state = fakeDb();
  const recurring = busy.replace('END:VEVENT', 'RRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT');
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => recurring });
  assert.equal(result[0].ok, true);
  assert.ok(result[0].upserted >= 3, `expected each occurrence stored, got ${result[0].upserted}`);
});


test('new feeds are prioritized before already-attempted feeds in the bounded cron batch', async () => {
  let orderBy: unknown;
  const db = { calendarConnection: { findMany: async (args: { orderBy: unknown }) => { orderBy = args.orderBy; return []; } } };
  await syncCalendarFeeds({ db: db as never, now });
  assert.deepEqual(orderBy, { lastAttemptAt: { sort: 'asc', nulls: 'first' } });
});

test('large valid feeds reconcile with bounded bulk writes rather than individual upserts', async () => {
  const state = fakeDb();
  const events = Array.from({ length: 250 }, (_, index) => `BEGIN:VEVENT\r\nUID:event-${index}\r\nDTSTART:20260912T100000Z\r\nDTEND:20260912T110000Z\r\nEND:VEVENT`).join('\r\n');
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => `BEGIN:VCALENDAR\r\n${events}\r\nEND:VCALENDAR` });
  assert.equal(result[0].ok, true);
  assert.equal(state.blocks.length, 250);
  assert.equal(state.writes.individual, 0);
  assert.equal(state.writes.batches.length, 3);
  assert.ok(state.writes.batches.every((size) => size <= 100));
});

test('a bulk insert failure rolls back removed blocks and freshness', async () => {
  const state = fakeDb();
  state.rows[0].lastSuccessAt = new Date('2026-09-11T11:00:00Z');
  state.blocks.push({ source: 'TREATWELL', stylistId: 's1', externalUid: 'keep', start: now, end: new Date('2026-09-12T12:00:00Z'), lastSyncAt: now });
  state.writes.failBatch = true;
  const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => busy });
  assert.equal(result[0].ok, false);
  assert.deepEqual(state.blocks.map((block) => block.externalUid), ['keep']);
  assert.equal(state.rows[0].lastSuccessAt?.toISOString(), '2026-09-11T11:00:00.000Z');
});

async function withCalendarSync<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.CALENDAR_SYNC_ENABLED;
  if (value === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = value;
  try { return await run(); } finally {
    if (previous === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = previous;
  }
}

test('approval refresh re-imports only that stylist\'s feeds older than five minutes or whose last attempt failed', async () => {
  const queries: Record<string, unknown>[] = [];
  const db = { calendarConnection: { findMany: async ({ where }: { where: Record<string, unknown> }) => { queries.push(where); return []; } } };
  await withCalendarSync('true', () => refreshStylistCalendarFeeds('s1', { db: db as unknown as PrismaClient, now }));
  assert.equal(queries.length, 1);
  assert.equal(queries[0].stylistId, 's1');
  assert.deepEqual(queries[0].OR, [
    { lastSuccessAt: null },
    { lastSuccessAt: { lt: new Date('2026-09-11T11:55:00Z') } },
    { lastError: { not: null } },
  ]);
});

test('approval refresh respects the kill-switch and never throws', async () => {
  let reads = 0;
  const db = { calendarConnection: { findMany: async () => { reads++; throw new Error('database unavailable'); } } };
  for (const flag of [undefined, 'false']) {
    assert.deepEqual(await withCalendarSync(flag, () => refreshStylistCalendarFeeds('s1', { db: db as unknown as PrismaClient, now })), []);
  }
  assert.equal(reads, 0, 'a disabled sync must not touch the database');
  assert.deepEqual(await withCalendarSync('true', () => refreshStylistCalendarFeeds('s1', { db: db as unknown as PrismaClient, now })), []);
  assert.equal(reads, 1);
});
