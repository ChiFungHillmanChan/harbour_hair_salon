import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from '@/app/services/booking-errors';

test('public booking checks current operational readiness and active calendar scheduling', async () => {
  const previous = { notifications: process.env.NOTIFICATIONS_ENABLED, calendar: process.env.CALENDAR_SYNC_ENABLED };
  try {
    process.env.NOTIFICATIONS_ENABLED = 'true';
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    for (const scenario of [
      { operational: false, channels: 0, allowed: false },
      { operational: true, channels: 1, allowed: false },
      { operational: true, channels: 0, allowed: true },
    ]) {
      const db = { siteSettings: { findUnique: async () => ({ bookingEnabled: true, phone: '01234' }) },
        calendarConnection: { count: async () => scenario.channels } };
      const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
        '@/app/lib/prisma': db,
        '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true, blockers: [] }) },
        '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async (tx: unknown) => {
          assert.equal(tx, db);
          return { ready: scenario.operational, blockers: scenario.operational ? [] : ['Private operational error'] };
        } },
      });
      if (scenario.allowed) assert.equal((await maintenance.assertOnlineBookingReady(db as never)).phone, '01234');
      else await assert.rejects(maintenance.assertOnlineBookingReady(db as never), (error: unknown) =>
        error instanceof BookingError && error.message === maintenance.BOOKING_MAINTENANCE_MESSAGE);
    }
  } finally {
    if (previous.notifications === undefined) delete process.env.NOTIFICATIONS_ENABLED; else process.env.NOTIFICATIONS_ENABLED = previous.notifications;
    if (previous.calendar === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = previous.calendar;
  }
});
