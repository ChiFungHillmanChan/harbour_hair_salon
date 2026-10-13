import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

function fixture(options: { role?: string; calendarReady?: boolean; operationsReady?: boolean; activeChannels?: number; outage?: boolean; currentlyEnabled?: boolean } = {}) {
  const saved = { bookingEnabled: options.currentlyEnabled ?? false, phone: '01234567890' };
  const readinessCalls = { calendar: 0, operations: 0 };
  const tx = {
    auditEvent: { create: async () => ({ id: "audit" }) },
    siteSettings: {
      findUnique: async () => ({ bookingEnabled: saved.bookingEnabled }),
      upsert: async ({ update }: { update: Record<string, unknown> }) => { Object.assign(saved, update); return saved; },
    },
    calendarConnection: { count: async () => options.activeChannels ?? 0 },
  };
  const actions = loadServerModule<typeof import('./admin-settings')>('src/app/actions/admin-settings.ts', {
    '@/app/lib/prisma': { $transaction: async (run: (client: unknown) => Promise<unknown>, config: { isolationLevel: string }) => {
      assert.equal(config.isolationLevel, 'Serializable');
      return run(tx);
    } },
    '@/app/lib/session': { verifySession: async () => ({ role: options.role ?? 'ADMIN' }) },
    '@/app/services/integration-readiness': { checkCalendarBookingReadiness: async (client: unknown) => {
      assert.equal(client, tx);
      readinessCalls.calendar++;
      if (options.outage) throw new Error('Provider unavailable');
      return { ready: options.calendarReady !== false, blockers: options.calendarReady === false ? ['Calendar coverage missing.'] : [] };
    } },
    '@/app/services/operations-readiness': { checkOperationsBookingReadiness: async (client: unknown) => {
      assert.equal(client, tx);
      readinessCalls.operations++;
      if (options.outage) throw new Error('Provider unavailable');
      return { ready: options.operationsReady !== false, blockers: options.operationsReady === false ? ['Operational checks have not passed.'] : [] };
    } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { updateTag() {}, revalidatePath() {} },
  });
  const form = new FormData();
  form.set('phone', '09876543210');
  return { actions, form, saved, readinessCalls };
}

test('closing booking remains possible when readiness providers are unavailable', async () => {
  const f = fixture({ outage: true, currentlyEnabled: true });
  assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'success');
  assert.equal(f.saved.bookingEnabled, false);
});

test('enabling requires both calendar and operational evidence before any settings are saved', async () => {
  for (const options of [{ calendarReady: false }, { operationsReady: false }]) {
    const f = fixture(options);
    f.form.set('bookingEnabled', 'on');
    assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'error');
    assert.equal(f.saved.phone, '01234567890');
  }
});

test('passing all readiness checks allows enabled settings to be saved', async () => {
  const f = fixture();
  f.form.set('bookingEnabled', 'on');
  assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'success');
  assert.equal(f.saved.bookingEnabled, true);
  assert.equal(f.saved.phone, '09876543210');
});

test('active booking channels require enabled calendar scheduling', async () => {
  const previous = process.env.CALENDAR_SYNC_ENABLED;
  try {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const f = fixture({ activeChannels: 1 });
    f.form.set('bookingEnabled', 'on');
    assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'error');
    assert.equal(f.saved.phone, '01234567890');
  } finally {
    if (previous === undefined) delete process.env.CALENDAR_SYNC_ENABLED;
    else process.env.CALENDAR_SYNC_ENABLED = previous;
  }
});

test('a customer cannot change booking settings', async () => {
  const f = fixture({ role: 'USER' });
  await assert.rejects(f.actions.updateSiteSettings({ status: 'idle' }, f.form), /Unauthorized/);
  assert.equal(f.saved.phone, '01234567890');
});

test('editing settings while booking is already open does not re-run the launch checks', async () => {
  // Marketplace imports pause outside staff hours, so an evening phone-number
  // edit used to fail the calendar-freshness gate with "Settings were not saved".
  const f = fixture({ currentlyEnabled: true, calendarReady: false, operationsReady: false });
  f.form.set('bookingEnabled', 'on');
  assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'success');
  assert.equal(f.saved.phone, '09876543210');
  assert.equal(f.saved.bookingEnabled, true);
  assert.deepEqual(f.readinessCalls, { calendar: 0, operations: 0 });
});

test('turning booking on still requires the launch checks', async () => {
  const f = fixture({ currentlyEnabled: false, calendarReady: false });
  f.form.set('bookingEnabled', 'on');
  assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'error');
  assert.equal(f.saved.bookingEnabled, false);
  assert.equal(f.readinessCalls.calendar, 1);
});

test('closing booking works even while every readiness check is failing', async () => {
  const f = fixture({ currentlyEnabled: true, calendarReady: false, operationsReady: false });
  assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'success');
  assert.equal(f.saved.bookingEnabled, false);
  assert.equal(f.saved.phone, '09876543210');
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

/** Run with exactly these production/Square variables, then restore the process environment. */
async function inProductionBuild(square: Partial<Record<keyof typeof SQUARE_PRODUCTION, string>>, run: () => Promise<void>) {
  const env = process.env as Record<string, string | undefined>;
  const keys = ['NODE_ENV', 'VERCEL_ENV', ...Object.keys(SQUARE_PRODUCTION)];
  const previous = Object.fromEntries(keys.map((key) => [key, env[key]]));
  for (const key of Object.keys(SQUARE_PRODUCTION)) delete env[key];
  Object.assign(env, { NODE_ENV: 'production', VERCEL_ENV: 'production' }, square);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test('production refuses to switch online booking on without Square production credentials, but other settings still save', async () => {
  await inProductionBuild({}, async () => {
    const f = fixture();
    f.form.set('bookingEnabled', 'on');
    const refused = await f.actions.updateSiteSettings({ status: 'idle' }, f.form);
    assert.equal(refused.status, 'error');
    assert.match('message' in refused ? refused.message : '', /Square production credentials/);
    assert.equal(f.saved.bookingEnabled, false);
    assert.equal(f.saved.phone, '01234567890', 'nothing is saved with a refused switch');
    assert.deepEqual(f.readinessCalls, { calendar: 0, operations: 0 });

    // The form disables the switch, so a normal save sends no bookingEnabled.
    const g = fixture();
    assert.equal((await g.actions.updateSiteSettings({ status: 'idle' }, g.form)).status, 'success');
    assert.equal(g.saved.phone, '09876543210');
  });
});

test('Square sandbox credentials never let production switch online booking on', async () => {
  await inProductionBuild({ ...SQUARE_PRODUCTION, SQUARE_ENVIRONMENT: 'sandbox', SQUARE_APPLICATION_ID: 'sandbox-sq0idb-test-application' }, async () => {
    const f = fixture();
    f.form.set('bookingEnabled', 'on');
    const refused = await f.actions.updateSiteSettings({ status: 'idle' }, f.form);
    assert.match('message' in refused ? refused.message : '', /Square production credentials/);
    assert.equal(f.saved.bookingEnabled, false);
    assert.deepEqual(f.readinessCalls, { calendar: 0, operations: 0 });
  });
});

test('with Square production credentials, the usual launch checks decide whether booking can open', async () => {
  await inProductionBuild(SQUARE_PRODUCTION, async () => {
    const f = fixture();
    f.form.set('bookingEnabled', 'on');
    assert.equal((await f.actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'success');
    assert.equal(f.saved.bookingEnabled, true);
    assert.deepEqual(f.readinessCalls, { calendar: 1, operations: 1 });

    const blocked = fixture({ calendarReady: false });
    blocked.form.set('bookingEnabled', 'on');
    assert.equal((await blocked.actions.updateSiteSettings({ status: 'idle' }, blocked.form)).status, 'error');
    assert.equal(blocked.saved.bookingEnabled, false);
  });
});

test('saving settings also refreshes the cached blog list (the runbook\'s refresh step)', async () => {
  const tags: string[] = [];
  const f = fixture();
  const actions = loadServerModule<typeof import('./admin-settings')>('src/app/actions/admin-settings.ts', {
    '@/app/lib/prisma': { $transaction: async (run: (client: unknown) => Promise<unknown>) => run({
      auditEvent: { create: async () => ({ id: 'audit' }) },
      siteSettings: { findUnique: async () => ({ bookingEnabled: false }), upsert: async () => ({}) },
      calendarConnection: { count: async () => 0 },
    }) },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN' }) },
    '@/app/services/integration-readiness': {},
    '@/app/services/operations-readiness': {},
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    '@/app/services/blog-service': { BLOG_POSTS_TAG: 'blog-posts' },
    'next/cache': { updateTag(tag: string) { tags.push(tag); }, revalidatePath() {} },
  });
  assert.equal((await actions.updateSiteSettings({ status: 'idle' }, f.form)).status, 'success');
  assert.ok(tags.includes('site-settings'));
  assert.ok(tags.includes('blog-posts'));
});

