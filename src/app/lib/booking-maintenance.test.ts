import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from '@/app/services/booking-errors';

test('disabled notifications close both readiness paths without reading the database or cache', async () => {
  const previous = process.env.NOTIFICATIONS_ENABLED;
  let databaseReads = 0;
  let cacheReads = 0;
  const db = { siteSettings: { findUnique: async () => {
    databaseReads++;
    return { bookingEnabled: true, phone: '01234' };
  } } };
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => { assert.fail('calendar readiness must not query while disabled'); } },
    '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => { assert.fail('operations readiness must not query while disabled'); } },
    'next/cache': { unstable_cache: (callback: () => Promise<boolean>) => async () => { cacheReads++; return callback(); } },
  });
  try {
    for (const flag of [undefined, 'false', 'TRUE']) {
      if (flag === undefined) delete process.env.NOTIFICATIONS_ENABLED;
      else process.env.NOTIFICATIONS_ENABLED = flag;
      await assert.rejects(maintenance.assertOnlineBookingReady(db as never), (error: unknown) =>
        error instanceof BookingError && error.message === maintenance.BOOKING_MAINTENANCE_MESSAGE);
      assert.equal(await maintenance.isBookingEnabled(), false);
      assert.equal(databaseReads, 0, 'the runtime switch must precede every readiness query');
      assert.equal(cacheReads, 0, 'disabled page checks must not enter the database-backed cache');
    }
  } finally {
    if (previous === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = previous;
  }
});

test('disabling notifications overrides a previously cached open booking page immediately', async () => {
  const previous = process.env.NOTIFICATIONS_ENABLED;
  let cacheReads = 0;
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': {},
    '@/app/services/integration-readiness': {},
    '@/app/services/operations-readiness': {},
    // Model a warm shared cache left by an enabled deployment. Its callback
    // would not run on a hit, so the runtime switch has to be outside the cache.
    'next/cache': { unstable_cache: () => async () => { cacheReads++; return true; } },
  });
  try {
    process.env.NOTIFICATIONS_ENABLED = 'true';
    assert.equal(await maintenance.isBookingEnabled(), true);
    process.env.NOTIFICATIONS_ENABLED = 'false';
    assert.equal(await maintenance.isBookingEnabled(), false);
    assert.equal(cacheReads, 1, 'the disabled runtime must not reuse the old true result');
  } finally {
    if (previous === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = previous;
  }
});

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

test('the admin booking switch closes booking even when every other gate passes', async () => {
  // Admin -> Settings "booking off" must close online booking on its own; the
  // calendar and operational gates below it must not be what decides.
  const previous = { notifications: process.env.NOTIFICATIONS_ENABLED, calendar: process.env.CALENDAR_SYNC_ENABLED };
  try {
    process.env.NOTIFICATIONS_ENABLED = 'true';
    process.env.CALENDAR_SYNC_ENABLED = 'true';
    for (const settings of [{ bookingEnabled: false, phone: '01234' }, null]) {
      const db = { siteSettings: { findUnique: async () => settings }, calendarConnection: { count: async () => 0 } };
      const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
        '@/app/lib/prisma': db,
        '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true, blockers: [] }) },
        '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => ({ ready: true, blockers: [] }) },
        'next/cache': { unstable_cache: (callback: () => Promise<boolean>) => callback },
      });
      await assert.rejects(maintenance.assertOnlineBookingReady(db as never), (error: unknown) =>
        error instanceof BookingError && error.message === maintenance.BOOKING_MAINTENANCE_MESSAGE, JSON.stringify(settings));
      assert.equal(await maintenance.isBookingEnabled(), false, JSON.stringify(settings));
    }
  } finally {
    if (previous.notifications === undefined) delete process.env.NOTIFICATIONS_ENABLED; else process.env.NOTIFICATIONS_ENABLED = previous.notifications;
    if (previous.calendar === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = previous.calendar;
  }
});

test('production stays closed until Square deposits are wired, even with a fully ready database and a warm open cache', async () => {
  const previous = { vercel: process.env.VERCEL_ENV, notifications: process.env.NOTIFICATIONS_ENABLED };
  let databaseReads = 0;
  const db = { siteSettings: { findUnique: async () => { databaseReads++; return { bookingEnabled: true, phone: '01234' }; } } };
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true }) },
    '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => ({ ready: true }) },
    // A cache warmed by a run that saw booking open must not reopen it.
    'next/cache': { unstable_cache: () => async () => true },
  });
  try {
    process.env.VERCEL_ENV = 'production';
    process.env.NOTIFICATIONS_ENABLED = 'true';
    await assert.rejects(maintenance.assertOnlineBookingReady(db as never), (error: unknown) =>
      error instanceof BookingError && error.message === maintenance.BOOKING_MAINTENANCE_MESSAGE);
    assert.equal(await maintenance.isBookingEnabled(), false);
    assert.equal(databaseReads, 0, 'the lock is decided before any database read');
  } finally {
    for (const [key, value] of [['VERCEL_ENV', previous.vercel], ['NOTIFICATIONS_ENABLED', previous.notifications]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
