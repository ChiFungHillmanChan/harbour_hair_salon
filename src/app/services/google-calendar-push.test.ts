import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import * as gatewayModule from './google-calendar-gateway';
import { GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';
import { googleEventIdFor } from './google-calendar-event';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { ERASED_CUSTOMER_NAME, erasedEmailFor } from '../lib/customer-erasure';
import { SITE_URL } from '../lib/site-url';

const NOW = new Date('2099-09-01T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const DAY = 24 * 60;
const CONFIG = { calendarId: 'cal@group.calendar.google.com', clientEmail: 'sa@harbour.iam.gserviceaccount.com', privateKey: 'k', webhookSecret: 's' };

type EventRow = {
  appointmentId: string; eventId: string; syncedHash: string | null; syncedAt: Date | null;
  removed: boolean; attempts: number; lastError: string | null;
};
type Appt = {
  id: string; date: Date; status: string; notes: string | null; durationAtBooking: number | null; updatedAt: Date;
  stylistId: string; serviceId: string;
  user: { name: string | null; phone: string | null; email: string };
  stylist: { id: string; name: string };
  service: { id: string; name: string; duration: number };
  paymentAttempt: { status: string; amountPence: number; refunds: { status: string; amountPence: number }[] } | null;
};

/** A booking tomorrow at 13:00 (BST), changed five minutes ago. */
function appt(id: string, overrides: Partial<Appt> = {}): Appt {
  return {
    id, date: at(DAY), status: 'CONFIRMED', notes: null, durationAtBooking: 60, updatedAt: at(-5), stylistId: 's1', serviceId: 'svc',
    user: { name: 'Amy Lee', phone: '07700 900123', email: `${id}@example.test` },
    stylist: { id: 's1', name: 'Ivan' }, service: { id: 'svc', name: 'Haircut', duration: 45 }, paymentAttempt: null,
    ...overrides,
  };
}

function eventRow(appointmentId: string, overrides: Partial<EventRow> = {}): EventRow {
  return {
    appointmentId, eventId: googleEventIdFor(appointmentId), syncedHash: 'stale-hash', syncedAt: at(-DAY),
    removed: false, attempts: 0, lastError: null, ...overrides,
  };
}

/** The Prisma filters the push uses: equality, null, `is`, `not`, `in`, `gte`, `lt`, `OR`, nested relations. */
function matches(record: unknown, where: Record<string, unknown>): boolean {
  if (!record || typeof record !== 'object') return false;
  const row = record as Record<string, unknown>;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Record<string, unknown>[]).some((part) => matches(row, part));
    if (key === 'AND') return (condition as Record<string, unknown>[]).every((part) => matches(row, part));
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition !== 'object') return value === condition;
    const ops = condition as Record<string, unknown>;
    if ('is' in ops) return ops.is === null ? value == null : value != null && matches(value, ops.is as Record<string, unknown>);
    const operators = ['in', 'not', 'gte', 'gt', 'lt', 'lte'];
    if (!Object.keys(ops).some((op) => operators.includes(op))) return matches(value, ops);
    return Object.entries(ops).every(([op, operand]) => {
      if (op === 'in') return (operand as unknown[]).includes(value);
      if (op === 'not') return operand === null ? value != null : value !== operand;
      const [a, b] = [value instanceof Date ? value.getTime() : value, operand instanceof Date ? operand.getTime() : operand] as [number, number];
      if (op === 'gte') return a >= b;
      if (op === 'gt') return a > b;
      if (op === 'lt') return a < b;
      return a <= b;
    });
  });
}

function ordered<T extends Record<string, unknown>>(list: T[], orderBy: unknown): T[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, 'asc' | 'desc'>[];
  return [...list].sort((x, y) => {
    for (const key of keys) {
      const [field, direction] = Object.entries(key)[0];
      const [a, b] = [x[field], y[field]].map((v) => (v instanceof Date ? v.getTime() : v)) as [number, number];
      if (a !== b) return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

function applyData(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) {
      row[key] = (row[key] as number) + (value as { increment: number }).increment;
    } else {
      row[key] = value;
    }
  }
}

function fakeDb(
  appointments: Appt[],
  events: EventRow[] = [],
  options: { settings?: { salonNotificationLocale: string } | null; translations?: { entityType: string; entityId: string; locale: string; fieldsJson: string }[]; failWriteFor?: string } = {},
) {
  const rows = new Map(events.map((row) => [row.appointmentId, { ...row }]));
  const settings = options.settings === undefined ? { salonNotificationLocale: 'en-GB' } : options.settings;
  const withEvent = (a: Appt) => ({ ...structuredClone(a), googleCalendarEvent: rows.has(a.id) ? { ...rows.get(a.id)! } : null });
  const db = {
    appointment: {
      async findMany(args: { where?: Record<string, unknown>; orderBy?: unknown; take?: number }) {
        const list = ordered(appointments.map(withEvent).filter((row) => matches(row, args.where ?? {})), args.orderBy);
        return list.slice(0, args.take ?? list.length);
      },
    },
    googleCalendarEvent: {
      async findMany(args: { where?: Record<string, unknown>; take?: number }) {
        const list = [...rows.values()]
          .map((row) => ({ ...row, appointment: structuredClone(appointments.find((a) => a.id === row.appointmentId)) }))
          .filter((row) => matches(row, args.where ?? {}));
        return list.slice(0, args.take ?? list.length);
      },
      async upsert(args: { where: { appointmentId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        if (options.failWriteFor === args.where.appointmentId) throw new Error('database unavailable');
        const existing = rows.get(args.where.appointmentId);
        if (existing) {
          applyData(existing as unknown as Record<string, unknown>, args.update);
        } else {
          const created = { syncedHash: null, syncedAt: null, removed: false, attempts: 0, lastError: null, ...args.create } as unknown as EventRow;
          rows.set(args.where.appointmentId, created);
        }
      },
      async update(args: { where: { appointmentId: string }; data: Record<string, unknown> }) {
        if (options.failWriteFor === args.where.appointmentId) throw new Error('database unavailable');
        const existing = rows.get(args.where.appointmentId);
        if (!existing) throw new Error('record to update not found');
        applyData(existing as unknown as Record<string, unknown>, args.data);
      },
    },
    siteSettings: { async findUnique() { return settings; } },
    stylist: { async findMany() { return [{ id: 's2' }, { id: 's1' }]; } },
    contentTranslation: {
      async findMany(args: { where: Record<string, unknown> }) {
        return (options.translations ?? []).filter((row) => matches(row, args.where)).map(({ entityId, fieldsJson }) => ({ entityId, fieldsJson }));
      },
    },
  };
  return { db, rows };
}

type Call = { op: 'put' | 'insert' | 'delete'; id: string; event?: GoogleEvent };

/** `fail` answers each call with an error to throw, or nothing for success. */
function fakeGateway(fail: (call: Call) => GoogleCalendarError | Error | undefined = () => undefined) {
  const calls: Call[] = [];
  const handle = async (call: Call) => {
    calls.push(call);
    const error = fail(call);
    if (error) throw error;
  };
  return {
    calls,
    gateway: {
      async putEvent(event: GoogleEvent) { await handle({ op: 'put', id: event.id, event }); return event; },
      async insertEvent(event: GoogleEvent) { await handle({ op: 'insert', id: event.id, event }); return event; },
      async deleteEvent(id: string) { await handle({ op: 'delete', id }); },
    },
  };
}

/** Any property read throws: proves nothing touched the database. */
const untouchable = new Proxy({}, { get(_target, key) { throw new Error(`database touched: ${String(key)}`); } });

function load(config: typeof CONFIG | null = CONFIG) {
  return loadServerModule<typeof import('./google-calendar-push')>('src/app/services/google-calendar-push.ts', {
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => config },
    './google-calendar-gateway': gatewayModule,
    '@/app/lib/prisma': untouchable,
  });
}

type PushOptions = NonNullable<Parameters<typeof import('./google-calendar-push').pushGoogleCalendar>[0]>;
function run(db: unknown, gateway: unknown, extra: Partial<PushOptions> = {}) {
  return load().pushGoogleCalendar({ db: db as never, gateway: gateway as never, now: NOW, ...extra });
}

test('sync switched off: nothing is read, nothing is sent', async () => {
  const google = fakeGateway();
  const push = load(null);
  assert.deepEqual(await push.pushGoogleCalendar({ db: untouchable as never, gateway: google.gateway as never, now: NOW }),
    { written: 0, deleted: 0, unchanged: 0, failed: 0, skipped: 'disabled' });
  // Without an injected client the default one is never imported either.
  assert.deepEqual(await push.pushGoogleCalendar({ gateway: google.gateway as never }),
    { written: 0, deleted: 0, unchanged: 0, failed: 0, skipped: 'disabled' });
  assert.equal(google.calls.length, 0);
});

test('a new confirmed booking: PUT 404 → insert with its own id, and the row is stored', async () => {
  const { db, rows } = fakeDb([appt('a1')]);
  const google = fakeGateway((call) => (call.op === 'put' ? new GoogleCalendarError('not_found', 404) : undefined));
  assert.deepEqual(await run(db, google.gateway), { written: 1, deleted: 0, unchanged: 0, failed: 0 });
  assert.deepEqual(google.calls.map((call) => call.op), ['put', 'insert']);
  const event = google.calls[1].event!;
  assert.equal(event.id, googleEventIdFor('a1'));
  assert.equal(event.status, 'confirmed');
  assert.equal(event.summary, 'Ivan · Amy Lee · Haircut');
  assert.equal(event.colorId, '1', 'colours follow the sorted stylist ids');
  assert.equal(new Date(event.start!.dateTime!).getTime(), at(DAY).getTime());
  assert.equal(new Date(event.end!.dateTime!).getTime(), at(DAY + 60).getTime(), 'the booked duration, not the service default');
  assert.ok(event.description!.includes('Phone: 07700 900123'));
  assert.ok(event.description!.includes(`Open in Admin: ${SITE_URL}/admin?date=2099-09-02&view=day`));
  const row = rows.get('a1')!;
  assert.equal(row.eventId, googleEventIdFor('a1'));
  assert.match(row.syncedHash ?? '', /^[0-9a-f]{64}$/);
  assert.equal(row.syncedAt?.getTime(), NOW.getTime());
  assert.equal(row.removed, false);
  assert.equal(row.attempts, 0);
  assert.equal(row.lastError, null);
});

test('insert 409 (the id exists, deleted) → PUT again', async () => {
  const { db, rows } = fakeDb([appt('a1')]);
  let puts = 0;
  const google = fakeGateway((call) => {
    if (call.op === 'put') return ++puts === 1 ? new GoogleCalendarError('not_found', 404) : undefined;
    return new GoogleCalendarError('conflict', 409);
  });
  assert.deepEqual(await run(db, google.gateway), { written: 1, deleted: 0, unchanged: 0, failed: 0 });
  assert.deepEqual(google.calls.map((call) => call.op), ['put', 'insert', 'put']);
  assert.equal(rows.get('a1')!.lastError, null);
});

test('an unchanged rendering sends nothing', async () => {
  const { db } = fakeDb([appt('a1')]);
  const google = fakeGateway();
  await run(db, google.gateway);
  assert.equal(google.calls.length, 1);
  assert.deepEqual(await run(db, google.gateway), { written: 0, deleted: 0, unchanged: 1, failed: 0 });
  assert.equal(google.calls.length, 1);
});

test('the salon language: Chinese title, translated service, /zh-hk admin link; English name when untranslated', async () => {
  const translations = [{ entityType: 'SERVICE', entityId: 'svc', locale: 'zh-HK', fieldsJson: JSON.stringify({ name: '剪髮' }) }];
  const { db } = fakeDb([
    appt('a1', { status: 'PENDING' }),
    appt('a2', { serviceId: 'colour', service: { id: 'colour', name: 'Colour', duration: 90 }, stylistId: 's2', stylist: { id: 's2', name: 'Lox' } }),
  ], [], { settings: { salonNotificationLocale: 'zh-HK' }, translations });
  const google = fakeGateway();
  await run(db, google.gateway);
  const byId = new Map(google.calls.map((call) => [call.id, call.event!]));
  const first = byId.get(googleEventIdFor('a1'))!;
  assert.equal(first.summary, '[待確認] Ivan · Amy Lee · 剪髮');
  assert.ok(first.description!.includes(`${SITE_URL}/zh-hk/admin?date=2099-09-02&view=day`));
  const second = byId.get(googleEventIdFor('a2'))!;
  assert.equal(second.summary, 'Lox · Amy Lee · Colour');
  assert.equal(second.colorId, '2');
});

test('no settings row: the salon language defaults to Traditional Chinese', async () => {
  const { db } = fakeDb([appt('a1')], [], { settings: null });
  const google = fakeGateway();
  await run(db, google.gateway);
  assert.ok(google.calls[0].event!.description!.includes('電話：07700 900123'));
});

test('an erased customer renders anonymised, without phone; a held deposit is described', async () => {
  const { db } = fakeDb([
    appt('a1', { user: { name: ERASED_CUSTOMER_NAME, phone: '07700 900123', email: erasedEmailFor('u1') }, notes: 'fringe' }),
    appt('a2', { paymentAttempt: { status: 'AUTHORIZED', amountPence: 1500, refunds: [] } }),
  ]);
  const google = fakeGateway();
  await run(db, google.gateway);
  const byId = new Map(google.calls.map((call) => [call.id, call.event!]));
  const erased = byId.get(googleEventIdFor('a1'))!;
  assert.equal(erased.summary, `Ivan · ${ERASED_CUSTOMER_NAME} · Haircut`);
  assert.ok(!erased.description!.includes('07700'));
  assert.ok(!erased.description!.includes('fringe'));
  assert.ok(byId.get(googleEventIdFor('a2'))!.description!.includes('Deposit: £15.00 held on the card, not taken'));
});

test('a cancelled booking: its event is deleted and the row marked removed; one never written needs nothing', async () => {
  const { db, rows } = fakeDb(
    [appt('a1', { status: 'CANCELLED' }), appt('a2', { status: 'CANCELLED' })],
    [eventRow('a1', { syncedHash: 'h1' })],
  );
  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway), { written: 0, deleted: 1, unchanged: 1, failed: 0 });
  assert.deepEqual(google.calls, [{ op: 'delete', id: googleEventIdFor('a1') }]);
  assert.equal(rows.get('a1')!.removed, true);
  assert.equal(rows.get('a1')!.syncedHash, null);
  assert.equal(rows.has('a2'), false);
  // Already removed: nothing more to send.
  assert.deepEqual(await run(db, google.gateway), { written: 0, deleted: 0, unchanged: 2, failed: 0 });
  assert.equal(google.calls.length, 1);
});

test('a booking restored after its event was deleted is written back as confirmed', async () => {
  const { db, rows } = fakeDb([appt('a1')], [eventRow('a1', { removed: true, syncedHash: null })]);
  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway), { written: 1, deleted: 0, unchanged: 0, failed: 0 });
  assert.equal(google.calls[0].op, 'put');
  assert.equal(google.calls[0].event!.status, 'confirmed');
  assert.equal(rows.get('a1')!.removed, false);
  assert.ok(rows.get('a1')!.syncedHash);
});

test('Google failures are recorded per row, never thrown, and retried by the next run', async () => {
  const { db, rows } = fakeDb(
    [appt('a1'), appt('a2'), appt('a3'), appt('a4'), appt('a5', { status: 'CANCELLED' })],
    [eventRow('a1', { attempts: 2, lastError: OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED }), eventRow('a5')],
  );
  const failures: Record<string, Error> = {
    [googleEventIdFor('a1')]: new GoogleCalendarError('retryable', 503),
    [googleEventIdFor('a3')]: new GoogleCalendarError('refused', 400),
    [googleEventIdFor('a4')]: new GoogleCalendarError('auth', 401),
    [googleEventIdFor('a5')]: new GoogleCalendarError('retryable'),
  };
  const failing = fakeGateway((call) => failures[call.id]);
  assert.deepEqual(await run(db, failing.gateway), { written: 1, deleted: 0, unchanged: 0, failed: 4 });
  assert.equal(rows.get('a1')!.attempts, 3);
  assert.equal(rows.get('a1')!.lastError, OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED);
  assert.equal(rows.get('a1')!.syncedHash, 'stale-hash', 'a failed write keeps the last written hash');
  assert.equal(rows.get('a2')!.lastError, null);
  assert.deepEqual(
    { attempts: rows.get('a3')!.attempts, lastError: rows.get('a3')!.lastError, syncedHash: rows.get('a3')!.syncedHash },
    { attempts: 1, lastError: OPERATIONS_MESSAGES.GOOGLE_PUSH_REFUSED, syncedHash: null },
  );
  assert.equal(rows.get('a4')!.lastError, OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED);
  assert.equal(rows.get('a5')!.removed, false, 'a failed delete is not marked removed');
  assert.equal(rows.get('a5')!.attempts, 1);

  // An hour later nothing changed in the bookings: the failed rows alone are retried.
  const ok = fakeGateway();
  const result = await load().pushGoogleCalendar({ db: db as never, gateway: ok.gateway as never, now: at(60) });
  assert.deepEqual(result, { written: 3, deleted: 1, unchanged: 0, failed: 0 });
  assert.deepEqual(ok.calls.map((call) => call.id).sort(), ['a1', 'a3', 'a4', 'a5'].map(googleEventIdFor).sort());
  for (const id of ['a1', 'a3', 'a4', 'a5']) {
    assert.equal(rows.get(id)!.attempts, 0, id);
    assert.equal(rows.get(id)!.lastError, null, id);
  }
});

test('after a failure an equal hash proves nothing (a timed-out PUT may have landed): the event is written again', async () => {
  const { db, rows } = fakeDb([appt('a1')]);
  const google = fakeGateway();
  await run(db, google.gateway);
  rows.get('a1')!.lastError = OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED;
  rows.get('a1')!.attempts = 1;
  assert.deepEqual(await run(db, google.gateway), { written: 1, deleted: 0, unchanged: 0, failed: 0 });
  assert.equal(google.calls.length, 2);
  assert.equal(rows.get('a1')!.lastError, null);
});

test('a cancelled booking whose event is already gone clears an old failure instead of retrying forever', async () => {
  const { db, rows } = fakeDb([appt('a1', { status: 'CANCELLED', updatedAt: at(-600) })], [
    eventRow('a1', { removed: true, syncedHash: null, attempts: 2, lastError: OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED }),
  ]);
  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway), { written: 0, deleted: 0, unchanged: 1, failed: 0 });
  assert.equal(google.calls.length, 0);
  assert.equal(rows.get('a1')!.lastError, null);
  assert.equal(rows.get('a1')!.attempts, 0);
});

test('a database write failing for one row is counted and the run goes on', async () => {
  const { db, rows } = fakeDb([appt('a1'), appt('a2')], [], { failWriteFor: 'a1' });
  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway), { written: 1, deleted: 0, unchanged: 0, failed: 1 });
  assert.ok(rows.get('a2')!.syncedHash);
});

test('recent mode picks changed, never written and failed bookings in the window; all mode re-renders the window', async () => {
  const { db } = fakeDb([
    appt('clean', { updatedAt: at(-60) }),
    appt('failed', { updatedAt: at(-60) }),
    appt('unwritten', { updatedAt: at(-60) }),
    appt('changed', { updatedAt: at(-5) }),
    appt('old', { updatedAt: at(-60), date: at(-8 * DAY) }),
    appt('cancelled', { updatedAt: at(-60), status: 'CANCELLED' }),
  ], [
    eventRow('clean'),
    eventRow('failed', { lastError: OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED, attempts: 1 }),
    eventRow('changed'),
  ]);
  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway), { written: 3, deleted: 0, unchanged: 0, failed: 0 });
  assert.deepEqual(google.calls.map((call) => call.id).sort(), ['failed', 'unwritten', 'changed'].map(googleEventIdFor).sort());

  const all = fakeGateway();
  assert.deepEqual(await run(db, all.gateway, { mode: 'all' }), { written: 1, deleted: 0, unchanged: 4, failed: 0 });
  assert.deepEqual(all.calls.map((call) => call.id), [googleEventIdFor('clean')]);
});

test('the window starts at salon-local midnight seven days back (DST-correct)', async () => {
  // 00:30 BST on 5 April 2099 is 23:30 UTC on 4 April; the window opens at
  // midnight on 29 March, which in 2099 is still GMT (00:00Z).
  const now = new Date('2099-04-04T23:30:00Z');
  const { db } = fakeDb([
    appt('inside', { date: new Date('2099-03-29T00:00:00Z'), updatedAt: now }),
    appt('outside', { date: new Date('2099-03-28T23:59:00Z'), updatedAt: now }),
  ]);
  const google = fakeGateway();
  await load().pushGoogleCalendar({ db: db as never, gateway: google.gateway as never, now });
  assert.deepEqual(google.calls.map((call) => call.id), [googleEventIdFor('inside')]);
});

test('appointmentIds pushes exactly those bookings', async () => {
  const { db } = fakeDb([appt('a1', { updatedAt: at(-600) }), appt('a2'), appt('a3', { updatedAt: at(-600) })], [eventRow('a1'), eventRow('a3')]);
  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway, { appointmentIds: ['a1'] }), { written: 1, deleted: 0, unchanged: 0, failed: 0 });
  assert.deepEqual(google.calls.map((call) => call.id), [googleEventIdFor('a1')]);
});

test('at most 100 bookings per run', async () => {
  const { db } = fakeDb(Array.from({ length: 105 }, (_, index) => appt(`a${index}`)));
  const google = fakeGateway();
  const result = await run(db, google.gateway);
  assert.equal(result.written, 100);
  assert.equal(google.calls.length, 100);
});

test('all mode deletes the Google copies of appointments that ended more than 12 months ago', async () => {
  const yearAgo = new Date('2098-09-01T12:00:00Z');
  const { db, rows } = fakeDb([
    appt('ended', { date: new Date(yearAgo.getTime() - 120 * 60_000), updatedAt: at(-DAY * 300) }),
    appt('endsAfterCutoff', { date: new Date(yearAgo.getTime() - 30 * 60_000), updatedAt: at(-DAY * 300) }),
    appt('recentPast', { date: at(-DAY * 330), updatedAt: at(-DAY * 300) }),
    appt('alreadyRemoved', { date: at(-DAY * 400), updatedAt: at(-DAY * 300) }),
  ], [eventRow('ended'), eventRow('endsAfterCutoff'), eventRow('recentPast'), eventRow('alreadyRemoved', { removed: true, syncedHash: null })]);

  const recent = fakeGateway();
  assert.deepEqual(await run(db, recent.gateway), { written: 0, deleted: 0, unchanged: 0, failed: 0 });
  assert.equal(recent.calls.length, 0, 'retention runs in all mode only');

  const google = fakeGateway();
  assert.deepEqual(await run(db, google.gateway, { mode: 'all' }), { written: 0, deleted: 1, unchanged: 0, failed: 0 });
  assert.deepEqual(google.calls, [{ op: 'delete', id: googleEventIdFor('ended') }]);
  assert.equal(rows.get('ended')!.removed, true);
  assert.equal(rows.get('ended')!.syncedHash, null);
  assert.equal(rows.get('endsAfterCutoff')!.removed, false);
  assert.equal(rows.get('recentPast')!.removed, false);
});
