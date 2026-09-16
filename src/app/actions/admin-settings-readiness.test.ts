import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

function fixture(options: { role?: string; calendarReady?: boolean; operationsReady?: boolean; activeChannels?: number; outage?: boolean } = {}) {
  const saved = { bookingEnabled: true, phone: '01234567890' };
  const tx = {
    auditEvent: { create: async () => ({ id: "audit" }) },
    siteSettings: { upsert: async ({ update }: { update: Record<string, unknown> }) => { Object.assign(saved, update); return saved; } },
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
      if (options.outage) throw new Error('Provider unavailable');
      return { ready: options.calendarReady !== false, blockers: options.calendarReady === false ? ['Calendar coverage missing.'] : [] };
    } },
    '@/app/services/operations-readiness': { checkOperationsBookingReadiness: async (client: unknown) => {
      assert.equal(client, tx);
      if (options.outage) throw new Error('Provider unavailable');
      return { ready: options.operationsReady !== false, blockers: options.operationsReady === false ? ['Operational checks have not passed.'] : [] };
    } },
    'next/cache': { updateTag() {}, revalidatePath() {} },
  });
  const form = new FormData();
  form.set('phone', '09876543210');
  return { actions, form, saved };
}

test('closing booking remains possible when readiness providers are unavailable', async () => {
  const f = fixture({ outage: true });
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
