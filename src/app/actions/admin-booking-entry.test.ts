import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { isPlaceholderEmail, placeholderEmailFor, displayableEmail } from '../lib/walk-in-customer';

// The salon takes bookings by phone and WhatsApp all day. These cover the entry
// path for work that never touched the website.

const SLOT = { dateStr: '2099-09-15', time: '11:00' }; // 10:00Z — BST
const UPDATED_AT = new Date('2099-09-01T00:00:00Z');

type Row = Record<string, unknown>;

function fixture(options: { role?: string; conflicting?: boolean; existingUser?: Row | null } = {}) {
  const users: Row[] = options.existingUser ? [options.existingUser] : [];
  const created: Row[] = [];
  const updates: Row[] = [];
  const enqueued: string[] = [];
  let transactionActive = false;
  let dispatches = 0;

  const appointment = {
    id: 'appt-1', userId: 'user-1', stylistId: 'stylist-1', serviceId: 'service-1',
    date: new Date('2099-09-15T09:00:00Z'), status: 'CONFIRMED',
    durationAtBooking: 60, priceAtBooking: 80, notificationVersion: 0, notes: null,
    reminderSent: true, updatedAt: UPDATED_AT, treatwellBookingId: null,
    user: { name: 'Sarah W.', email: 'sarah@example.test', phone: null },
    stylist: { name: 'Ivan', treatwellExternalId: null },
    service: { id: 'service-1', name: 'Full Colour', duration: 60, price: 80, requiresPatchTest: false, treatwellExternalId: null },
  };

  const clashing = {
    id: 'other', stylistId: 'stylist-1', status: 'CONFIRMED',
    date: new Date('2099-09-15T10:00:00Z'), durationAtBooking: 60,
    user: { name: 'Mei L.' }, service: { duration: 60 },
  };

  const services: Record<string, Row> = {
    'service-1': { id: 'service-1', name: 'Full Colour', duration: 60, price: 80, requiresPatchTest: false, treatwellExternalId: null },
    'service-2': { id: 'service-2', name: 'Dry Cut', duration: 30, price: 35, requiresPatchTest: false, treatwellExternalId: null },
  };

  const tx = {
    appointment: {
      findUnique: async () => structuredClone(appointment),
      findMany: async ({ where }: { where: Row }) => {
        if (where && 'service' in where) return []; // patch-test history
        return options.conflicting ? [clashing] : [];
      },
      create: async ({ data }: { data: Row }) => {
        created.push(data);
        return {
          ...data, id: 'new-appt', notificationVersion: 0,
          user: users[0] ?? { email: data.userId === 'user-1' ? 'sarah@example.test' : '', name: 'Walk-in', phone: null },
          stylist: { name: 'Ivan' },
          service: { name: 'Full Colour', price: 80, duration: 60 },
        };
      },
      updateMany: async ({ data }: { data: Row }) => {
        updates.push(data);
        return { count: 1 };
      },
    },
    service: { findUnique: async ({ where }: { where: { id: string } }) => services[where.id] ?? null },
    stylist: { findUnique: async () => ({ id: 'stylist-1', isActive: true, treatwellExternalId: null }) },
    user: {
      findUnique: async ({ where }: { where: Row }) =>
        users.find((row) => (where.id && row.id === where.id) || (where.email && row.email === where.email)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, id: `user-${users.length + 1}` };
        users.push(row);
        return row;
      },
      update: async ({ data }: { data: Row }) => { updates.push(data); return users[0]; },
    },
    availability: { findFirst: async () => ({ startTime: '09:00', endTime: '18:00' }) },
    externalBusyBlock: { findMany: async () => [] },
  };

  const db = {
    ...tx,
    $transaction: async (fn: (client: unknown) => Promise<unknown>) => {
      transactionActive = true;
      try { return await fn(tx); } finally { transactionActive = false; }
    },
  };

  const queue = {
    enqueueAppointmentNotification: async (client: unknown, kind: string) => {
      assert.equal(client, tx, 'enqueue must use the appointment transaction client');
      assert.equal(transactionActive, true, 'enqueue must happen before commit');
      enqueued.push(kind);
      return { id: `event-${enqueued.length}` };
    },
    dispatchAppointmentNotifications: async () => { dispatches++; },
  };

  const bookingService = loadServerModule<typeof import('../services/booking-service')>(
    'src/app/services/booking-service.ts',
    {
      '@/app/lib/prisma': db,
      './offers-service': { getActiveGlobalOffer: async () => null },
      '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ phone: '', bookingEnabled: true }) },
      './notification-outbox-service': queue,
    },
  );

  const actions = loadServerModule<typeof import('./admin-schedule')>('src/app/actions/admin-schedule.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/services/booking-service': bookingService,
    '@/app/services/notification-outbox-service': queue,
    '@/app/services/offers-service': { getActiveGlobalOffer: async () => null },
    '@/app/services/treatwell-api': {
      getTreatwellApiConfiguration: () => ({ enabled: false, configured: false }),
      changedTreatwellSyncStatus: () => 'NOT_REQUIRED',
      initialTreatwellSyncStatus: () => 'NOT_REQUIRED',
    },
    'next/cache': { revalidatePath: () => undefined },
  });

  return { actions, created, updates, users, enqueued, appointment, dispatches: () => dispatches };
}

const newBooking = (overrides: Row = {}) => ({
  customer: { kind: 'new' as const, name: 'Walk-in Wendy', email: '', phone: '07700900123' },
  serviceId: 'service-1',
  stylistId: 'stylist-1',
  ...SLOT,
  durationMin: 60,
  status: 'CONFIRMED' as const,
  notes: 'Booked over WhatsApp',
  notifyCustomer: true,
  overrideClashes: false,
  ...overrides,
});

test('a phone booking for someone with no email is saved and mails nobody', async () => {
  const { actions, created, users, enqueued } = fixture();

  const result = await actions.createAppointmentByAdmin(newBooking());

  assert.equal(result.success, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, 'CONFIRMED');
  assert.equal(created[0].notes, 'Booked over WhatsApp');
  assert.ok(isPlaceholderEmail(users[0].email as string), 'a customer with no email gets an unroutable placeholder');
  assert.deepEqual(enqueued, [], 'an address that cannot resolve must never reach the outbox');
});

test('a walk-in with a real email is confirmed by email when asked', async () => {
  const { actions, enqueued, dispatches } = fixture();

  await actions.createAppointmentByAdmin(newBooking({
    customer: { kind: 'new', name: 'Ada', email: 'ada@example.test', phone: '' },
  }));

  assert.deepEqual(enqueued, ['CONFIRMATION']);
  assert.equal(dispatches(), 1, 'delivery starts after the transaction commits');
});

test('unticking the confirmation email suppresses it', async () => {
  const { actions, enqueued } = fixture();

  await actions.createAppointmentByAdmin(newBooking({
    customer: { kind: 'new', name: 'Ada', email: 'ada@example.test', phone: '' },
    notifyCustomer: false,
  }));

  assert.deepEqual(enqueued, []);
});

test('a booking pencilled in as a request is never announced as confirmed', async () => {
  const { actions, created, enqueued } = fixture();

  await actions.createAppointmentByAdmin(newBooking({
    customer: { kind: 'new', name: 'Ada', email: 'ada@example.test', phone: '' },
    status: 'PENDING',
  }));

  assert.equal(created[0].status, 'PENDING');
  assert.deepEqual(enqueued, [], 'only a CONFIRMED booking may send a confirmation');
});

test('a clashing slot is reported rather than written, and can be overridden', async () => {
  const { actions, created } = fixture({ conflicting: true });

  const refused = await actions.createAppointmentByAdmin(newBooking());
  assert.equal(refused.success, false);
  assert.ok('clashes' in refused && refused.clashes.some((clash) => clash.kind === 'OVERLAP'));
  assert.equal(created.length, 0, 'a warned booking must not be written');

  const forced = await actions.createAppointmentByAdmin(newBooking({ overrideClashes: true }));
  assert.equal(forced.success, true);
  assert.equal(created.length, 1, 'the salon may deliberately double-book once told what it collides with');
});

test('a repeat phone booking reuses the customer the email already belongs to', async () => {
  const { actions, created, users } = fixture({
    existingUser: { id: 'user-9', email: 'ada@example.test', name: 'Ada', role: 'USER', phone: null },
  });

  await actions.createAppointmentByAdmin(newBooking({
    customer: { kind: 'new', name: 'Ada', email: 'ada@example.test', phone: '07700900999' },
  }));

  assert.equal(users.length, 1, 'no duplicate row for a customer already on file');
  assert.equal(created[0].userId, 'user-9');
});

test('a non-admin cannot create a booking', async () => {
  const { actions, created } = fixture({ role: 'USER' });

  const result = await actions.createAppointmentByAdmin(newBooking());

  assert.deepEqual(result, { success: false, error: 'Not authorised' });
  assert.equal(created.length, 0);
});

test('a booking with no customer name is refused before it reaches the database', async () => {
  const { actions, created } = fixture();

  const result = await actions.createAppointmentByAdmin(newBooking({
    customer: { kind: 'new', name: '   ', email: '', phone: '' },
  }));

  assert.equal(result.success, false);
  assert.equal(created.length, 0);
});

test('swapping the service on an existing booking re-freezes its price', async () => {
  const { actions, updates } = fixture();

  const result = await actions.editAppointmentByAdmin({
    appointmentId: 'appt-1',
    ...SLOT,
    durationMin: 30,
    stylistId: 'stylist-1',
    serviceId: 'service-2',
    notes: '',
    overrideClashes: false,
    expectedUpdatedAt: UPDATED_AT.toISOString(),
  });

  assert.equal(result.success, true);
  const write = updates.at(-1)!;
  assert.equal(write.serviceId, 'service-2');
  assert.equal(write.priceAtBooking, 35, 'the diary and the bill must agree on which service was done');
});

test('editing only the notes leaves the price and the customer undisturbed', async () => {
  const { actions, updates, enqueued } = fixture();

  await actions.editAppointmentByAdmin({
    appointmentId: 'appt-1',
    dateStr: '2099-09-15',
    time: '10:00', // the booking's existing start
    durationMin: 60,
    stylistId: 'stylist-1',
    notes: 'Allergic to ammonia',
    overrideClashes: false,
    expectedUpdatedAt: UPDATED_AT.toISOString(),
  });

  const write = updates.at(-1)!;
  assert.equal(write.notes, 'Allergic to ammonia');
  assert.ok(!('priceAtBooking' in write), 'a note is not a re-billing event');
  assert.deepEqual(enqueued, [], 'a note the customer never sees is not worth an email');
});

test('placeholder addresses are recognisable and never shown back to an admin', () => {
  const placeholder = placeholderEmailFor('abc-123');
  assert.ok(isPlaceholderEmail(placeholder));
  assert.equal(displayableEmail(placeholder), '');
  assert.equal(isPlaceholderEmail('ada@example.test'), false);
  assert.equal(displayableEmail('ada@example.test'), 'ada@example.test');
  assert.notEqual(placeholderEmailFor('abc-123'), placeholderEmailFor('def-456'), 'two walk-ins must not collide');
});
