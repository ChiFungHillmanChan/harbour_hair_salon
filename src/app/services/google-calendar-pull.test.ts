import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';
import { googleEventIdFor, GOOGLE_APPOINTMENT_PROPERTY } from './google-calendar-event';
import { googleBusyBlocks, googleBusyHash } from './google-busy-mapping';
import { diaryEntriesFrom } from './google-diary-classify';
import { renderAppointment, type PushAppointment } from './google-calendar-push';
import { OPERATIONS_MESSAGES } from './operations-messages';

const NOW = new Date('2099-09-01T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const DAY = 24 * 60;
const CONFIG = { calendarId: 'cal@group.calendar.google.com', clientEmail: 'sa@harbour.iam.gserviceaccount.com', privateKey: 'k', webhookSecret: 's' };
const STYLISTS = [
  { id: 's1', name: 'Ivan', isActive: true, googleColorId: '1', googleAliases: null },
  { id: 's2', name: 'Lox', isActive: true, googleColorId: '5', googleAliases: 'L' },
  { id: 's3', name: 'Chan', isActive: false, googleColorId: null, googleAliases: null },
];
const ACTIVE = STYLISTS.filter((stylist) => stylist.isActive);
const CONFIG_DIARY = { stylists: ACTIVE.map(({ id, name, googleColorId, googleAliases }) => ({ id, name, googleColorId, googleAliases })), unassignedColorId: '11', leaveColorId: '8' };

type EventRow = {
  appointmentId: string; eventId: string; syncedHash: string | null; syncedAt: Date | null;
  removed: boolean; attempts: number; lastError: string | null;
};
type Appt = {
  id: string; date: Date; status: string; notes: string | null; durationAtBooking: number | null;
  user: { name: string | null; phone: string | null; email: string };
  stylist: { id: string; name: string; googleColorId: string | null };
  service: { id: string; name: string; duration: number };
  paymentAttempt: null;
};
type Block = { source: string; stylistId: string; externalUid: string; start: Date; end: Date; summary: string | null; lastSyncAt: Date };
type Diary = { id: string; googleEventId: string; kind: string; stylistIdsJson: string; title: string; colorId: string | null; start: Date; end: Date; allDay: boolean; htmlLink: string | null; lastSyncAt: Date };
type State = {
  id: string; channelId: string | null; resourceId: string | null; channelExpiresAt: Date | null;
  lastPullAt: Date | null; lastPullSuccessAt: Date | null; lastPullError: string | null; busyHash: string | null;
};

/** A booking tomorrow at 13:00 (BST). */
function appt(id: string, overrides: Partial<Appt> = {}): Appt {
  return {
    id, date: at(DAY), status: 'CONFIRMED', notes: null, durationAtBooking: 60,
    user: { name: 'Amy Lee', phone: '07700 900123', email: `${id}@example.test` },
    stylist: { id: 's1', name: 'Ivan', googleColorId: '1' }, service: { id: 'svc', name: 'Haircut', duration: 45 }, paymentAttempt: null,
    ...overrides,
  };
}

/** What the website writes for this booking (English salon, the default no-stylist colour). */
function rendered(appointment: Appt) {
  return renderAppointment(
    { ...appointment, googleCalendarEvent: null } as unknown as PushAppointment,
    { locale: 'en-GB', unassignedColorId: '11', serviceFields: new Map() },
  );
}

function foreign(id: string, summary: string, startMin: number, endMin: number, extra: Partial<GoogleEvent> = {}): GoogleEvent {
  return { id, status: 'confirmed', summary, start: { dateTime: at(startMin).toISOString() }, end: { dateTime: at(endMin).toISOString() }, ...extra };
}

function block(overrides: Partial<Block> & Pick<Block, 'externalUid'>): Block {
  return { source: 'GOOGLE', stylistId: 's1', start: at(60), end: at(120), summary: null, lastSyncAt: at(-DAY), ...overrides };
}

/** The Prisma filters the pull uses: equality, null, `is`, `not`, `in`, `gte`, `gt`, `lt`, `lte`, `OR`, nested relations. */
function matches(record: unknown, where: Record<string, unknown>): boolean {
  if (!record || typeof record !== 'object') return false;
  const row = record as Record<string, unknown>;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Record<string, unknown>[]).some((part) => matches(row, part));
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition !== 'object') return value === condition;
    const ops = condition as Record<string, unknown>;
    if ('is' in ops) return ops.is === null ? value == null : value != null && matches(value, ops.is as Record<string, unknown>);
    return Object.entries(ops).every(([op, operand]) => {
      if (op === 'in') return (operand as unknown[]).includes(value);
      if (op === 'not') return operand === null ? value != null : value !== operand;
      const [a, b] = [value instanceof Date ? value.getTime() : value, operand instanceof Date ? operand.getTime() : operand] as [number, number];
      if (op === 'gte') return a >= b;
      if (op === 'gt') return a > b;
      if (op === 'lt') return a < b;
      if (op === 'lte') return a <= b;
      throw new Error(`unsupported operator ${op}`);
    });
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
  options: {
    events?: EventRow[]; blocks?: Block[]; diary?: Diary[]; state?: Partial<State>;
    failCreate?: boolean; failDiaryCreate?: boolean; failStateWrite?: boolean;
  } = {},
) {
  const rows = new Map((options.events ?? []).map((row) => [row.appointmentId, { ...row }]));
  let blocks: Block[] = (options.blocks ?? []).map((row) => ({ ...row }));
  let diary: Diary[] = (options.diary ?? []).map((row) => ({ ...row }));
  let diarySeq = 0;
  const emptyState: State = {
    id: 'singleton', channelId: null, resourceId: null, channelExpiresAt: null,
    lastPullAt: null, lastPullSuccessAt: null, lastPullError: null, busyHash: null,
  };
  let state: State | null = options.state ? { ...emptyState, ...options.state } : null;
  const log = { transactions: 0, appointmentQueries: 0, blockReads: 0, createBatches: [] as number[] };
  const db = {
    appointment: {
      async findMany(args: { where: Record<string, unknown> }) {
        log.appointmentQueries += 1;
        return appointments
          .map((a) => ({ ...structuredClone(a), googleCalendarEvent: rows.has(a.id) ? { ...rows.get(a.id)! } : null }))
          .filter((a) => matches(a, args.where));
      },
    },
    googleCalendarEvent: {
      async upsert(args: { where: { appointmentId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        const existing = rows.get(args.where.appointmentId);
        if (existing) {
          applyData(existing as unknown as Record<string, unknown>, args.update);
        } else {
          rows.set(args.where.appointmentId, { syncedHash: null, syncedAt: null, removed: false, attempts: 0, lastError: null, ...args.create } as unknown as EventRow);
        }
      },
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        const hits = [...rows.values()].filter((row) => matches(row, args.where));
        for (const row of hits) applyData(row as unknown as Record<string, unknown>, args.data);
        return { count: hits.length };
      },
    },
    siteSettings: { async findUnique() { return { salonNotificationLocale: 'en-GB' }; } },
    stylist: {
      async findMany(args: { where?: { isActive?: boolean } } = {}) {
        const list = args.where?.isActive === undefined ? STYLISTS : STYLISTS.filter((s) => s.isActive === args.where!.isActive);
        return list.map(({ id, name, googleColorId, googleAliases }) => ({ id, name, googleColorId, googleAliases }));
      },
    },
    contentTranslation: { async findMany() { return []; } },
    externalBusyBlock: {
      async findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }) {
        log.blockReads += 1;
        return blocks.filter((row) => matches(row, args.where)).map((row) => Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key as keyof Block]])));
      },
      async deleteMany(args: { where: Record<string, unknown> }) {
        const before = blocks.length;
        blocks = blocks.filter((row) => !matches(row, args.where));
        return { count: before - blocks.length };
      },
      async createMany(args: { data: Block[] }) {
        if (options.failCreate) throw new Error('database unavailable');
        log.createBatches.push(args.data.length);
        for (const row of args.data) {
          if (blocks.some((b) => b.source === row.source && b.stylistId === row.stylistId && b.externalUid === row.externalUid)) {
            throw new Error('Unique constraint failed on (source, stylistId, externalUid)');
          }
          blocks.push({ ...row });
        }
        return { count: args.data.length };
      },
    },
    googleDiaryEntry: {
      async findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }) {
        return diary.filter((row) => matches(row, args.where)).map((row) => Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key as keyof Diary]])));
      },
      async deleteMany(args: { where: Record<string, unknown> }) {
        const before = diary.length;
        diary = diary.filter((row) => !matches(row, args.where));
        return { count: before - diary.length };
      },
      async createMany(args: { data: Omit<Diary, 'id'>[] }) {
        if (options.failDiaryCreate) throw new Error('database unavailable');
        for (const row of args.data) {
          if (diary.some((d) => d.googleEventId === row.googleEventId)) throw new Error('Unique constraint failed on (googleEventId)');
          diary.push({ id: `d${++diarySeq}`, ...row });
        }
        return { count: args.data.length };
      },
    },
    googleCalendarSyncState: {
      async findUnique() { return state ? { ...state } : null; },
      async upsert(args: { where: { id: string }; create: Partial<State>; update: Partial<State> }) {
        if (options.failStateWrite) throw new Error('database unavailable');
        if (state) applyData(state as unknown as Record<string, unknown>, args.update);
        else state = { ...emptyState, ...args.create };
      },
    },
    /** All or nothing, like the real one. */
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      log.transactions += 1;
      const saved = { blocks: blocks.map((row) => ({ ...row })), state: state ? { ...state } : null, diary: diary.map((row) => ({ ...row })) };
      try {
        return await fn(db);
      } catch (error) {
        blocks = saved.blocks;
        state = saved.state;
        diary = saved.diary;
        throw error;
      }
    },
  };
  return {
    db, rows, log,
    get blocks() { return blocks; },
    get state() { return state; },
    get diary() { return diary; },
  };
}

type Call = { op: 'put' | 'insert' | 'delete'; id: string; event?: GoogleEvent };

/** `listing` is what Google lists (deleted events included); `fail` answers a write with an error to throw. */
function fakeGoogle(listing: GoogleEvent[], fail: (call: Call) => Error | undefined = () => undefined) {
  const google = {
    listing,
    listError: null as Error | null,
    lists: [] as { timeMin: Date; timeMax: Date }[],
    calls: [] as Call[],
    gateway: {
      async listEvents(window: { timeMin: Date; timeMax: Date }) {
        google.lists.push(window);
        if (google.listError) throw google.listError;
        return structuredClone(google.listing);
      },
      async putEvent(event: GoogleEvent) { await write({ op: 'put', id: event.id, event }); return event; },
      async insertEvent(event: GoogleEvent) { await write({ op: 'insert', id: event.id, event }); return event; },
      async deleteEvent(id: string) { await write({ op: 'delete', id }); },
    },
  };
  async function write(call: Call) {
    google.calls.push(call);
    const error = fail(call);
    if (error) throw error;
  }
  return google;
}

/** Any property read throws: proves nothing touched the database. */
const untouchable = new Proxy({}, { get(_target, key) { throw new Error(`database touched: ${String(key)}`); } });

/** Calendars the pull asked the change guard about (services/google-calendar-guard.ts). */
const guardCalls: string[] = [];

function load(config: typeof CONFIG | null = CONFIG) {
  const invalidations = { count: 0 };
  const pull = loadServerModule<typeof import('./google-calendar-pull')>('src/app/services/google-calendar-pull.ts', {
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => config },
    '@/app/lib/prisma': untouchable,
    './stylist-ical-cache': { invalidateStylistIcalFeedFromCron: () => { invalidations.count += 1; } },
    './google-calendar-guard': { guardGoogleCalendarChange: async (_db: unknown, calendarId: string) => { guardCalls.push(calendarId); return 'same'; } },
  });
  return { pull, invalidations };
}

function run(pull: ReturnType<typeof load>['pull'], db: unknown, gateway: unknown, now = NOW) {
  return pull.pullGoogleCalendar({ db: db as never, gateway: gateway as never, now });
}

const EMPTY_HASH = googleBusyHash([]);

test('sync switched off: nothing is read, nothing is listed', async () => {
  const google = fakeGoogle([foreign('e1', 'Ivan: dentist', 60, 120)]);
  const { pull, invalidations } = load(null);
  assert.deepEqual(await run(pull, untouchable, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, skipped: 'disabled' });
  // Without an injected client the default one is never imported either.
  assert.deepEqual(await pull.pullGoogleCalendar({ gateway: google.gateway as never }), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, skipped: 'disabled' });
  assert.equal(google.lists.length, 0);
  assert.equal(invalidations.count, 0);
});

test('the pull runs the calendar change guard first; switched off, it never does', async () => {
  guardCalls.length = 0;
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([]);
  await run(load().pull, store.db, google.gateway);
  assert.deepEqual(guardCalls, [CONFIG.calendarId]);
  guardCalls.length = 0;
  await run(load(null).pull, untouchable, google.gateway);
  assert.deepEqual(guardCalls, []);
});

test('website events are never busy blocks, whatever their state', async () => {
  const live = appt('a1');
  const cancelled = appt('a2', { status: 'CANCELLED' });
  const store = fakeDb([live, cancelled]);
  const google = fakeGoogle([
    rendered(live).event,
    { ...rendered(cancelled).event, status: 'cancelled' },
    // A booking the database no longer has, and a copy of a1 made in Google (another id, our property).
    { ...foreign(googleEventIdFor('gone'), 'Lox · Ben · Colour', 60, 120), extendedProperties: { private: { [GOOGLE_APPOINTMENT_PROPERTY]: 'gone' } } },
    { ...rendered(live).event, id: 'copyofa1', start: { dateTime: at(DAY + 120).toISOString() }, end: { dateTime: at(DAY + 180).toISOString() } },
  ]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(store.blocks, []);
  assert.deepEqual(google.calls, [], 'equal, already deleted, unknown or copied website events need no write');
  assert.equal(store.log.transactions, 0, 'no busy time, none stored: nothing to write');
});

test('a website event moved in Google is written back once; the next pull finds it equal and writes nothing', async () => {
  const booking = appt('a1');
  const expected = rendered(booking);
  const moved = { ...expected.event, start: { dateTime: at(DAY + 60).toISOString() }, end: { dateTime: at(DAY + 120).toISOString() } };
  const store = fakeDb([booking], { events: [{ appointmentId: 'a1', eventId: expected.event.id, syncedHash: expected.hash, syncedAt: at(-DAY), removed: false, attempts: 0, lastError: null }], state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([moved]);
  const { pull, invalidations } = load();

  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 1);
  assert.equal(google.calls[0].op, 'put');
  assert.deepEqual(google.calls[0].event, expected.event);
  const row = store.rows.get('a1')!;
  assert.deepEqual(
    { syncedHash: row.syncedHash, syncedAt: row.syncedAt, removed: row.removed, attempts: row.attempts, lastError: row.lastError },
    { syncedHash: expected.hash, syncedAt: NOW, removed: false, attempts: 0, lastError: null },
  );

  // Our own write comes back as a change notification: Google now lists the reverted event.
  google.listing = [google.calls[0].event!];
  assert.deepEqual(await run(pull, store.db, google.gateway, at(1)), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 1, 'the revert is idempotent');
  assert.equal(store.log.transactions, 0);
  assert.equal(invalidations.count, 0);
});

test('a website event deleted in Google while its booking is open is put back; an edited request is too', async () => {
  const confirmed = appt('a1');
  const request = appt('a2', { status: 'PENDING' });
  const completed = appt('a3', { status: 'COMPLETED', date: at(-60) });
  const store = fakeDb([confirmed, request, completed], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([
    { ...rendered(confirmed).event, status: 'cancelled' },
    { ...rendered(request).event, summary: 'Ivan · Amy Lee · Haircut (moved to Friday?)' },
    { ...rendered(completed).event, description: 'cleared by staff' },
  ]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 3, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(google.calls.map((call) => [call.op, call.id]), [
    ['put', googleEventIdFor('a1')], ['put', googleEventIdFor('a2')], ['put', googleEventIdFor('a3')],
  ]);
  assert.equal(google.calls[0].event!.status, 'confirmed');
  assert.deepEqual(google.calls[0].event, rendered(confirmed).event);
  assert.deepEqual(google.calls[1].event, rendered(request).event);
  assert.deepEqual(google.calls[2].event, rendered(completed).event);
  assert.equal(store.rows.get('a1')!.syncedHash, rendered(confirmed).hash);
  assert.equal(store.log.appointmentQueries, 1, 'the bookings are loaded in one query');
});

test('a cancelled booking\'s event restored in Google is deleted again; bookings outside the window are left alone', async () => {
  const cancelled = appt('a1', { status: 'CANCELLED' });
  const gone = appt('a2', { status: 'CANCELLED' });
  const old = appt('a3', { date: at(-8 * DAY) });
  const store = fakeDb([cancelled, gone, old], {
    events: [{ appointmentId: 'a1', eventId: googleEventIdFor('a1'), syncedHash: null, syncedAt: at(-DAY), removed: true, attempts: 0, lastError: null }],
    state: { busyHash: EMPTY_HASH },
  });
  const google = fakeGoogle([
    rendered(appt('a1')).event,
    { ...rendered(appt('a2')).event, status: 'cancelled' },
    // Staff dragged an old booking's event into this week: it is past the outbound window.
    { ...rendered(old).event, start: { dateTime: at(DAY).toISOString() }, end: { dateTime: at(DAY + 60).toISOString() } },
  ]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(google.calls, [{ op: 'delete', id: googleEventIdFor('a1') }]);
  const row = store.rows.get('a1')!;
  assert.deepEqual({ removed: row.removed, syncedHash: row.syncedHash, syncedAt: row.syncedAt, lastError: row.lastError }, { removed: true, syncedHash: null, syncedAt: NOW, lastError: null });
  assert.equal(store.rows.has('a2'), false);
  assert.equal(store.rows.has('a3'), false);
});

test('a Google-only "Ivan: dentist" blocks Ivan alone; an unchanged second pull opens no transaction', async () => {
  const store = fakeDb([]);
  const listing = [foreign('evt-dentist', 'Ivan: dentist', 60, 120)];
  const google = fakeGoogle(listing);
  const { pull, invalidations } = load();

  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 1, entries: 1, changed: true, diaryChanged: true });
  assert.deepEqual(google.lists, [{ timeMin: at(-30 * DAY), timeMax: at(90 * DAY) }]);
  assert.equal(store.blocks.length, 1);
  const [stored] = store.blocks;
  assert.deepEqual(
    { source: stored.source, stylistId: stored.stylistId, start: stored.start, end: stored.end, summary: stored.summary, lastSyncAt: stored.lastSyncAt },
    { source: 'GOOGLE', stylistId: 's1', start: at(60), end: at(120), summary: null, lastSyncAt: NOW },
  );
  assert.equal(stored.externalUid, googleBusyBlocks(diaryEntriesFrom(listing, CONFIG_DIARY))[0].externalUid);
  assert.equal(store.log.transactions, 1);
  assert.equal(invalidations.count, 1, 'the busy feeds are dropped after the commit');
  assert.equal(store.state!.busyHash, googleBusyHash(googleBusyBlocks(diaryEntriesFrom(listing, CONFIG_DIARY))));
  assert.deepEqual(
    { lastPullAt: store.state!.lastPullAt, lastPullSuccessAt: store.state!.lastPullSuccessAt, lastPullError: store.state!.lastPullError },
    { lastPullAt: NOW, lastPullSuccessAt: NOW, lastPullError: null },
  );

  const later = at(30);
  assert.deepEqual(await run(pull, store.db, google.gateway, later), { reverted: 0, blocks: 1, entries: 1, changed: false, diaryChanged: false });
  assert.equal(store.log.transactions, 1, 'an equal hash writes nothing');
  assert.equal(invalidations.count, 1);
  assert.equal(store.blocks[0].lastSyncAt.getTime(), NOW.getTime());
  assert.equal(store.state!.lastPullSuccessAt!.getTime(), later.getTime());
});

test('only busy time that has not ended counts: an event ending, or leaving Google after it ended, rewrites no busy time and keeps the feeds cached', async () => {
  // Stored by an earlier pull: one block that ended an hour ago, one to come.
  const listing = [foreign('ended', 'Ivan: dentist', -120, -60), foreign('coming', 'Lox: lunch', 60, 120)];
  const store = fakeDb([]);
  const google = fakeGoogle(listing);
  const { pull, invalidations } = load();
  assert.equal((await run(pull, store.db, google.gateway, at(-180))).changed, true);
  assert.equal(store.blocks.length, 2);
  assert.equal(invalidations.count, 1);

  // Later: the ended event is deleted in Google after the fact. The diary drops it; the busy time is not rewritten.
  google.listing = [listing[1]];
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 1, entries: 1, changed: false, diaryChanged: true });
  assert.deepEqual(store.log.createBatches, [2], 'no second busy write');
  assert.equal(invalidations.count, 1, 'Fresha\'s next poll is not turned into a database wake');

  // The block to come ends while Google still lists it: still nothing to write.
  assert.equal((await run(pull, store.db, google.gateway, at(121))).changed, false);
  assert.equal(invalidations.count, 1);

  // Busy time still to come changes: written and the feeds dropped.
  google.listing = [foreign('coming', 'Lox: lunch', 60, 150)];
  assert.equal((await run(pull, store.db, google.gateway)).changed, true);
  assert.deepEqual(store.log.createBatches, [2, 1]);
  assert.equal(invalidations.count, 2);
  assert.equal(store.blocks.find((row) => row.externalUid === googleBusyBlocks(diaryEntriesFrom(google.listing, CONFIG_DIARY))[0].externalUid)!.end.getTime(), at(150).getTime());
});

test('blocks deleted outside the pull ("Clear Google busy time") are stored again by the next pull while the sync is on', async () => {
  const listing = [foreign('evt1', 'Ivan: dentist', 60, 120)];
  // The hash says nothing changed, but the rows are gone: the rows decide.
  const store = fakeDb([], { state: { busyHash: googleBusyHash(googleBusyBlocks(diaryEntriesFrom(listing, CONFIG_DIARY))) } });
  const google = fakeGoogle(listing);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 1, entries: 1, changed: true, diaryChanged: true });
  assert.equal(store.blocks.length, 1);
});

test('an event naming no stylist is a note and blocks nothing; a cancelled one is not stored at all', async () => {
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([
    foreign('training', 'Salon training', 60, 180),
    foreign('called-off', 'Lox: dentist', 60, 90, { status: 'cancelled' }),
  ]);
  const { pull } = load();
  const result = await run(pull, store.db, google.gateway);
  assert.deepEqual([result.blocks, result.entries, result.changed, result.diaryChanged], [0, 1, false, true]);
  assert.deepEqual(store.blocks, []);
  assert.deepEqual(store.diary.map((row) => [row.googleEventId, row.kind]), [['training', 'NOTE']]);
});

test('the diary is stored with its kinds; only STYLIST and LEAVE entries become busy blocks', async () => {
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([
    foreign('amy', 'Amy 07700 900123', 60, 120, { colorId: '1', htmlLink: 'https://www.google.com/calendar/event?eid=YW15' }),
    foreign('walkin', 'Cut - Erin(W)', 60, 120, { colorId: '11' }),
    foreign('late', '遲返 (L)', 0, 60, { colorId: '8' }),
    foreign('note', '卡機', 30, 60, { colorId: '8' }),
  ]);
  const { pull, invalidations } = load();
  const result = await run(pull, store.db, google.gateway);
  assert.deepEqual(result, { reverted: 0, blocks: 2, entries: 4, changed: true, diaryChanged: true });
  assert.deepEqual(store.blocks.map((row) => row.stylistId).sort(), ['s1', 's2']);
  assert.deepEqual(store.diary.map((row) => [row.googleEventId, row.kind, JSON.parse(row.stylistIdsJson), row.title, row.colorId]).sort(), [
    ['amy', 'STYLIST', ['s1'], 'Amy 07700 900123', '1'],
    ['late', 'LEAVE', ['s2'], '遲返 (L)', '8'],
    ['note', 'NOTE', [], '卡機', '8'],
    ['walkin', 'UNASSIGNED', [], 'Cut - Erin(W)', '11'],
  ]);
  assert.equal(store.diary.find((row) => row.googleEventId === 'amy')!.htmlLink, 'https://www.google.com/calendar/event?eid=YW15');
  assert.equal(store.log.transactions, 1, 'busy time and diary in one transaction');
  assert.equal(invalidations.count, 1);
});

test('a transparent all-day leave blocks Lox (transparency is ignored)', async () => {
  const tomorrow = new Date(NOW.getTime() + DAY * 60_000).toISOString().slice(0, 10);
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([{ id: 'loxoff', status: 'confirmed', summary: 'LoxOff', colorId: '8', transparency: 'transparent', start: { date: tomorrow } }]);
  const { pull } = load();
  assert.equal((await run(pull, store.db, google.gateway)).blocks, 1);
  assert.deepEqual(store.blocks.map((row) => row.stylistId), ['s2']);
  assert.equal(store.diary[0].allDay, true);
});

test('a renamed walk-in rewrites the diary but not the busy time, and the busy feeds stay cached', async () => {
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([foreign('walkin', 'Walk-in', 60, 120, { colorId: '11' })]);
  const { pull, invalidations } = load();
  await run(pull, store.db, google.gateway);
  google.listing = [foreign('walkin', 'Walk-in Mrs Chan', 60, 120, { colorId: '11' })];
  const second = await run(pull, store.db, google.gateway, at(1));
  assert.deepEqual([second.changed, second.diaryChanged], [false, true]);
  assert.equal(store.diary[0].title, 'Walk-in Mrs Chan');
  assert.equal(invalidations.count, 0, 'no busy block changed');
  // Unchanged third pull: no transaction at all.
  const transactions = store.log.transactions;
  assert.deepEqual(await run(pull, store.db, google.gateway, at(2)), { reverted: 0, blocks: 0, entries: 1, changed: false, diaryChanged: false });
  assert.equal(store.log.transactions, transactions);
});

test('the listing starts 30 days back; entries that ended before that are deleted', async () => {
  const old = { id: 'old', googleEventId: 'old', kind: 'NOTE', stylistIdsJson: '[]', title: 'old', colorId: null, start: at(-32 * DAY), end: at(-31 * DAY), allDay: false, htmlLink: null, lastSyncAt: at(-31 * DAY) };
  const recent = { ...old, id: 'recent', googleEventId: 'recent', start: at(-29 * DAY), end: at(-29 * DAY + 60) };
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH }, diary: [old, recent] });
  const google = fakeGoogle([foreign('recent', 'old', -29 * DAY, -29 * DAY + 60)]);
  const { pull } = load();
  await run(pull, store.db, google.gateway);
  assert.equal(google.lists[0].timeMin.getTime(), at(-30 * DAY).getTime());
  assert.equal(google.lists[0].timeMax.getTime(), at(90 * DAY).getTime());
  assert.deepEqual(store.diary.map((row) => row.googleEventId), ['recent']);
});

test('a failure writing the diary rolls the busy time back with it', async () => {
  const store = fakeDb([], { state: { busyHash: EMPTY_HASH }, failDiaryCreate: true });
  const google = fakeGoogle([foreign('evt1', 'Ivan off', 60, 120)]);
  const { pull } = load();
  const result = await run(pull, store.db, google.gateway);
  assert.equal(result.failed, true);
  assert.deepEqual([store.blocks, store.diary], [[], []]);
  assert.equal(store.state!.lastPullError, OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED);
});

test('the replace swaps every GOOGLE block in the window at once; other sources and older GOOGLE blocks stay', async () => {
  const listing = [foreign('evt1', 'Ivan: dentist', 60, 120)];
  const [fresh] = googleBusyBlocks(diaryEntriesFrom(listing, CONFIG_DIARY));
  const store = fakeDb([], {
    blocks: [
      block({ externalUid: 'stale', start: at(DAY), end: at(DAY + 60) }),
      block({ externalUid: 'far', start: at(89 * DAY), end: at(89 * DAY + 60), stylistId: 's2' }),
      block({ externalUid: 'history', start: at(-3 * DAY), end: at(-3 * DAY + 60) }),
      // The same event once stored in the past, now moved into the window: no duplicate key.
      block({ externalUid: fresh.externalUid, start: at(-2 * DAY), end: at(-2 * DAY + 60) }),
      block({ externalUid: 'fresha-1', source: 'FRESHA', start: at(DAY), end: at(DAY + 60), summary: 'Fresha Blocked Time' }),
    ],
    state: { busyHash: 'previous' },
  });
  const google = fakeGoogle(listing);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 1, entries: 1, changed: true, diaryChanged: true });
  assert.deepEqual(store.blocks.map((row) => `${row.source}:${row.externalUid}`).sort(), [
    'FRESHA:fresha-1', `GOOGLE:${fresh.externalUid}`, 'GOOGLE:history',
  ].sort());
  assert.equal(store.blocks.find((row) => row.externalUid === fresh.externalUid)!.start.getTime(), at(60).getTime());
  assert.equal(store.log.transactions, 1);
});

test('a failing listing is recorded, never thrown; stored busy time is kept', async () => {
  const earlier = at(-120);
  const kept = block({ externalUid: 'kept' });
  const store = fakeDb([], { blocks: [kept], state: { busyHash: 'h', lastPullAt: earlier, lastPullSuccessAt: earlier } });
  const google = fakeGoogle([]);
  google.listError = new GoogleCalendarError('retryable', 503);
  const { pull, invalidations } = load();

  // Reported as failed too, so the job running it (google-calendar-job.ts) records the failure.
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, failed: true });
  assert.deepEqual(
    { lastPullAt: store.state!.lastPullAt, lastPullSuccessAt: store.state!.lastPullSuccessAt, lastPullError: store.state!.lastPullError, busyHash: store.state!.busyHash },
    { lastPullAt: NOW, lastPullSuccessAt: earlier, lastPullError: OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED, busyHash: 'h' },
  );
  assert.deepEqual(store.blocks, [kept]);
  assert.equal(store.log.transactions, 0);
  assert.equal(invalidations.count, 0);

  // Google is back: the next pull succeeds and clears the error.
  google.listError = null;
  const later = at(30);
  assert.equal((await run(pull, store.db, google.gateway, later)).failed, undefined);
  assert.deepEqual(
    { lastPullAt: store.state!.lastPullAt, lastPullSuccessAt: store.state!.lastPullSuccessAt, lastPullError: store.state!.lastPullError },
    { lastPullAt: later, lastPullSuccessAt: later, lastPullError: null },
  );
});

test('a database failure in the replace rolls it back and is recorded; even a failing state write never throws', async () => {
  const kept = block({ externalUid: 'kept' });
  const store = fakeDb([], { blocks: [kept], state: { busyHash: 'h' }, failCreate: true });
  const google = fakeGoogle([foreign('evt1', 'Ivan: dentist', 60, 120)]);
  const { pull, invalidations } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, failed: true });
  assert.deepEqual(store.blocks, [kept]);
  assert.equal(store.state!.busyHash, 'h');
  assert.equal(store.state!.lastPullError, OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED);
  assert.equal(invalidations.count, 0);

  const broken = fakeDb([], { failStateWrite: true });
  const failing = fakeGoogle([]);
  failing.listError = new GoogleCalendarError('auth', 401);
  assert.deepEqual(await run(pull, broken.db, failing.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, failed: true });
});

test('a revert Google fails is recorded on the booking\'s row for the push to retry; the pull itself succeeds', async () => {
  const first = appt('a1');
  const second = appt('a2');
  const store = fakeDb([first, second], { state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle(
    [first, second].map((booking) => ({ ...rendered(booking).event, summary: 'edited' })),
    (call) => (call.id === googleEventIdFor('a1') ? new GoogleCalendarError('retryable', 503) : undefined),
  );
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(
    { attempts: store.rows.get('a1')!.attempts, lastError: store.rows.get('a1')!.lastError },
    { attempts: 1, lastError: OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED },
  );
  assert.equal(store.rows.get('a2')!.syncedHash, rendered(second).hash);
  assert.deepEqual(
    { lastPullSuccessAt: store.state!.lastPullSuccessAt, lastPullError: store.state!.lastPullError },
    { lastPullSuccessAt: NOW, lastPullError: null },
  );
});

function syncedRow(booking: Appt, overrides: Partial<EventRow> = {}): EventRow {
  const { event, hash } = rendered(booking);
  return { appointmentId: booking.id, eventId: event.id, syncedHash: hash, syncedAt: at(-DAY), removed: false, attempts: 0, lastError: null, ...overrides };
}

test('a synced open booking missing from the listing (deleted, purged or moved away in Google) is written back', async () => {
  const missing = appt('a1');
  const neverWritten = appt('a2');
  const removed = appt('a3');
  // Before the listed range (30 days back): absent from the listing whether or not it was deleted, so left alone.
  const earlier = appt('a4', { date: at(-31 * DAY) });
  const cancelled = appt('a5', { status: 'CANCELLED' });
  const store = fakeDb([missing, neverWritten, removed, earlier, cancelled], {
    events: [syncedRow(missing), syncedRow(removed, { removed: true, syncedHash: null }), syncedRow(earlier), syncedRow(cancelled)],
    state: { busyHash: EMPTY_HASH },
  });
  const google = fakeGoogle([]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 1);
  assert.equal(google.calls[0].op, 'put');
  assert.deepEqual(google.calls[0].event, rendered(missing).event);
  assert.equal(store.rows.get('a1')!.syncedAt!.getTime(), NOW.getTime());
  assert.equal(store.log.appointmentQueries, 1);
});

// The listing reaches 30 days back, the push only 7 (windowStart): a booking between the two is
// neither loaded nor written back, so a pull never reads a month of bookings to discard them.
test('a synced open booking missing from the listing is written back within the push window (3 days back), never before it (10 days back)', async () => {
  const recent = appt('a1', { date: at(-3 * DAY) });
  const older = appt('a2', { date: at(-10 * DAY) });
  const store = fakeDb([recent, older], { events: [syncedRow(recent), syncedRow(older)], state: { busyHash: EMPTY_HASH } });
  const loaded: string[] = [];
  const findMany = store.db.appointment.findMany;
  store.db.appointment.findMany = async (args) => {
    const found = await findMany(args);
    loaded.push(...found.map((row) => row.id));
    return found;
  };
  const google = fakeGoogle([]);
  assert.deepEqual(await run(load().pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(google.calls.map((call) => [call.op, call.id]), [['put', googleEventIdFor('a1')]]);
  assert.deepEqual(google.calls[0].event, rendered(recent).event);
  assert.equal(store.rows.get('a1')!.syncedAt!.getTime(), NOW.getTime());
  assert.equal(store.rows.get('a2')!.syncedAt!.getTime(), at(-DAY).getTime(), 'the older row is untouched');
  assert.deepEqual(loaded, ['a1'], 'the booking before the push window is not even loaded');
});

test('a website event whose private property was stripped in Google is written back, and is never busy time', async () => {
  const booking = appt('a1');
  const expected = rendered(booking);
  const stripped = { ...expected.event, extendedProperties: undefined };
  const store = fakeDb([booking], { events: [syncedRow(booking)] });
  const google = fakeGoogle([stripped]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(store.blocks, [], 'its id gives it away: no block, no clash with itself');
  assert.deepEqual(google.calls.map((call) => [call.op, call.id]), [['put', googleEventIdFor('a1')]]);
  assert.deepEqual(google.calls[0].event!.extendedProperties, { private: { [GOOGLE_APPOINTMENT_PROPERTY]: 'a1' } });
  // Written back: the next pull finds it equal.
  google.listing = [google.calls[0].event!];
  store.rows.get('a1')!.syncedAt = at(-60);
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 1);
});

test('a website event listed as a bare deleted id is put back', async () => {
  const booking = appt('a1', { date: at(2 * DAY) });
  const store = fakeDb([booking], { events: [syncedRow(booking)], state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([{ id: googleEventIdFor('a1'), status: 'cancelled' }]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(google.calls.map((call) => [call.op, call.id]), [['put', googleEventIdFor('a1')]]);
  assert.equal(google.calls[0].event!.status, 'confirmed');
});

test('a website event recoloured in Google is put back in its stylist’s colour', async () => {
  const booking = appt('a1');
  const expected = rendered(booking);
  const store = fakeDb([booking], { events: [syncedRow(booking)], state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([{ ...expected.event, colorId: '11' }]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(google.calls.map((call) => [call.op, call.id]), [['put', googleEventIdFor('a1')]]);
  assert.equal(google.calls[0].event!.colorId, '1', 'Ivan’s Google colour');
  assert.equal(store.rows.get('a1')!.syncedHash, expected.hash);
});

test('loop breaker: a listing that still differs just after the website wrote the same rendering is not written again', async () => {
  const booking = appt('a1');
  const expected = rendered(booking);
  // Google handing the body back in another form would differ on every pull.
  const normalised = { ...expected.event, description: expected.event.description!.replace(/\n/g, '<br>') };
  const store = fakeDb([booking], { events: [syncedRow(booking, { syncedAt: at(-2) })], state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([normalised]);
  const { pull } = load();

  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 0);
  assert.equal(store.rows.get('a1')!.lastError, OPERATIONS_MESSAGES.GOOGLE_EVENT_NOT_KEPT);
  assert.equal(store.rows.get('a1')!.syncedAt!.getTime(), at(-2).getTime());

  // Eleven minutes after that write: written back once.
  store.rows.get('a1')!.syncedAt = at(-11);
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 1);
  assert.deepEqual(google.calls[0].event, expected.event);
  assert.deepEqual({ syncedAt: store.rows.get('a1')!.syncedAt, lastError: store.rows.get('a1')!.lastError }, { syncedAt: NOW, lastError: null });

  // Google changes it again at once: the very next pull writes nothing.
  assert.deepEqual(await run(pull, store.db, google.gateway, at(1)), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 1);
  assert.equal(store.rows.get('a1')!.lastError, OPERATIONS_MESSAGES.GOOGLE_EVENT_NOT_KEPT);
});

test('a "not kept" note clears once Google holds the website\'s own rendering again; other errors stay', async () => {
  const booking = appt('a1');
  const expected = rendered(booking);
  const notKept = OPERATIONS_MESSAGES.GOOGLE_EVENT_NOT_KEPT;
  const store = fakeDb([booking, appt('a2'), appt('a3')], {
    events: [
      syncedRow(booking, { syncedAt: at(-30), lastError: notKept }),
      // A failed push is the push's to clear: it may not have landed.
      syncedRow(appt('a2'), { syncedAt: at(-30), attempts: 1, lastError: OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED }),
      // The note belongs to an older rendering: the push writes this one and clears it then.
      syncedRow(appt('a3'), { syncedHash: 'older-rendering', syncedAt: at(-30), lastError: notKept }),
    ],
    state: { busyHash: EMPTY_HASH },
  });
  const google = fakeGoogle([expected.event, rendered(appt('a2')).event, rendered(appt('a3')).event]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.equal(google.calls.length, 0, 'nothing is written: Google already holds it');
  assert.deepEqual(
    [...store.rows.values()].map((row) => [row.appointmentId, row.lastError, row.attempts]),
    [['a1', null, 0], ['a2', OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED, 1], ['a3', notKept, 0]],
  );
});

test('loop breaker never holds back a real booking change: a new rendering is written at once', async () => {
  const before = appt('a1');
  const after = appt('a1', { date: at(DAY + 60) });
  const store = fakeDb([after], { events: [syncedRow(before, { syncedAt: at(-2) })], state: { busyHash: EMPTY_HASH } });
  const google = fakeGoogle([rendered(before).event]);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 1, blocks: 0, entries: 0, changed: false, diaryChanged: false });
  assert.deepEqual(google.calls[0].event, rendered(after).event);
  assert.equal(store.rows.get('a1')!.syncedHash, rendered(after).hash);
});

test('150 Google-only events are stored in two batches, each clearing its own keys first', async () => {
  const listing = Array.from({ length: 150 }, (_, i) => foreign(`evt${i}`, 'Ivan: busy', i * 30, i * 30 + 30));
  const expected = googleBusyBlocks(diaryEntriesFrom(listing, CONFIG_DIARY));
  // Event 120 (second batch) once stored before the window, now moved into it.
  const store = fakeDb([], { blocks: [block({ externalUid: expected[120].externalUid, start: at(-3 * DAY), end: at(-3 * DAY + 30) })] });
  const google = fakeGoogle(listing);
  const { pull } = load();
  assert.deepEqual(await run(pull, store.db, google.gateway), { reverted: 0, blocks: 150, entries: 150, changed: true, diaryChanged: true });
  assert.deepEqual(store.log.createBatches, [100, 50]);
  assert.equal(store.log.transactions, 1);
  assert.equal(store.blocks.length, 150);
  assert.deepEqual(new Set(store.blocks.map((row) => row.externalUid)), new Set(expected.map((row) => row.externalUid)));
  assert.equal(store.blocks.find((row) => row.externalUid === expected[120].externalUid)!.start.getTime(), at(120 * 30).getTime());
});

test('write-backs stop starting once the pull\'s 40 s budget is spent; the pull still succeeds and the rest wait for the next one', async () => {
  const bookings = Array.from({ length: 50 }, (_, index) => appt(`a${String(index).padStart(2, '0')}`, { date: at(DAY + index * 60) }));
  const store = fakeDb(bookings, { events: bookings.map((booking) => syncedRow(booking)), state: { busyHash: EMPTY_HASH } });
  const realNow = Date.now;
  let clock = 0;
  Date.now = () => clock;
  try {
    // Every booking is missing from Google, and each write takes a second.
    const google = fakeGoogle([], (call) => {
      if (call.op === 'put') clock += 1_000;
      return undefined;
    });
    const { pull } = load();
    const result = await run(pull, store.db, google.gateway);
    assert.equal(google.calls.length, 40, 'no write starts after 40 s');
    assert.equal(result.reverted, 40);
    assert.equal(result.failed, undefined, 'running out of time is not a failed pull');
    assert.equal(store.state!.lastPullSuccessAt!.getTime(), NOW.getTime());
    const untouched = bookings.filter((booking) => store.rows.get(booking.id)!.syncedAt!.getTime() !== NOW.getTime());
    assert.equal(untouched.length, 10, 'the rest keep their old row, so the next pull writes them');
  } finally {
    Date.now = realNow;
  }
});
