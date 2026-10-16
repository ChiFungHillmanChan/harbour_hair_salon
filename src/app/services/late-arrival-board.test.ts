import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const now = new Date('2099-09-01T12:00:00Z');
const minutes = (count: number) => new Date(now.getTime() + count * 60_000);

type Delivery = { id: string; kind: string; status: string };
type Row = {
  id: string; status: string; date: Date; arrivedAt: Date | null; lateCancelledAt: Date | null;
  user: { name: string | null }; stylist: { name: string }; service: { name: string };
  notifications: Delivery[];
};
type Range = { gt?: Date; gte?: Date; lt?: Date; lte?: Date };
type Where = Record<string, unknown>;

const row = (id: string, fields: Partial<Row>): Row => ({
  id, status: 'CONFIRMED', date: now, arrivedAt: null, lateCancelledAt: null,
  user: { name: `Customer ${id}` }, stylist: { name: 'Ivan' }, service: { name: 'Cut' }, notifications: [],
  ...fields,
});

/** Just enough of Prisma's `where` for the loader's three reads: equality, null and date ranges. */
function matches(record: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = record[key];
    if (condition === null) return value === null;
    if (typeof condition !== 'object' || condition instanceof Date) return value === condition;
    if (!(value instanceof Date)) return false;
    const range = condition as Range;
    return (!range.gt || value > range.gt) && (!range.gte || value >= range.gte)
      && (!range.lt || value < range.lt) && (!range.lte || value <= range.lte);
  });
}

function loadBoard(rows: Row[], lateAutoCancelSince: Date | null) {
  const queries: { where: Where; take?: number }[] = [];
  const db = {
    siteSettings: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        assert.equal(where.id, 'singleton');
        return { lateAutoCancelSince };
      },
    },
    appointment: {
      findMany: async (query: {
        where: Where; take?: number;
        orderBy: Record<string, 'asc' | 'desc'>[];
        select: { notifications?: { where: Where; take?: number } };
      }) => {
        queries.push(query);
        const [order] = query.orderBy;
        const [field, direction] = Object.entries(order)[0];
        const found = rows
          .filter((candidate) => matches(candidate, query.where))
          .sort((a, b) => {
            const left = (a as unknown as Record<string, Date>)[field].getTime();
            const right = (b as unknown as Record<string, Date>)[field].getTime();
            return direction === 'asc' ? left - right : right - left;
          })
          .slice(0, query.take);
        const notifications = query.select.notifications;
        return found.map((candidate) => ({
          ...candidate,
          notifications: notifications
            ? candidate.notifications.filter((delivery) => matches(delivery, notifications.where)).slice(0, notifications.take)
            : undefined,
        }));
      },
    },
  };
  const { getLateArrivalBoard } = loadServerModule<typeof import('./late-arrival-board')>('src/app/services/late-arrival-board.ts', {
    '@/app/lib/prisma': { __esModule: true, default: db },
  });
  return { getLateArrivalBoard, queries };
}

test('with the rule off, due arrivals are listed but nothing says it will be cancelled', async () => {
  const { getLateArrivalBoard } = loadBoard([row('soon', { date: minutes(30) }), row('late', { date: minutes(-20) })], null);
  const board = await getLateArrivalBoard(now);
  assert.equal(board.ruleOn, false);
  assert.deepEqual(board.due.map((entry) => [entry.id, entry.cancelsAt]), [['late', null], ['soon', null]]);
});

test('due lists CONFIRMED, not-arrived bookings from 120 minutes before to 60 minutes after now', async () => {
  const { getLateArrivalBoard, queries } = loadBoard([
    row('soon', { date: minutes(30), user: { name: null } }),
    row('long-gone', { date: minutes(-200) }),
    row('edge-old', { date: minutes(-120) }),
    row('too-early', { date: minutes(61) }),
    row('arrived', { date: minutes(-10), arrivedAt: minutes(-12) }),
    row('request', { date: minutes(-10), status: 'PENDING' }),
    row('done', { date: minutes(-30), status: 'COMPLETED' }),
  ], minutes(-7 * 24 * 60));
  const board = await getLateArrivalBoard(now);
  assert.equal(board.ruleOn, true);
  assert.deepEqual(board.due.map((entry) => entry.id), ['edge-old', 'soon']);
  assert.deepEqual(board.due[1], {
    id: 'soon', date: minutes(30).toISOString(), customerName: null, stylistName: 'Ivan', serviceName: 'Cut',
    cancelsAt: minutes(45).toISOString(),
  });
  for (const query of queries) assert.ok(query.take && query.take <= 50, 'every read is bounded');
});

test('a booking made before the rule was switched on never shows a cancellation time', async () => {
  const { getLateArrivalBoard } = loadBoard([
    row('before', { date: minutes(-60) }),
    row('after', { date: minutes(-10) }),
  ], minutes(-30));
  const board = await getLateArrivalBoard(now);
  assert.deepEqual(board.due.map((entry) => [entry.id, entry.cancelsAt]), [
    ['before', null],
    ['after', minutes(5).toISOString()],
  ]);
});

test('lateCancelled lists the rule’s cancellations of the last 24 hours and whether the customer was emailed', async () => {
  const { getLateArrivalBoard } = loadBoard([
    row('emailed', {
      status: 'CANCELLED', date: minutes(-200), lateCancelledAt: minutes(-180),
      notifications: [{ id: 'n1', kind: 'LATE_CANCELLED', status: 'SENT' }],
    }),
    row('waiting', {
      status: 'CANCELLED', date: minutes(-30), lateCancelledAt: minutes(-15),
      notifications: [{ id: 'n2', kind: 'LATE_CANCELLED', status: 'PENDING' }, { id: 'n3', kind: 'CONFIRMATION', status: 'SENT' }],
    }),
    row('yesterday', { status: 'CANCELLED', date: minutes(-25 * 60 - 20), lateCancelledAt: minutes(-25 * 60) }),
    row('staff-cancelled', { status: 'CANCELLED', date: minutes(-10) }),
  ], minutes(-7 * 24 * 60));
  const board = await getLateArrivalBoard(now);
  assert.deepEqual(board.due, []);
  assert.deepEqual(board.lateCancelled, [
    {
      id: 'waiting', date: minutes(-30).toISOString(), customerName: 'Customer waiting', stylistName: 'Ivan', serviceName: 'Cut',
      lateCancelledAt: minutes(-15).toISOString(), customerEmailed: false,
    },
    {
      id: 'emailed', date: minutes(-200).toISOString(), customerName: 'Customer emailed', stylistName: 'Ivan', serviceName: 'Cut',
      lateCancelledAt: minutes(-180).toISOString(), customerEmailed: true,
    },
  ]);
});
