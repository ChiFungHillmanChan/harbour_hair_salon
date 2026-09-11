import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarConnection, PrismaClient } from '@prisma/client';
import { syncCalendarFeeds } from './calendar-sync-service';
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
        const key = where.source_stylistId_externalUid;
        const old = blocks.find((item) => item.source === key.source && item.stylistId === key.stylistId && item.externalUid === key.externalUid);
        if (old) Object.assign(old, update); else blocks.push(create);
      },
      deleteMany: async ({ where }: { where: { source: string; stylistId: string; externalUid: { notIn: string[] }; start: { lt: Date }; end: { gt: Date } } }) => {
        let count = 0;
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          if (b.source === where.source && b.stylistId === where.stylistId && b.start < where.start.lt && b.end > where.end.gt && !where.externalUid.notIn.includes(b.externalUid)) { blocks.splice(i, 1); count++; }
        }
        return { count };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db: db as unknown as PrismaClient, rows, blocks, predicates };
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
test('invalid or recurring feeds are failures and never treated as a successful empty calendar', async () => {
  for (const text of ['<html>Login</html>', busy.replace('END:VEVENT', 'RRULE:FREQ=DAILY\r\nEND:VEVENT')]) {
    const state = fakeDb(); const result = await syncCalendarFeeds({ db: state.db, now, fetchFeed: async () => text });
    assert.equal(result[0].ok, false); assert.equal(state.rows[0].lastSuccessAt, null);
  }
});


test('new feeds are prioritized before already-attempted feeds in the bounded cron batch', async () => {
  let orderBy: unknown;
  const db = { calendarConnection: { findMany: async (args: { orderBy: unknown }) => { orderBy = args.orderBy; return []; } } };
  await syncCalendarFeeds({ db: db as never, now });
  assert.deepEqual(orderBy, { lastAttemptAt: { sort: 'asc', nulls: 'first' } });
});
