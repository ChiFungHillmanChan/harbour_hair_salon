import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { placeholderEmailFor } from '../lib/walk-in-customer';

let previousNotificationsEnabled: string | undefined;
beforeEach(() => {
  previousNotificationsEnabled = process.env.NOTIFICATIONS_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'true';
});
afterEach(() => {
  if (previousNotificationsEnabled === undefined) delete process.env.NOTIFICATIONS_ENABLED;
  else process.env.NOTIFICATIONS_ENABLED = previousNotificationsEnabled;
});

function fixture({ obsolete = false, fail = false, changeDuringPreparation = false, unprepared = false } = {}) {
  const now = new Date('2026-09-11T12:00:00Z');
  const row = { id: 'job-1', eventKey: 'appointment/a/0/CONFIRMATION', kind: 'CONFIRMATION', appointmentId: 'a', status: 'PENDING', attempts: 0, firstAttemptAt: null as Date | null, nextAttemptAt: now, createdAt: now, lockedAt: null as Date | null, lockToken: null as string | null, payloadJson: JSON.stringify({ version: 0, date: '2026-09-12T12:00:00.000Z', email: { from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>' } }) };
  let sends = 0;
  let reads = 0;
  let renders = 0;
  const keys: string[] = [];
  let changed = obsolete;
  if (changeDuringPreparation || unprepared) row.payloadJson = JSON.stringify({ version: 0, date: '2026-09-12T12:00:00.000Z', appointment: { id: 'a', date: '2026-09-12T12:00:00.000Z', user: { name: 'Customer', email: 'customer@example.com' }, stylist: { name: 'Stylist' }, service: { name: 'Cut', price: 80, duration: 60 } } });
  const db = {
    notificationDelivery: {
      findMany: async () => { reads++; return [row]; },
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.lockToken && where.lockToken !== row.lockToken) return { count: 0 };
        if (where.OR && row.status !== 'PENDING') return { count: 0 };
        const increment = data.attempts as { increment?: number } | undefined;
        Object.assign(row, data, { attempts: row.attempts + (increment?.increment ?? 0) });
        return { count: 1 };
      },
    },
    appointment: {
      findUnique: async () => ({ id: 'a', status: changed ? 'CANCELLED' : 'CONFIRMED', date: new Date('2026-09-12T12:00:00Z'), notificationVersion: changed ? 1 : 0, review: null }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async () => { renders++; if (changeDuringPreparation) changed = true; return { from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>' }; },
      sendPreparedEmail: async (_email: unknown, key: string) => { sends++; keys.push(key); if (fail) throw new Error('Provider refused customer@example.com'); },
    },
  });
  return { service, db, row, keys, sends: () => sends, sideEffects: () => ({ reads, renders, sends }), now };
}

for (const flag of [undefined, 'false']) {
  test(`disabled notifications (${flag ?? 'unset'}) leave immediate and scheduled delivery untouched`, async () => {
    const f = fixture({ unprepared: true });
    const originalRow = structuredClone(f.row);
    if (flag === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = flag;

    const scheduled = await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
    const immediate = await f.service.dispatchAppointmentNotifications('a');

    assert.deepEqual(scheduled, { sent: 0, failed: 0, skipped: 0, deferred: 0 });
    assert.deepEqual(immediate, { sent: 0, failed: 0, skipped: 0, deferred: 0 });
    assert.deepEqual(f.sideEffects(), { reads: 0, renders: 0, sends: 0 });
    assert.deepEqual(f.row, originalRow, 'disabled delivery must preserve the queued payload and retry state');
  });
}

test('enabling notifications resumes a valid queued email through immediate delivery', async (t) => {
  const f = fixture({ unprepared: true });
  t.mock.timers.enable({ apis: ['Date'], now: f.now });
  process.env.NOTIFICATIONS_ENABLED = 'false';
  await f.service.dispatchAppointmentNotifications('a');
  assert.equal(f.row.status, 'PENDING');
  assert.equal(f.row.attempts, 0);

  process.env.NOTIFICATIONS_ENABLED = 'true';
  const result = await f.service.dispatchAppointmentNotifications('a');
  assert.deepEqual(result, { sent: 1, failed: 0, skipped: 0, deferred: 0 });
  assert.deepEqual(f.sideEffects(), { reads: 1, renders: 1, sends: 1 });
  assert.equal(f.row.status, 'SENT');
  assert.equal(f.row.attempts, 1);
  assert.deepEqual(f.keys, [f.row.eventKey]);
});

test('concurrent workers claim one notification and deliver using its stable event key', async () => {
  const f = fixture();
  await Promise.all([f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now }), f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now })]);
  assert.equal(f.sends(), 1);
  assert.equal(f.row.status, 'SENT');
  assert.deepEqual(f.keys, [f.row.eventKey]);
});

test('a cancelled or changed appointment suppresses an obsolete confirmation', async () => {
  const f = fixture({ obsolete: true });
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(f.sends(), 0);
  assert.equal(f.row.status, 'SKIPPED');
});

test('a cancellation committed during email preparation suppresses the stale confirmation before HTTP', async () => {
  const f = fixture({ changeDuringPreparation: true });
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(f.sends(), 0);
  assert.equal(f.row.status, 'SKIPPED');
  assert.equal(f.row.payloadJson, '{}');
});

test('provider failure persists a retry without recording customer data in its error', async () => {
  const f = fixture({ fail: true });
  const result = await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(result.failed, 1);
  assert.equal(f.row.status, 'PENDING');
  assert.ok(f.row.nextAttemptAt > f.now);
  assert.ok(!JSON.stringify(f.row).includes('Provider refused customer'));
});

test('an old ambiguous attempt is not retried beyond the provider deduplication window', async () => {
  const f = fixture();
  f.row.attempts = 1;
  f.row.firstAttemptAt = new Date(f.now.getTime() - 24 * 60 * 60 * 1000);
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(f.sends(), 0);
  assert.equal(f.row.status, 'FAILED');
});

test('disabled delivery still enqueues notification fields and frozen values without provider calls', async () => {
  process.env.NOTIFICATIONS_ENABLED = 'false';
  let payload = '';
  let rendered = false;
  const db = {
    notificationDelivery: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: { payloadJson: string } }) => { payload = create.payloadJson; return { id: 'queued' }; },
    },
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': { prepareAppointmentEmail: async () => { rendered = true; throw new Error('Provider unavailable'); } },
  });
  const appointment = {
    id: 'a', date: new Date('2026-09-12T12:00:00Z'), notificationVersion: 2, priceAtBooking: 80, durationAtBooking: 60, notes: null,
    user: { name: 'Customer', email: 'customer@example.com', password: 'secret-hash-never-queue', sessionVersion: 4 },
    stylist: { name: 'Stylist', icalToken: 'secret-calendar-token' },
    service: { name: 'Cut', price: 100, duration: 30 },
  };
  await service.enqueueAppointmentNotification(db as never, 'CONFIRMATION', appointment as never);
  assert.equal(rendered, false);
  assert.ok(!payload.includes('secret-'));
  const saved = JSON.parse(payload);
  // Schema 2: the frozen booking amount (never the live service price) with
  // no NHS/VAT claim the booking itself did not record.
  assert.deepEqual(saved.appointment.price, { known: true, amountPence: 8000, priceType: null, vatDisplay: null, priceNature: null });
  assert.equal(saved.appointment.service.duration, 60);
  assert.equal(saved.version, 2);
  assert.equal(saved.locale, 'en-GB', 'a booking with no recorded language is mailed in English');
});

test('customer mail keeps the booking language; the salon alert uses the salon setting', async () => {
  const payloads: Record<string, { locale: string; appointment: { service: { name: string }; price: unknown } }> = {};
  const db = {
    notificationDelivery: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: { kind: string; payloadJson: string } }) => { payloads[create.kind] = JSON.parse(create.payloadJson); return { id: create.kind }; },
    },
    siteSettings: { findUnique: async () => ({ salonNotificationLocale: 'zh-HK' }) },
    contentTranslation: {
      findUnique: async ({ where }: { where: { entityType_entityId_locale: { locale: string } } }) =>
        where.entityType_entityId_locale.locale === 'zh-HK' ? { fieldsJson: JSON.stringify({ name: '長髮洗剪吹' }) } : null,
    },
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db, './email-service': {},
  });
  const booked = {
    id: 'a', serviceId: 'svc', date: new Date('2099-09-12T12:00:00Z'), notificationVersion: 1, notes: null,
    priceAtBooking: null, durationAtBooking: 60, quoteJson: null,
    // Booked on /zh-hk. An English-speaking admin confirming it later changes nothing.
    notificationLocale: 'zh-HK',
    user: { name: '陳小姐', email: 'chan@example.com' }, stylist: { name: 'Ivan' }, service: { name: 'Long Hair - Wash, Haircut & Blow Dry', duration: 60 },
  };
  await service.enqueueAppointmentNotification(db as never, 'CONFIRMATION', booked as never);
  await service.enqueueAppointmentNotification(db as never, 'SALON_ALERT', { ...booked, notificationLocale: 'en-GB' } as never);
  assert.equal(payloads.CONFIRMATION.locale, 'zh-HK');
  assert.equal(payloads.CONFIRMATION.appointment.service.name, '長髮洗剪吹');
  // A booking made before prices were recorded is never mailed with an invented amount.
  assert.deepEqual(payloads.CONFIRMATION.appointment.price, { known: false });
  assert.equal(payloads.SALON_ALERT.locale, 'zh-HK', 'the salon alert follows the salon setting, not the customer');
});

test('an event queued before languages existed is prepared in English and its frozen body is reused on retry', async () => {
  process.env.NOTIFICATIONS_ENABLED = 'true';
  const locales: string[] = [];
  const row = {
    id: 'n1', eventKey: 'appointment/a/0/CONFIRMATION', kind: 'CONFIRMATION', appointmentId: 'a', status: 'PENDING', attempts: 0, firstAttemptAt: null, lockToken: null as string | null,
    payloadJson: JSON.stringify({ version: 0, date: '2099-09-12T12:00:00.000Z', appointment: { id: 'a', date: '2099-09-12T12:00:00.000Z', user: { email: 'c@example.com', name: 'C' }, stylist: { name: 'S' }, service: { name: 'Cut', price: 80, duration: 60 } } }),
  };
  const db = {
    notificationDelivery: {
      findMany: async () => [{ id: row.id, firstAttemptAt: null }],
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 }; },
      findUnique: async () => ({ ...row }),
    },
    appointment: { findUnique: async () => ({ date: new Date('2099-09-12T12:00:00.000Z'), status: 'CONFIRMED', notificationVersion: 0, review: null }), updateMany: async () => ({ count: 1 }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async (_kind: string, _appointment: unknown, _options: unknown, locale: string) => { locales.push(locale); return { from: 'f', to: 'c@example.com', subject: 's', html: 'h' }; },
      sendPreparedEmail: async () => { throw new Error('provider down'); },
    },
  });
  await service.dispatchPendingNotifications({ db: db as never, now: new Date('2099-09-01T00:00:00Z') });
  assert.deepEqual(locales, ['en-GB']);
  assert.ok(JSON.parse(row.payloadJson).email, 'the prepared request is frozen before sending');
  row.status = 'PENDING';
  await service.dispatchPendingNotifications({ db: db as never, now: new Date('2099-09-01T01:00:00Z') });
  assert.deepEqual(locales, ['en-GB'], 'a retry resends the frozen body; it is never re-rendered in a newer template');
  process.env.NOTIFICATIONS_ENABLED = 'false';
});

test('walk-in customer notifications are not queued, while the salon alert is preserved', async () => {
  const queued: string[] = [];
  const db = { notificationDelivery: {
    findUnique: async () => null,
    upsert: async ({ create }: { create: { kind: string } }) => { queued.push(create.kind); return { id: 'queued' }; },
  } };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db, './email-service': {},
  });
  const appointment = {
    id: 'a', date: new Date('2026-09-12T12:00:00Z'), notificationVersion: 0, notes: null,
    priceAtBooking: 80, durationAtBooking: 60,
    user: { name: 'Walk-in', email: placeholderEmailFor('phone-booking') },
    stylist: { name: 'Stylist' }, service: { name: 'Cut', price: 80, duration: 60 },
  };
  for (const kind of ['CONFIRMATION', 'CANCELLATION', 'RESCHEDULE', 'REMINDER', 'REVIEW_REQUEST', 'REQUEST_RECEIVED', 'SALON_ALERT'] as const) {
    await service.enqueueAppointmentNotification(db as never, kind, appointment as never);
  }
  assert.deepEqual(queued, ['SALON_ALERT']);
});

for (const prepared of [false, true]) {
  test(`existing ${prepared ? 'prepared' : 'unprepared'} walk-in mail is skipped without sending or retrying`, async () => {
    const f = fixture({ unprepared: !prepared });
    const payload = JSON.parse(f.row.payloadJson);
    if (prepared) payload.email.to = placeholderEmailFor('old-booking');
    else payload.appointment.user.email = placeholderEmailFor('old-booking');
    f.row.payloadJson = JSON.stringify(payload);
    const result = await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
    assert.deepEqual(result, { sent: 0, failed: 0, skipped: 1, deferred: 0 });
    assert.equal(f.row.status, 'SKIPPED');
    assert.equal(f.row.payloadJson, '{}');
    assert.equal(f.sideEffects().renders, 0);
    assert.equal(f.sends(), 0);
  });
}

test('a queued salon alert for a walk-in still reaches the salon', async () => {
  const f = fixture({ unprepared: true });
  f.row.kind = 'SALON_ALERT';
  f.db.appointment.findUnique = async () => ({ id: 'a', status: 'PENDING', date: new Date('2026-09-12T12:00:00Z'), notificationVersion: 0, review: null });
  const payload = JSON.parse(f.row.payloadJson);
  payload.appointment.user.email = placeholderEmailFor('walk-in');
  f.row.payloadJson = JSON.stringify(payload);
  const result = await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal(result.sent, 1);
  assert.equal(f.row.status, 'SENT');
});

function requestFixture(kind: string, state: { status: string; requestedAt: string | null; date?: string }) {
  const now = new Date('2099-09-01T12:00:00Z');
  const requestedAt = '2099-09-01T11:00:00.000Z';
  // The queued payload and the booking agree on the date, so only the request rules decide.
  const date = new Date(state.date ?? '2099-09-14T12:00:00Z').toISOString();
  const row = {
    id: 'job-r', eventKey: `appointment/a/0/${kind}/${requestedAt}`, kind, appointmentId: 'a', status: 'PENDING', attempts: 0,
    firstAttemptAt: null as Date | null, nextAttemptAt: now, createdAt: now, lockedAt: null as Date | null, lockToken: null as string | null,
    payloadJson: JSON.stringify({
      version: 0, date, locale: 'en-GB',
      appointment: { schema: 2, id: 'a', date, notes: null, user: { name: 'Amy', email: 'amy@example.test' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 }, price: { known: false } },
      options: { requestedDate: '2099-09-15T09:00:00.000Z', requestedAt },
    }),
  };
  let sends = 0;
  const prepared: unknown[] = [];
  const db = {
    notificationDelivery: {
      findMany: async () => [row],
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.lockToken && where.lockToken !== row.lockToken) return { count: 0 };
        const increment = data.attempts as { increment?: number } | undefined;
        Object.assign(row, data, { attempts: row.attempts + (increment?.increment ?? 0) });
        return { count: 1 };
      },
    },
    appointment: {
      findUnique: async () => ({ id: 'a', status: state.status, date: new Date(date), notificationVersion: 0, review: null, rescheduleRequestedAt: state.requestedAt ? new Date(state.requestedAt) : null }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async (_kind: string, _appointment: unknown, options: unknown) => { prepared.push(options); return { from: 'Salon <b@example.com>', to: 'amy@example.test', subject: 'S', html: '<p>S</p>' }; },
      sendPreparedEmail: async () => { sends++; },
    },
  });
  return { service, db, row, now, sends: () => sends, prepared };
}

const OPEN = '2099-09-01T11:00:00.000Z';
const OTHER = '2099-09-01T11:30:00.000Z';
for (const [kind, state, expected] of [
  ['RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: OPEN }, 'SENT'],
  ['RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: OTHER }, 'SKIPPED'],
  ['RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: null }, 'SKIPPED'],
  ['SALON_RESCHEDULE_ALERT', { status: 'CONFIRMED', requestedAt: OPEN }, 'SENT'],
  ['SALON_RESCHEDULE_ALERT', { status: 'CANCELLED', requestedAt: OPEN }, 'SKIPPED'],
  ['RESCHEDULE_DECLINED', { status: 'CONFIRMED', requestedAt: null }, 'SENT'],
  ['RESCHEDULE_DECLINED', { status: 'CONFIRMED', requestedAt: OTHER }, 'SENT'],
  ['RESCHEDULE_DECLINED', { status: 'CONFIRMED', requestedAt: OPEN }, 'SKIPPED'],
  ['RESCHEDULE_DECLINED', { status: 'CANCELLED', requestedAt: null }, 'SKIPPED'],
  ['RESCHEDULE_LAPSED', { status: 'CONFIRMED', requestedAt: null }, 'SENT'],
  ['RESCHEDULE_LAPSED', { status: 'CONFIRMED', requestedAt: null, date: '2099-08-31T12:00:00Z' }, 'SKIPPED'],
] as const) {
  test(`${kind} with request ${state.requestedAt ?? 'cleared'} on a ${state.status} booking is ${expected}`, async () => {
    const f = requestFixture(kind, state);
    await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
    assert.equal(f.row.status, expected);
    assert.equal(f.sends(), expected === 'SENT' ? 1 : 0);
  });
}

test('a request email is prepared with its requested date', async () => {
  const f = requestFixture('RESCHEDULE_REQUEST_RECEIVED', { status: 'CONFIRMED', requestedAt: OPEN });
  await f.service.dispatchPendingNotifications({ db: f.db as never, now: f.now });
  assert.equal((f.prepared[0] as { requestedDate: Date }).requestedDate.toISOString(), '2099-09-15T09:00:00.000Z');
});

test('request emails are keyed by the request, so a replacement queues new events', async () => {
  const upserts: { eventKey: string }[] = [];
  const db = {
    notificationDelivery: { findUnique: async () => null, upsert: async ({ create }: { create: { eventKey: string } }) => { upserts.push(create); return { id: create.eventKey }; } },
    appointment: {},
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', { '@/app/lib/prisma': db, './email-service': {} });
  const appointment = { id: 'a', date: new Date('2099-09-14T12:00:00Z'), priceAtBooking: null, durationAtBooking: 60, notificationVersion: 3, notes: null, user: { email: 'amy@example.test', name: 'Amy' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 } };
  const requestedDate = new Date('2099-09-15T09:00:00Z');
  await service.enqueueAppointmentNotification(db as never, 'RESCHEDULE_REQUEST_RECEIVED', appointment, { requestedDate, requestedAt: new Date('2099-09-01T11:00:00Z') });
  await service.enqueueAppointmentNotification(db as never, 'RESCHEDULE_REQUEST_RECEIVED', appointment, { requestedDate, requestedAt: new Date('2099-09-01T11:30:00Z') });
  assert.deepEqual(upserts.map((event) => event.eventKey), [
    'appointment/a/3/RESCHEDULE_REQUEST_RECEIVED/2099-09-01T11:00:00.000Z',
    'appointment/a/3/RESCHEDULE_REQUEST_RECEIVED/2099-09-01T11:30:00.000Z',
  ]);
  await assert.rejects(service.enqueueAppointmentNotification(db as never, 'RESCHEDULE_DECLINED', appointment, { requestedDate }), /requestedAt/);
});
