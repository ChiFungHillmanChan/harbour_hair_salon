import test from 'node:test';
import assert from 'node:assert/strict';
import type { TreatwellApiAdapter, TreatwellSyncableAppointment } from './treatwell-api';
import { syncPendingTreatwellBookings, type TreatwellWorkerDb } from './treatwell-api-worker';

function appointment(overrides: Partial<TreatwellSyncableAppointment> = {}): TreatwellSyncableAppointment {
  return {
    id: 'appointment-1',
    date: new Date('2026-08-01T09:00:00.000Z'),
    status: 'CONFIRMED',
    notes: null,
    treatwellBookingId: null,
    user: { name: 'Ada', email: 'ada@example.com', phone: '07123456789' },
    stylist: { treatwellExternalId: 'staff-1' },
    service: { duration: 60, treatwellExternalId: 'service-1' },
    ...overrides,
  };
}

function fakeDb(rows: TreatwellSyncableAppointment[]) {
  const updates: unknown[] = [];
  const db: TreatwellWorkerDb = {
    appointment: {
      findMany: async () => rows,
      update: async (args) => { updates.push(args); return args; },
    },
  };
  return { db, updates };
}

test('worker sends upserts and records the provider booking id', async () => {
  const { db, updates } = fakeDb([appointment()]);
  const upserts: string[] = [];
  const adapter: TreatwellApiAdapter = {
    ping: async () => ({ latencyMs: 12 }),
    upsertBooking: async (command) => { upserts.push(command.externalReference); return { bookingId: 'tw-99' }; },
    cancelBooking: async () => { throw new Error('not expected'); },
  };

  const result = await syncPendingTreatwellBookings(adapter, {
    db,
    now: new Date('2026-07-21T10:00:00.000Z'),
  });

  assert.deepEqual(upserts, ['harbour-hair:appointment-1']);
  assert.deepEqual(result, [{ appointmentId: 'appointment-1', ok: true, action: 'UPSERT' }]);
  assert.deepEqual(updates[0], {
    where: { id: 'appointment-1' },
    data: {
      treatwellSyncStatus: 'SYNCED',
      treatwellBookingId: 'tw-99',
      treatwellSyncedAt: new Date('2026-07-21T10:00:00.000Z'),
      treatwellSyncError: null,
    },
  });
});

test('worker uses cancellation for a cancelled provider booking', async () => {
  const { db } = fakeDb([appointment({ status: 'CANCELLED', treatwellBookingId: 'tw-99' })]);
  const cancellations: string[] = [];
  const adapter: TreatwellApiAdapter = {
    ping: async () => ({ latencyMs: 12 }),
    upsertBooking: async () => { throw new Error('not expected'); },
    cancelBooking: async (command) => { cancellations.push(command.treatwellBookingId ?? ''); return { bookingId: 'tw-99' }; },
  };

  const result = await syncPendingTreatwellBookings(adapter, { db });

  assert.deepEqual(cancellations, ['tw-99']);
  assert.equal(result[0].action, 'CANCEL');
  assert.equal(result[0].ok, true);
});

test('worker records a mapping failure without calling Treatwell', async () => {
  const { db, updates } = fakeDb([appointment({ service: { duration: 60, treatwellExternalId: null } })]);
  let providerCalled = false;
  const adapter: TreatwellApiAdapter = {
    ping: async () => ({ latencyMs: 12 }),
    upsertBooking: async () => { providerCalled = true; return { bookingId: 'wrong' }; },
    cancelBooking: async () => { providerCalled = true; return { bookingId: 'wrong' }; },
  };

  const result = await syncPendingTreatwellBookings(adapter, { db });

  assert.equal(providerCalled, false);
  assert.equal(result[0].error, 'MISSING_SERVICE_MAPPING');
  assert.deepEqual(updates[0], {
    where: { id: 'appointment-1' },
    data: { treatwellSyncStatus: 'FAILED', treatwellSyncError: 'MISSING_SERVICE_MAPPING' },
  });
});

test('worker preserves a concise provider error for admin retry', async () => {
  const { db, updates } = fakeDb([appointment()]);
  const adapter: TreatwellApiAdapter = {
    ping: async () => ({ latencyMs: 12 }),
    upsertBooking: async () => { throw new Error('Treatwell returned 503'); },
    cancelBooking: async () => { throw new Error('not expected'); },
  };

  const result = await syncPendingTreatwellBookings(adapter, { db });

  assert.equal(result[0].ok, false);
  assert.equal(result[0].error, 'Treatwell returned 503');
  assert.deepEqual(updates[0], {
    where: { id: 'appointment-1' },
    data: { treatwellSyncStatus: 'FAILED', treatwellSyncError: 'Treatwell returned 503' },
  });
});
