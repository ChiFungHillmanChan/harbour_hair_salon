import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTreatwellBookingCommand,
  changedTreatwellSyncStatus,
  getTreatwellApiConfiguration,
  initialTreatwellSyncStatus,
} from './treatwell-api';

test('Treatwell API readiness requires enable flag and all three credentials', () => {
  const config = getTreatwellApiConfiguration({
    TREATWELL_API_ENABLED: 'true',
    TREATWELL_API_BASE_URL: 'https://partner.example.test',
    TREATWELL_API_KEY: 'secret',
    TREATWELL_VENUE_ID: 'venue-1',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.configured, true);
  assert.deepEqual(config.missing, []);
});

test('Treatwell API readiness names missing settings without exposing values', () => {
  const config = getTreatwellApiConfiguration({ TREATWELL_API_ENABLED: 'false' });

  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
  assert.deepEqual(config.missing, [
    'TREATWELL_API_BASE_URL',
    'TREATWELL_API_KEY',
    'TREATWELL_VENUE_ID',
  ]);
});

test('new bookings queue only when the API and both mappings are ready', () => {
  assert.equal(initialTreatwellSyncStatus({
    apiEnabled: true,
    stylistExternalId: 'staff-1',
    serviceExternalId: 'service-1',
  }), 'PENDING');

  assert.equal(initialTreatwellSyncStatus({
    apiEnabled: true,
    stylistExternalId: null,
    serviceExternalId: 'service-1',
  }), 'NOT_REQUIRED');

  assert.equal(initialTreatwellSyncStatus({
    apiEnabled: false,
    stylistExternalId: 'staff-1',
    serviceExternalId: 'service-1',
  }), 'NOT_REQUIRED');
});

test('a previously-synced booking queues cancellation even during an API outage', () => {
  assert.equal(changedTreatwellSyncStatus({
    apiReady: false,
    treatwellBookingId: 'tw-existing',
    stylistExternalId: null,
    serviceExternalId: null,
  }), 'PENDING');
});

test('builds an idempotent provider-neutral upsert command', () => {
  const result = buildTreatwellBookingCommand({
    id: 'appointment-42',
    date: new Date('2026-08-01T09:00:00.000Z'),
    status: 'CONFIRMED',
    notes: 'Patch test complete',
    treatwellBookingId: null,
    user: { name: 'Ada', email: 'ada@example.com', phone: '07123456789' },
    stylist: { treatwellExternalId: 'staff-7' },
    service: { duration: 90, treatwellExternalId: 'service-9' },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.command.externalReference, 'harbour-hair:appointment-42');
  assert.equal(result.command.action, 'UPSERT');
  assert.equal(result.command.startsAt, '2026-08-01T09:00:00.000Z');
  assert.equal(result.command.endsAt, '2026-08-01T10:30:00.000Z');
  assert.equal(result.command.stylistExternalId, 'staff-7');
  assert.equal(result.command.serviceExternalId, 'service-9');
});

test('cancellation keeps the same external reference and provider booking id', () => {
  const result = buildTreatwellBookingCommand({
    id: 'appointment-42',
    date: new Date('2026-08-01T09:00:00.000Z'),
    status: 'CANCELLED',
    notes: null,
    treatwellBookingId: 'tw-booking-88',
    user: { name: null, email: 'guest@example.com', phone: null },
    stylist: { treatwellExternalId: 'staff-7' },
    service: { duration: 30, treatwellExternalId: 'service-9' },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.command.action, 'CANCEL');
  assert.equal(result.command.treatwellBookingId, 'tw-booking-88');
  assert.equal(result.command.externalReference, 'harbour-hair:appointment-42');
});

test('refuses to build a command until both admin mappings exist', () => {
  const result = buildTreatwellBookingCommand({
    id: 'appointment-1',
    date: new Date('2026-08-01T09:00:00.000Z'),
    status: 'CONFIRMED',
    notes: null,
    treatwellBookingId: null,
    user: { name: null, email: 'guest@example.com', phone: null },
    stylist: { treatwellExternalId: 'staff-1' },
    service: { duration: 30, treatwellExternalId: null },
  });

  assert.deepEqual(result, { ok: false, reason: 'MISSING_SERVICE_MAPPING' });
});

test('outbound API command uses duration captured at booking after service edits', () => {
  const appointment = {
    id: 'a', date: new Date('2026-09-12T09:00:00Z'), status: 'CONFIRMED', notes: null,
    treatwellBookingId: null, durationAtBooking: 90,
    user: { name: null, email: 'a@example.com', phone: null },
    stylist: { treatwellExternalId: 'staff' }, service: { duration: 30, treatwellExternalId: 'service' },
  };
  const result = buildTreatwellBookingCommand(appointment);
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.command.endsAt, '2026-09-12T10:30:00.000Z');
});
