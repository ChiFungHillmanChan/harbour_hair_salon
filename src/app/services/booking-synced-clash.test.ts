import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const start = resolveSalonDateTime('2026-10-06', '11:00').utc;
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

// Verified live on 2026-09-29: Fresha shows our busy feed as "Imported event"
// blocked time but never puts it back into its own export, so a synced block
// with a booking's exact times is a genuine Fresha booking, not our own copy.
// Confirm must treat it as a clash — ignoring it would hide a double booking.
function check(block: { start: Date; end: Date }, id: string) {
  const tx = {
    availability: { findFirst: async () => ({ startTime: '10:00', endTime: '19:00' }) },
    appointment: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => [{ stylistId: 'lox', ...block }] },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': {}, '@/app/lib/booking-maintenance': {}, './notification-outbox-service': {},
  });
  const appointment = { id, stylistId: 'lox', durationAtBooking: 60, service: { duration: 60 } };
  return service.assertAppointmentSlotAvailable(tx as never, appointment, start);
}

test('confirming an existing booking is refused by a synced block with its exact times', async () => {
  await assert.rejects(check({ start, end: minutes(60) }, 'appt-1'), (error: { code?: string }) => error.code === 'SLOT_UNAVAILABLE');
});

test('a partly overlapping synced block is refused too', async () => {
  await assert.rejects(check({ start: minutes(-1), end: minutes(59) }, 'appt-1'));
});

test('a brand-new booking is refused by an identical synced block', async () => {
  await assert.rejects(check({ start, end: minutes(60) }, ''));
});

test('a synced block that ends as the booking starts does not clash', async () => {
  await check({ start: minutes(-60), end: start }, 'appt-1');
});
