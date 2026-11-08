import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { BookingError } from '@/app/services/booking-errors';

test('what a signed-out visitor is told follows the switch and the two environment guards, with no query', () => {
  const previous = process.env.NOTIFICATIONS_ENABLED;
  let locked = false;
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': {}, // any query would throw
    '@/app/lib/online-booking-lock': { isOnlineBookingLockedForPayments: () => locked },
    '@/app/services/integration-readiness': {},
    '@/app/services/operations-readiness': {},
    'next/cache': { unstable_cache: (callback: () => Promise<boolean>) => callback },
  });
  try {
    process.env.NOTIFICATIONS_ENABLED = 'true';
    assert.equal(maintenance.isBookingAdvertised(true), true);
    assert.equal(maintenance.isBookingAdvertised(false), false);
    locked = true;
    assert.equal(maintenance.isBookingAdvertised(true), false);
    locked = false;
    process.env.NOTIFICATIONS_ENABLED = 'false';
    assert.equal(maintenance.isBookingAdvertised(true), false);
  } finally {
    if (previous === undefined) delete process.env.NOTIFICATIONS_ENABLED;
    else process.env.NOTIFICATIONS_ENABLED = previous;
  }
});

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

const SQUARE_PRODUCTION = {
  SQUARE_PAYMENTS_ENABLED: 'true',
  SQUARE_ENVIRONMENT: 'production',
  SQUARE_ACCESS_TOKEN: 'production-access-token',
  SQUARE_APPLICATION_ID: 'sq0idp-production-application',
  SQUARE_LOCATION_ID: 'production-location',
  SQUARE_WEBHOOK_SIGNATURE_KEY: 'production-signature-key',
  SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://www.harbourhair.co.uk/api/webhooks/square',
};

/** A production build with no VERCEL_ENV at runtime, notifications on and exactly these Square variables. */
async function inProductionRuntime(square: Record<string, string>, run: () => Promise<void>) {
  const env = process.env as Record<string, string | undefined>;
  const keys = ['NODE_ENV', 'VERCEL_ENV', 'NOTIFICATIONS_ENABLED', 'CALENDAR_SYNC_ENABLED', ...Object.keys(SQUARE_PRODUCTION)];
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  for (const key of keys) delete env[key];
  Object.assign(env, { NODE_ENV: 'production', NOTIFICATIONS_ENABLED: 'true', CALENDAR_SYNC_ENABLED: 'true' }, square);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

function readyProductionFixture() {
  let databaseReads = 0;
  const db = {
    siteSettings: { findUnique: async () => { databaseReads++; return { bookingEnabled: true, phone: '01234' }; } },
    calendarConnection: { count: async () => 0 },
  };
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true }) },
    '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => ({ ready: true }) },
    // A cache warmed by a run that saw booking open must not reopen it.
    'next/cache': { unstable_cache: () => async () => true },
  });
  return { maintenance, db, reads: () => databaseReads };
}

test('production stays closed without Square production credentials, even with a fully ready database and a warm open cache', async () => {
  for (const square of [{}, { ...SQUARE_PRODUCTION, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application' }]) {
    await inProductionRuntime(square, async () => {
      const f = readyProductionFixture();
      await assert.rejects(f.maintenance.assertOnlineBookingReady(f.db as never), (error: unknown) =>
        error instanceof BookingError && error.message === f.maintenance.BOOKING_MAINTENANCE_MESSAGE);
      assert.equal(await f.maintenance.isBookingEnabled(), false);
      assert.equal(f.reads(), 0, 'the lock is decided before any database read');
    });
  }
});

test('with Square production credentials, production opens when the switch and every gate allow it', async () => {
  await inProductionRuntime(SQUARE_PRODUCTION, async () => {
    const f = readyProductionFixture();
    assert.equal((await f.maintenance.assertOnlineBookingReady(f.db as never)).phone, '01234');
    assert.equal(await f.maintenance.isBookingEnabled(), true);
  });
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

// ── Beta booking (owner decision 2026-10-18) ────────────────────────────────
// While the public gate is closed, a signed-in account on the beta list
// (SiteSettings.bookingBetaEmails) still books online. The public functions
// above keep their meaning; the *For variants add the beta check.

type BetaOptions = {
  list?: string;
  email?: string | null;
  calendarReady?: boolean;
  channels?: number;
  bookingEnabled?: boolean;
  settingsError?: boolean;
};

function betaFixture(options: BetaOptions = {}) {
  const calls: string[] = [];
  const db = {
    siteSettings: { findUnique: async () => {
      calls.push('settings');
      if (options.settingsError) throw new Error("Can't reach database server");
      return { bookingEnabled: options.bookingEnabled ?? false, phone: '01234', bookingBetaEmails: options.list ?? 'someone@example.com, hillmanchan709@gmail.com' };
    } },
    user: { findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => {
      calls.push(`user:${where.id}`);
      assert.deepEqual(select, { email: true }, 'the beta check reads the email alone');
      return options.email === null ? null : { email: options.email ?? 'HillmanChan709@Gmail.com' };
    } },
    calendarConnection: { count: async () => { calls.push('channels'); return options.channels ?? 0; } },
  };
  const maintenance = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
    '@/app/lib/prisma': db,
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async (tx: unknown) => {
      calls.push('calendar');
      assert.equal(tx, db);
      return { ready: options.calendarReady ?? true, blockers: [] };
    } },
    // Fails while notifications are off: beta booking must not depend on it.
    '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => { calls.push('operations'); return { ready: false, blockers: ['notifications'] }; } },
    'next/cache': { unstable_cache: (callback: () => Promise<boolean>) => callback },
  });
  return { maintenance, db, calls };
}

/** Production's flags today: booking emails off, calendar sync on. */
async function withClosedProductionFlags(run: () => Promise<void>, overrides: Record<string, string | undefined> = {}) {
  const env = process.env as Record<string, string | undefined>;
  const keys = ['NOTIFICATIONS_ENABLED', 'CALENDAR_SYNC_ENABLED'];
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  const errors = console.error;
  console.error = () => {};
  try {
    delete env.NOTIFICATIONS_ENABLED;
    env.CALENDAR_SYNC_ENABLED = 'true';
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
    await run();
  } finally {
    console.error = errors;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
}

const isMaintenance = (error: unknown) => error instanceof BookingError && error.code === 'MAINTENANCE';

test('beta: while booking is closed, a tester on the list is let in, matched case-insensitively', async () => {
  await withClosedProductionFlags(async () => {
    const f = betaFixture();
    await assert.rejects(f.maintenance.assertOnlineBookingReady(f.db as never), isMaintenance, 'the public gate is unchanged');
    assert.deepEqual(await f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-1'), { bookingEnabled: false, phone: '01234' });
    assert.equal(await f.maintenance.isBookingEnabled(), false, 'the public answer is unchanged');
    assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), true);
    assert.equal(await f.maintenance.isBetaBookingOpenFor('user-1'), true);
    assert.equal(f.calls.includes('operations'), false, 'operations readiness (which needs notifications) is not required');
  });
});

test('beta: a signed-in account that is not on the list stays closed', async () => {
  await withClosedProductionFlags(async () => {
    for (const options of [{ email: 'stranger@example.com' }, { email: null }, { list: '' }, { list: 'hillmanchan709@gmail.co' }] as BetaOptions[]) {
      const f = betaFixture(options);
      await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-2'), isMaintenance, JSON.stringify(options));
      assert.equal(await f.maintenance.isBookingEnabledFor('user-2'), false, JSON.stringify(options));
      assert.equal(f.calls.includes('calendar'), false, 'no calendar readiness for a non-tester');
    }
    // An empty list costs one query: the account is never read.
    const empty = betaFixture({ list: '  ' });
    assert.equal(await empty.maintenance.isBookingEnabledFor('user-2'), false);
    assert.deepEqual(empty.calls, ['settings']);
  });
});

test('beta: an anonymous caller while booking is closed is refused without a single query', async () => {
  await withClosedProductionFlags(async () => {
    const f = betaFixture();
    for (const userId of [undefined, null, '']) {
      await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, userId), isMaintenance);
      assert.equal(await f.maintenance.isBookingEnabledFor(userId), false);
      assert.equal(await f.maintenance.isBetaBookingOpenFor(userId), false);
    }
    assert.deepEqual(f.calls, [], 'no database read for a signed-out visitor (Neon rule)');
  });
});

test('beta: production still needs Square production credentials, decided before any query', async () => {
  for (const square of [{}, { ...SQUARE_PRODUCTION, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application' }]) {
    await inProductionRuntime(square, async () => {
      await withClosedProductionFlags(async () => {
        const f = betaFixture();
        await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-1'), isMaintenance);
        assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), false);
        assert.deepEqual(f.calls, [], 'the payments lock answers first');
      });
    });
  }
  await inProductionRuntime(SQUARE_PRODUCTION, async () => {
    await withClosedProductionFlags(async () => {
      const f = betaFixture();
      assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), true, 'with production keys a tester books while notifications are off');
      assert.equal(await f.maintenance.isBookingEnabled(), false, 'and the public stays closed');
    });
  });
});

test('beta: a tester is refused when the calendars are not ready, or channels receive bookings without calendar sync', async () => {
  await withClosedProductionFlags(async () => {
    const f = betaFixture({ calendarReady: false });
    await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-1'), isMaintenance);
    assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), false);
  });
  await withClosedProductionFlags(async () => {
    const f = betaFixture({ channels: 1 });
    await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-1'), isMaintenance);
    assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), false);
  }, { CALENDAR_SYNC_ENABLED: 'false' });
  await withClosedProductionFlags(async () => {
    const f = betaFixture({ channels: 0 });
    assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), true, 'no receiving channel: calendar sync is not needed');
  }, { CALENDAR_SYNC_ENABLED: 'false' });
});

test('beta: when the public gate is open, the beta list is never consulted', async () => {
  await withClosedProductionFlags(async () => {
    const f = betaFixture({ bookingEnabled: true, email: 'stranger@example.com' });
    // Booking is open to everyone here (operations readiness passes below).
    const open = loadServerModule<typeof import('./booking-maintenance')>('src/app/lib/booking-maintenance.ts', {
      '@/app/lib/prisma': f.db,
      '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: true, blockers: [] }) },
      '@/app/services/operations-readiness': { checkOperationsRuntimeReadiness: async () => ({ ready: true, blockers: [] }) },
      'next/cache': { unstable_cache: (callback: () => Promise<boolean>) => callback },
    });
    const settings = await open.assertOnlineBookingReadyFor(f.db as never, 'user-2');
    assert.equal(settings.bookingEnabled, true);
    assert.equal(settings.phone, '01234');
    assert.equal(await open.isBookingEnabledFor('user-2'), true);
    assert.equal(await open.isBookingEnabledFor(null), true);
    assert.equal(f.calls.some((call) => call.startsWith('user:')), false);
  }, { NOTIFICATIONS_ENABLED: 'true' });
});

test('beta: a database fault propagates from the booking gate, and closes the page check for that request only', async () => {
  await withClosedProductionFlags(async () => {
    const f = betaFixture({ settingsError: true });
    await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-1'), /reach database/, 'never turned into MAINTENANCE');
    assert.equal(await f.maintenance.isBookingEnabledFor('user-1'), false);
    assert.equal(await f.maintenance.isBetaBookingOpenFor('user-1'), false);
  });
  // With the public gate reachable, its own faults propagate untouched too.
  await withClosedProductionFlags(async () => {
    const f = betaFixture({ settingsError: true });
    await assert.rejects(f.maintenance.assertOnlineBookingReadyFor(f.db as never, 'user-1'), /reach database/);
    assert.deepEqual(f.calls, ['settings'], 'the beta check is not tried after a fault');
  }, { NOTIFICATIONS_ENABLED: 'true' });
});
