import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const start = resolveSalonDateTime('2026-10-06', '11:00').utc;
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

// Our busy feed publishes each booking to Fresha. If Fresha re-exports what it
// imported, the booking comes back as a synced block with its exact times.
function check(block: { start: Date; end: Date }, id: string, options?: { ignoreOwnEcho?: boolean }) {
  const tx = {
    availability: { findFirst: async () => ({ startTime: '10:00', endTime: '19:00' }) },
    appointment: { findMany: async () => [] },
    externalBusyBlock: { findMany: async () => [{ stylistId: 'lox', ...block }] },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': {}, '@/app/lib/booking-maintenance': {}, './notification-outbox-service': {},
  });
  const appointment = { id, stylistId: 'lox', durationAtBooking: 60, service: { duration: 60 } };
  return service.assertAppointmentSlotAvailable(tx as never, appointment, start, undefined, options);
}

test('Confirm ignores an exact copy of the booking itself', async () => {
  await check({ start, end: minutes(60) }, 'appt-1', { ignoreOwnEcho: true });
});

test('a block one minute longer is a real clash, even on Confirm', async () => {
  await assert.rejects(check({ start, end: minutes(61) }, 'appt-1', { ignoreOwnEcho: true }));
});

test('a block starting one minute earlier is a real clash, even on Confirm', async () => {
  await assert.rejects(check({ start: minutes(-1), end: minutes(59) }, 'appt-1', { ignoreOwnEcho: true }));
});

test('without the flag an identical block still clashes', async () => {
  await assert.rejects(check({ start, end: minutes(60) }, 'appt-1'));
});

test('a brand-new booking never ignores an identical block', async () => {
  await assert.rejects(check({ start, end: minutes(60) }, '', { ignoreOwnEcho: true }));
});
