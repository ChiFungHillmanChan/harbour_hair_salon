import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { matchesWhere } from '../../test/prisma-where';
import { translator } from '../../i18n/messages';
import { ERASED_CUSTOMER_NAME, erasedEmailFor, erasureConfirmationFor, erasureConfirmed } from '../lib/customer-erasure';
import { isPlaceholderEmail, placeholderEmailFor } from '../lib/walk-in-customer';

// Admin -> Users -> "Erase data": a customer's UK GDPR erasure request
// (actions/admin-erasure.ts, docs/data-erasure.md).

const NOW = new Date('2099-09-01T12:00:00Z');
const t = translator('en-GB', 'adminOps');
const error = (code: string, params?: { count: number }) => ({ success: false, error: t.dynamic(`users.erasure.errors.${code}`, params) });

type Rows = Record<string, Record<string, unknown>[]>;

function seed(): Rows {
  return {
    user: [
      { id: 'customer-1', role: 'USER', email: 'amy@example.com', name: 'Amy Lee', phone: '07000 000001', password: 'hash:old', sessionVersion: 3,
        emailVerifiedAt: new Date('2099-01-01'), preferredLocale: 'zh-HK', mfaSecretEncrypted: null, mfaEnabledAt: null, mfaLastUsedStep: null,
        mfaRecoveryCodesJson: '[]', mfaPendingSecretEncrypted: 'pending-secret', mfaPendingExpiresAt: new Date('2099-09-02') },
      { id: 'admin-1', role: 'ADMIN', email: 'owner@example.com', name: 'Owner' },
      { id: 'admin-2', role: 'ADMIN', email: 'manager@example.com', name: 'Manager' },
      { id: 'walk-in-1', role: 'USER', email: placeholderEmailFor('walk-in-1'), name: 'Phone Customer', phone: '07000 000002', password: null, sessionVersion: 0 },
      { id: 'erased-1', role: 'USER', email: erasedEmailFor('erased-1'), name: ERASED_CUSTOMER_NAME, phone: null, sessionVersion: 1 },
      { id: 'other', role: 'USER', email: 'ben@example.com', name: 'Ben', phone: '07000 000003', sessionVersion: 0 },
    ],
    oAuthAccount: [{ id: 'o1', userId: 'customer-1', provider: 'google' }, { id: 'o2', userId: 'other', provider: 'google' }],
    passwordResetToken: [{ id: 't1', userId: 'customer-1', usedAt: null }, { id: 't2', userId: 'customer-1', usedAt: new Date('2099-01-02') }, { id: 't3', userId: 'other', usedAt: null }],
    appointment: [
      { id: 'a-past', userId: 'customer-1', status: 'COMPLETED', date: new Date('2099-08-01T10:00:00Z'), notes: 'Allergic to ammonia', notificationLocale: 'zh-HK' },
      { id: 'a-cancelled', userId: 'customer-1', status: 'CANCELLED', date: new Date('2099-09-20T10:00:00Z'), notes: 'Call before', notificationLocale: 'zh-HK' },
      { id: 'a-no-show', userId: 'customer-1', status: 'CONFIRMED', date: new Date('2099-08-31T10:00:00Z'), notes: null, notificationLocale: null },
      { id: 'b-1', userId: 'other', status: 'CONFIRMED', date: new Date('2099-09-10T10:00:00Z'), notes: 'Ben’s note', notificationLocale: 'en-GB' },
    ],
    notificationDelivery: [
      { id: 'd-sent', appointmentId: 'a-past', kind: 'REMINDER', status: 'SENT', payloadJson: '{"to":"amy@example.com"}', lockedAt: null, lockToken: null, lastError: null },
      { id: 'd-pending', appointmentId: 'a-past', kind: 'REVIEW_REQUEST', status: 'PENDING', payloadJson: '{"user":{"email":"amy@example.com"}}', lockedAt: null, lockToken: null, lastError: null },
      { id: 'd-processing', appointmentId: 'a-cancelled', kind: 'CANCELLATION', status: 'PROCESSING', payloadJson: '{"user":{"name":"Amy Lee"}}', lockedAt: NOW, lockToken: 'worker', lastError: null },
      { id: 'd-other', appointmentId: 'b-1', kind: 'REMINDER', status: 'PENDING', payloadJson: '{"to":"ben@example.com"}', lockedAt: null, lockToken: null, lastError: null },
    ],
    review: [{ id: 'r1', userId: 'customer-1', appointmentId: 'a-past', rating: 5, comment: 'Lovely cut', status: 'APPROVED' }],
    // Google Calendar copies (services/google-calendar-push.ts): the cancelled booking's was deleted.
    googleCalendarEvent: [
      { id: 'g-past', appointmentId: 'a-past', syncedHash: 'h-past', removed: false },
      { id: 'g-cancelled', appointmentId: 'a-cancelled', syncedHash: null, removed: true },
      { id: 'g-no-show', appointmentId: 'a-no-show', syncedHash: 'h-no-show', removed: false },
      { id: 'g-ben', appointmentId: 'b-1', syncedHash: 'h-ben', removed: false },
    ],
    auditEvent: [],
  };
}

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([field, expected]) => {
    const actual = row[field];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === 'object') {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === 'in') return (value as unknown[]).includes(actual);
        if (operator === 'not') return actual !== value;
        if (operator === 'gt') return (actual as Date) > (value as Date);
        throw new Error(`Unhandled operator ${operator}`);
      });
    }
    return actual === expected;
  });
}

function table(rows: Rows, name: string, counts: Record<string, number>) {
  const list = () => rows[name];
  return {
    findUnique: async ({ where }: { where: { id: string } }) => { counts.reads++; const row = list().find((item) => item.id === where.id); return row ? structuredClone(row) : null; },
    findMany: async ({ where }: { where?: Record<string, unknown> }) => { counts.reads++; return list().filter((row) => matches(row, where)).map((row) => structuredClone(row)); },
    count: async ({ where }: { where?: Record<string, unknown> }) => { counts.reads++; return list().filter((row) => matches(row, where)).length; },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      counts.writes++;
      const selected = list().filter((row) => matches(row, where));
      for (const row of selected) {
        for (const [key, value] of Object.entries(data)) {
          row[key] = value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value ? Number(row[key]) + Number(value.increment) : value;
        }
      }
      return { count: selected.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      counts.writes++;
      const keep = list().filter((row) => !matches(row, where));
      const removed = list().length - keep.length;
      rows[name] = keep;
      return { count: removed };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => { counts.writes++; list().push({ id: `${name}-${list().length + 1}`, ...data }); return { id: 'created' }; },
  };
}

function fixture(options: { role?: 'ADMIN' | 'USER'; resend?: 'ok' | 'not-found' | 'error' | 'throws' | 'hangs'; beforeWrite?: (rows: Rows) => void } = {}) {
  let rows = seed();
  const counts = { reads: 0, writes: 0 };
  const removed: unknown[] = [];
  // Google Calendar pushes scheduled by the action, and whether a transaction was open at the time.
  const googlePushes: { ids: string[] | undefined; inTransaction: boolean }[] = [];
  let inTransaction = false;
  let googleRowsMarkedInTransaction: boolean | null = null;
  const client = () => ({
    user: { ...table(rows, 'user', counts), updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      options.beforeWrite?.(rows);
      return table(rows, 'user', counts).updateMany(args);
    } },
    oAuthAccount: table(rows, 'oAuthAccount', counts),
    passwordResetToken: table(rows, 'passwordResetToken', counts),
    appointment: table(rows, 'appointment', counts),
    notificationDelivery: table(rows, 'notificationDelivery', counts),
    review: table(rows, 'review', counts),
    googleCalendarEvent: { ...table(rows, 'googleCalendarEvent', counts), updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      googleRowsMarkedInTransaction = inTransaction;
      return table(rows, 'googleCalendarEvent', counts).updateMany(args);
    } },
    auditEvent: table(rows, 'auditEvent', counts),
  });
  const actions = loadServerModule<typeof import('./admin-erasure')>('src/app/actions/admin-erasure.ts', {
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/lib/password': { hashPassword: async (secret: string) => `unusable:${secret.length}:${Math.random()}` },
    '@/app/services/booking-service': { runSerializableWithRetry: async (fn: (tx: unknown) => unknown) => {
      // Mirror a real transaction: if fn throws, undo its writes.
      const snapshot = structuredClone(rows);
      inTransaction = true;
      try { return await fn(client()); } catch (failure) { rows = snapshot; throw failure; } finally { inTransaction = false; }
    } },
    '@/app/services/stylist-ical-cache': {
      scheduleGoogleCalendarPush: (ids?: string[]) => { googlePushes.push({ ids: ids && [...ids], inTransaction }); },
    },
    'next/cache': { revalidatePath: () => undefined },
    resend: { Resend: class {
      contacts = { remove: async (payload: unknown) => {
        removed.push(payload);
        if (options.resend === 'throws') throw new Error('network down');
        if (options.resend === 'hangs') return new Promise<never>(() => {});
        if (options.resend === 'error') return { data: null, error: { message: 'Internal server error', statusCode: 500 } };
        if (options.resend === 'not-found') return { data: null, error: { message: 'Contact not found', statusCode: 404 } };
        return { data: { deleted: true }, error: null };
      } };
    } },
  });
  return { actions, rows: () => rows, counts, removed, googlePushes, googleRowsMarkedInTransaction: () => googleRowsMarkedInTransaction };
}

const user = (rows: Rows, id: string) => rows.user.find((row) => row.id === id)!;

let saved: Record<string, string | undefined> = {};
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());
beforeEach(() => {
  saved = { key: process.env.RESEND_API_KEY, audience: process.env.RESEND_AUDIENCE_ID };
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_AUDIENCE_ID;
});
afterEach(() => {
  for (const [key, value] of [['RESEND_API_KEY', saved.key], ['RESEND_AUDIENCE_ID', saved.audience]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('only an administrator can erase, and never their own account', async () => {
  const customer = fixture({ role: 'USER' });
  assert.deepEqual(await customer.actions.eraseCustomerData('customer-1', 'amy@example.com'), error('UNAUTHORIZED'));
  assert.deepEqual(customer.counts, { reads: 0, writes: 0 }, 'refused before the database is touched');
  const self = fixture();
  assert.deepEqual(await self.actions.eraseCustomerData('admin-1', 'owner@example.com'), error('ERASE_SELF'));
  assert.equal(self.counts.writes, 0);
});

test('administrator accounts, unknown and already-erased customers are refused without writing', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.eraseCustomerData('admin-2', 'manager@example.com'), error('ERASE_ADMIN'));
  assert.deepEqual(await f.actions.eraseCustomerData('nobody', 'x@example.com'), error('NOT_FOUND'));
  assert.deepEqual(await f.actions.eraseCustomerData('erased-1', 'ERASE'), error('ALREADY_ERASED'));
  assert.deepEqual(await f.actions.eraseCustomerData('customer-1', '   '), error('INVALID'));
  assert.equal(f.counts.writes, 0);
  assert.deepEqual(f.googlePushes, [], 'nothing changed, so nothing is re-rendered in Google Calendar');
  assert.equal(user(f.rows(), 'admin-2').email, 'manager@example.com');
});

test('the typed confirmation must be the customer’s address (any case), or ERASE when they have none', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.eraseCustomerData('customer-1', 'amy@example.co'), error('CONFIRMATION_MISMATCH'));
  assert.deepEqual(await f.actions.eraseCustomerData('walk-in-1', placeholderEmailFor('walk-in-1')), error('CONFIRMATION_MISMATCH'));
  assert.equal(f.counts.writes, 0);
  assert.equal(erasureConfirmationFor(placeholderEmailFor('walk-in-1')), 'ERASE');
  assert.ok(erasureConfirmed('  AMY@Example.com ', 'amy@example.com'));
  assert.equal((await f.actions.eraseCustomerData('walk-in-1', 'erase')).success, true);
  assert.equal(user(f.rows(), 'walk-in-1').phone, null);
});

test('a customer with upcoming pending or confirmed bookings must have them cancelled first', async () => {
  const f = fixture();
  f.rows().appointment.push(
    { id: 'a-request', userId: 'customer-1', status: 'PENDING', date: new Date('2099-09-05T10:00:00Z'), notes: null },
    { id: 'a-booked', userId: 'customer-1', status: 'CONFIRMED', date: new Date('2099-09-06T10:00:00Z'), notes: null },
  );
  assert.deepEqual(await f.actions.eraseCustomerData('customer-1', 'amy@example.com'), error('HAS_UPCOMING', { count: 2 }));
  assert.equal(f.counts.writes, 0);
  assert.deepEqual(f.googlePushes, []);
  assert.equal(user(f.rows(), 'customer-1').email, 'amy@example.com');
});

test('erasure anonymises the account, removes sign-in routes and free text, and keeps the business record', async () => {
  const f = fixture();
  const result = await f.actions.eraseCustomerData('customer-1', 'amy@example.com');
  assert.deepEqual(result, { success: true, message: t('users.erasure.done') });
  const rows = f.rows();
  const account = user(rows, 'customer-1');
  assert.equal(account.name, ERASED_CUSTOMER_NAME);
  assert.equal(account.email, 'erased-customer-1@erased.invalid');
  assert.ok(isPlaceholderEmail(account.email as string), 'nothing can ever be queued for it');
  assert.equal(account.phone, null);
  assert.match(String(account.password), /^unusable:/, 'a hash of a secret nobody knows');
  assert.equal(account.emailVerifiedAt, null);
  assert.equal(account.preferredLocale, null);
  assert.equal(account.sessionVersion, 4, 'every signed-in session ends');
  assert.equal(account.role, 'USER');
  for (const field of ['mfaSecretEncrypted', 'mfaEnabledAt', 'mfaLastUsedStep', 'mfaPendingSecretEncrypted', 'mfaPendingExpiresAt']) assert.equal(account[field], null, field);
  assert.equal(account.mfaRecoveryCodesJson, '[]');

  assert.deepEqual(rows.oAuthAccount.map((row) => row.id), ['o2'], 'linked Google sign-in removed');
  assert.deepEqual(rows.passwordResetToken.map((row) => row.id), ['t3'], 'reset links removed, used or not');

  assert.deepEqual(rows.appointment.map((row) => row.id), ['a-past', 'a-cancelled', 'a-no-show', 'b-1'], 'appointment history kept');
  assert.deepEqual(rows.appointment.filter((row) => row.userId === 'customer-1').map((row) => [row.notes, row.notificationLocale]), [[null, null], [null, null], [null, null]]);
  assert.equal(rows.appointment.find((row) => row.id === 'b-1')?.notes, 'Ben’s note');

  const delivery = (id: string) => rows.notificationDelivery.find((row) => row.id === id)!;
  assert.deepEqual([delivery('d-sent').status, delivery('d-sent').payloadJson], ['SENT', '{}'], 'history keeps its status, loses the copy');
  for (const id of ['d-pending', 'd-processing']) {
    assert.deepEqual([delivery(id).status, delivery(id).payloadJson, delivery(id).lockToken], ['SKIPPED', '{}', null], `${id} is never sent`);
  }
  assert.equal(delivery('d-other').payloadJson, '{"to":"ben@example.com"}');

  assert.deepEqual(rows.review, [], 'their reviews are deleted with the account (privacy notice: kept while the account is open)');

  assert.equal(rows.auditEvent.length, 1);
  const audit = rows.auditEvent[0];
  assert.deepEqual([audit.actorUserId, audit.action, audit.targetType, audit.targetId], ['admin-1', 'USER.ERASED', 'User', 'customer-1']);
  assert.deepEqual(JSON.parse(String(audit.metadataJson)), { appointments: 3, notifications: 3, linkedAccounts: 1, resetLinks: 2, reviews: 1 });
  assert.doesNotMatch(String(audit.metadataJson), /amy|Amy|07000|ammonia/, 'the audit copies no personal data');

  assert.deepEqual(await f.actions.eraseCustomerData('customer-1', 'amy@example.com'), error('ALREADY_ERASED'));
});

test('after the erasure commits, the customer\'s Google Calendar copies are re-rendered with the anonymised name', async () => {
  const f = fixture();
  assert.equal((await f.actions.eraseCustomerData('customer-1', 'amy@example.com')).success, true);
  // Every one of their bookings by id, so the push reaches past its 7-day
  // window (up to the 12-month limit): the past visit is named in Google too.
  // Ben's booking is not theirs.
  assert.deepEqual(f.googlePushes, [{ ids: ['a-past', 'a-cancelled', 'a-no-show'], inTransaction: false }]);
});

test('erasure marks the customer\'s live Google copies for re-rendering in its own transaction, so a failed push is repaired later', async () => {
  const f = fixture();
  assert.equal((await f.actions.eraseCustomerData('customer-1', 'amy@example.com')).success, true);
  assert.equal(f.googleRowsMarkedInTransaction(), true, 'committed with the anonymisation, never after it');
  const row = (id: string) => f.rows().googleCalendarEvent.find((item) => item.id === id)!;
  assert.deepEqual([row('g-past').syncedHash, row('g-no-show').syncedHash], [null, null]);
  assert.deepEqual([row('g-cancelled').syncedHash, row('g-cancelled').removed], [null, true], 'a deleted copy stays deleted');
  assert.equal(row('g-ben').syncedHash, 'h-ben', 'another customer\'s copy is untouched');
});

test('a failed erasure leaves the Google copies as they were', async () => {
  const f = fixture({ beforeWrite: (rows) => { user(rows, 'customer-1').email = 'amy.new@example.com'; } });
  assert.deepEqual(await f.actions.eraseCustomerData('customer-1', 'amy@example.com'), error('CHANGED'));
  assert.equal(f.rows().googleCalendarEvent.find((item) => item.id === 'g-past')!.syncedHash, 'h-past');
});

test('a customer whose account changes mid-erasure is left untouched', async () => {
  const f = fixture({ beforeWrite: (rows) => { user(rows, 'customer-1').email = 'amy.new@example.com'; } });
  assert.deepEqual(await f.actions.eraseCustomerData('customer-1', 'amy@example.com'), error('CHANGED'));
  assert.equal(user(f.rows(), 'customer-1').name, 'Amy Lee');
  assert.equal(f.rows().auditEvent.length, 0);
  assert.deepEqual(f.googlePushes, []);
});

test('the address is also removed from the Resend marketing audience when one is configured', async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_AUDIENCE_ID = 'audience-1';
  const ok = fixture();
  assert.deepEqual(await ok.actions.eraseCustomerData('customer-1', 'amy@example.com'), { success: true, message: t('users.erasure.done') });
  assert.deepEqual(ok.removed, [{ email: 'amy@example.com', audienceId: 'audience-1' }]);
  const absent = fixture({ resend: 'not-found' });
  assert.deepEqual(await absent.actions.eraseCustomerData('customer-1', 'amy@example.com'), { success: true, message: t('users.erasure.done') });
});

test('a marketing-list failure never undoes the erasure; the admin is told to finish it by hand', async (context) => {
  context.mock.method(console, 'error', () => {});
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_AUDIENCE_ID = 'audience-1';
  for (const resend of ['error', 'throws'] as const) {
    const f = fixture({ resend });
    assert.deepEqual(await f.actions.eraseCustomerData('customer-1', 'amy@example.com'),
      { success: true, message: t('users.erasure.doneMarketingManual', { email: 'amy@example.com' }) });
    assert.equal(user(f.rows(), 'customer-1').name, ERASED_CUSTOMER_NAME);
  }
});

test('a marketing list that never answers is given up after 10 seconds; the admin is told to finish it by hand', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  context.mock.method(console, 'error', () => {});
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_AUDIENCE_ID = 'audience-1';
  const f = fixture({ resend: 'hangs' });
  let settled = false;
  const result = f.actions.eraseCustomerData('customer-1', 'amy@example.com').finally(() => { settled = true; });
  // Bounded, so a Resend call that never happens fails here instead of
  // spinning the test run forever (review 2026-10-25).
  for (let turn = 0; !f.removed.length; turn++) {
    assert.ok(turn < 1_000, 'Resend was never asked to remove the contact');
    await new Promise((resolve) => setImmediate(resolve));
  }
  context.mock.timers.tick(9_999);
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'still waiting a moment before 10 seconds');
  context.mock.timers.tick(1);
  assert.deepEqual(await result, { success: true, message: t('users.erasure.doneMarketingManual', { email: 'amy@example.com' }) });
  assert.equal(user(f.rows(), 'customer-1').name, ERASED_CUSTOMER_NAME);
});

test('without a marketing audience configured nothing is sent to Resend', async () => {
  const f = fixture();
  assert.equal((await f.actions.eraseCustomerData('customer-1', 'amy@example.com')).success, true);
  assert.deepEqual(f.removed, []);
});

// The delivery worker must cope with what erasure leaves behind.
test('the outbox queues nothing for an erased address and skips a redacted event without sending', async () => {
  const upserts: unknown[] = [];
  let sends = 0;
  const row = { id: 'n1', eventKey: 'appointment/a/0/REMINDER', kind: 'REMINDER', appointmentId: 'a', status: 'PENDING', attempts: 0,
    firstAttemptAt: null, nextAttemptAt: NOW, createdAt: NOW, lockedAt: null, lockToken: null as string | null, payloadJson: '{}' };
  const db = {
    notificationDelivery: {
      findUnique: async (args: { where: { eventKey?: string } }) => (args.where.eventKey ? null : { ...row }),
      upsert: async (args: unknown) => { upserts.push(args); return { id: 'queued' }; },
      findMany: async () => [{ id: row.id, firstAttemptAt: null }],
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 }; },
    },
    appointment: { findUnique: async () => ({ status: 'CONFIRMED', date: new Date('2099-09-02T10:00:00Z'), notificationVersion: 0, review: null }) },
  };
  const previous = process.env.NOTIFICATIONS_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'true';
  try {
    const outbox = loadServerModule<typeof import('../services/notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
      '@/app/lib/prisma': db,
      './email-service': { prepareAppointmentEmail: async () => { throw new Error('must not render'); }, sendPreparedEmail: async () => { sends++; } },
    });
    const erased = { id: 'a', date: new Date('2099-09-02T10:00:00Z'), priceAtBooking: null, durationAtBooking: 60, notificationVersion: 0, notes: null,
      user: { email: erasedEmailFor('customer-1'), name: ERASED_CUSTOMER_NAME }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 } };
    for (const kind of ['REMINDER', 'REVIEW_REQUEST', 'CANCELLATION', 'REQUEST_LAPSED'] as const) {
      assert.equal(await outbox.enqueueAppointmentNotification(db as never, kind, erased), null, kind);
    }
    assert.deepEqual(upserts, []);
    const result = await outbox.dispatchPendingNotifications({ db: db as never, now: NOW });
    assert.deepEqual(result, { sent: 0, failed: 0, skipped: 1, deferred: 0 });
    assert.equal(row.status, 'SKIPPED');
    assert.equal(sends, 0);
  } finally {
    if (previous === undefined) delete process.env.NOTIFICATIONS_ENABLED; else process.env.NOTIFICATIONS_ENABLED = previous;
  }
});

test('an erased customer is never offered when staff search customers for a new booking', async () => {
  const candidates = [
    { id: 'gone', name: ERASED_CUSTOMER_NAME, email: erasedEmailFor('gone'), phone: null, createdAt: NOW },
    { id: 'kept', name: 'Erasmus Lee', email: 'erasmus@example.com', phone: null, createdAt: NOW },
  ];
  const schedule = loadServerModule<typeof import('./admin-schedule')>('src/app/actions/admin-schedule.ts', {
    '@/app/lib/prisma': {
      __esModule: true,
      default: { user: { findMany: async ({ where }: { where: Record<string, unknown> }) => candidates.filter((row) => matchesWhere({ ...row, role: 'USER' }, where)) } },
      getDatabaseProvider: () => 'postgresql',
    },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: 'ADMIN' }) },
    '@/app/services/booking-service': {},
    '@/app/services/notification-outbox-service': {},
    '@/app/services/stylist-ical-cache': {},
    'next/cache': { revalidatePath: () => undefined },
    'next/server': { after: () => undefined },
  });
  assert.deepEqual((await schedule.searchAdminCustomers('eras')).map((row) => row.id), ['kept']);
});
