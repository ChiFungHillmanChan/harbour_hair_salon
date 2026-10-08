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
  const env = process.env as Record<string, string | undefined>;
  const previous = { node: env.NODE_ENV, vercel: env.VERCEL_ENV, notifications: env.NOTIFICATIONS_ENABLED };
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
    // A production build with no VERCEL_ENV at runtime: still locked.
    env.NODE_ENV = 'production';
    delete env.VERCEL_ENV;
    env.NOTIFICATIONS_ENABLED = 'true';
    await assert.rejects(maintenance.assertOnlineBookingReady(db as never), (error: unknown) =>
      error instanceof BookingError && error.message === maintenance.BOOKING_MAINTENANCE_MESSAGE);
    assert.equal(await maintenance.isBookingEnabled(), false);
    assert.equal(databaseReads, 0, 'the lock is decided before any database read');
  } finally {
    for (const [key, value] of [['NODE_ENV', previous.node], ['VERCEL_ENV', previous.vercel], ['NOTIFICATIONS_ENABLED', previous.notifications]] as const) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
});

/**
 * Next's Data Cache with the property that matters here: only a callback that
 * RETURNS is stored; one that throws stores nothing and is re-run next time.
 */
function bookingOpenCacheFixture(settings: { bookingEnabled: boolean }) {
  let reachable = false;
  const store = new Map<string, unknown>();
  const db = {
    siteSettings: { findUnique: async () => {
      if (!reachable) throw new Error("Can't reach database server");
      return { ...settings, phone: '01234' };
    } },
    calendarConnection: { count: async () => 0 },
  };
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true, blockers: [] }) },
    '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => ({ ready: true, blockers: [] }) },
    'next/cache': {
      unstable_cache: (read: () => Promise<unknown>, keyParts: string[]) => async () => {
        const key = keyParts.join('/');
        if (!store.has(key)) store.set(key, await read());
        return store.get(key);
      },
    },
  });
  return { maintenance, store, reach: () => { reachable = true; } };
}

async function withOpenBookingEnv(run: () => Promise<void>) {
  const previous = { notifications: process.env.NOTIFICATIONS_ENABLED, calendar: process.env.CALENDAR_SYNC_ENABLED };
  const errors = console.error;
  console.error = () => {};
  try {
    process.env.NOTIFICATIONS_ENABLED = 'true';
    process.env.CALENDAR_SYNC_ENABLED = 'true';
    await run();
  } finally {
    console.error = errors;
    if (previous.notifications === undefined) delete process.env.NOTIFICATIONS_ENABLED; else process.env.NOTIFICATIONS_ENABLED = previous.notifications;
    if (previous.calendar === undefined) delete process.env.CALENDAR_SYNC_ENABLED; else process.env.CALENDAR_SYNC_ENABLED = previous.calendar;
  }
}

test('an unreachable database closes booking for that request only and is never cached as "closed"', async () => {
  await withOpenBookingEnv(async () => {
    const f = bookingOpenCacheFixture({ bookingEnabled: true });
    assert.equal(await f.maintenance.isBookingEnabled(), false, 'a failed read still fails closed…');
    assert.equal(f.store.size, 0, '…but nothing is stored for other visitors');
    f.reach();
    assert.equal(await f.maintenance.isBookingEnabled(), true, 'the very next request sees booking open');
    assert.equal(f.store.get('booking-open'), true);
  });
});

test('a genuinely closed salon is still cached, so closed pages do not query the database on every view', async () => {
  await withOpenBookingEnv(async () => {
    const f = bookingOpenCacheFixture({ bookingEnabled: false });
    f.reach();
    assert.equal(await f.maintenance.isBookingEnabled(), false);
    assert.equal(f.store.get('booking-open'), false, 'the MAINTENANCE answer is stored');
  });
});
