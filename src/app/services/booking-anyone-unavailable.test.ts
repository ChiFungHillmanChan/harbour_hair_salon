import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

function fixture(blocks: { stylistId: string; start: Date; end: Date }[]) {
  const stored: Record<string, unknown>[] = [];
  const liveService = {
    id: 'service-1', name: 'Cut', price: '100.00', duration: 60, treatwellExternalId: null, requiresPatchTest: false, requiresConsultation: false, isConsultation: false, isPatchTest: false,
    offeringId: null, hairLength: null, priceType: 'STANDARD', priceVersion: 1, vatDisplay: 'EXCLUDED', priceNature: 'LISTED',
    durationConfirmed: true, surchargeBaseServiceId: null, surchargeAmount: null, priceSource: 'test', isPublic: true, isBookable: true,
  };
  const tx = {
    service: { findUnique: async () => liveService },
    stylist: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, isActive: true, treatwellExternalId: null }) },
    availability: { findFirst: async () => ({ startTime: '10:00', endTime: '19:00' }) },
    appointment: {
      count: async () => 0,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'appointment-1', notificationVersion: 0, ...data, user: { name: 'C', email: 'c@example.test', phone: null }, stylist: { name: String(data.stylistId) }, service: liveService };
        stored.push(row);
        return row;
      },
    },
    externalBusyBlock: { findMany: async ({ where }: { where: { stylistId: { in: string[] } } }) => blocks.filter((block) => where.stylistId.in.includes(block.stylistId)) },
  };
  const db = { ...tx, $transaction: async (fn: (database: typeof tx) => Promise<unknown>) => fn(tx) };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({ bookingEnabled: true, phone: '0' }) },
    './notification-outbox-service': { enqueueAppointmentNotification: async () => undefined },
  });
  return { service, stored };
}

const tuesday = (time: string) => resolveSalonDateTime('2026-10-06', time).utc;

test('Anyone skips a stylist on a Fresha Pause even when they are first in priority order', async () => {
  const f = fixture([{ stylistId: 'funky', start: tuesday('10:00'), end: tuesday('20:30') }]);
  await f.service.createBookingForFirstAvailable({ serviceId: 'service-1', date: tuesday('11:00'), userId: 'user-1', candidateStylistIds: ['funky', 'lox'] });
  assert.equal(f.stored[0].stylistId, 'lox');
});

test('Anyone refuses the time when every candidate is unavailable', async () => {
  const f = fixture([
    { stylistId: 'funky', start: tuesday('10:00'), end: tuesday('20:30') },
    { stylistId: 'lox', start: tuesday('11:00'), end: tuesday('12:00') },
  ]);
  await assert.rejects(
    f.service.createBookingForFirstAvailable({ serviceId: 'service-1', date: tuesday('11:00'), userId: 'user-1', candidateStylistIds: ['funky', 'lox'] }),
    (error: { code?: string }) => error.code === 'NO_STYLIST_AT_TIME',
  );
  assert.equal(f.stored.length, 0);
});
