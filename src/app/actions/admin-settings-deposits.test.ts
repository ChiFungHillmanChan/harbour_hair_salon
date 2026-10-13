import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const STORED = { phone: '01234567890', bookingEnabled: false, depositsEnabled: false, depositPercent: 0, depositMinimumServicePence: 0 };

function fixture(fields: Record<string, string>) {
  const saved: Record<string, unknown> = { ...STORED };
  const audits: Record<string, unknown>[] = [];
  const tx = {
    auditEvent: { create: async ({ data }: { data: { metadataJson: string } }) => { audits.push(JSON.parse(data.metadataJson)); return { id: 'audit' }; } },
    siteSettings: {
      findUnique: async () => ({ bookingEnabled: saved.bookingEnabled }),
      upsert: async ({ update }: { update: Record<string, unknown> }) => { Object.assign(saved, update); return saved; },
    },
    calendarConnection: { count: async () => 0 },
  };
  const actions = loadServerModule<typeof import('./admin-settings')>('src/app/actions/admin-settings.ts', {
    '@/app/lib/prisma': { $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx) },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN', userId: 'admin1' }) },
    '@/app/services/integration-readiness': {},
    '@/app/services/operations-readiness': {},
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    'next/cache': { updateTag() {}, revalidatePath() {} },
  });
  const form = new FormData();
  form.set('phone', '09876543210');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return { save: () => actions.updateSiteSettings({ status: 'idle' }, form), saved, audits };
}

test('the deposit policy saves from the form: the switch, a whole percentage and a minimum typed in pounds', async () => {
  const f = fixture({ depositsEnabled: 'on', depositPercent: '20', depositMinimumServicePounds: '30.50' });
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal(f.saved.depositsEnabled, true);
  assert.equal(f.saved.depositPercent, 20);
  assert.equal(f.saved.depositMinimumServicePence, 3050);
  assert.equal('depositMinimumServicePounds' in f.saved, false, 'the pounds box is not a column');
  // Audited like the other settings, as plain facts.
  assert.equal(f.audits.length, 1);
  assert.deepEqual(
    { depositsEnabled: f.audits[0].depositsEnabled, depositPercent: f.audits[0].depositPercent, depositMinimumServicePence: f.audits[0].depositMinimumServicePence },
    { depositsEnabled: true, depositPercent: 20, depositMinimumServicePence: 3050 },
  );
});

test('an unticked switch saves deposits off, and a blank minimum means £0', async () => {
  const f = fixture({ depositPercent: '15', depositMinimumServicePounds: '  ' });
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal(f.saved.depositsEnabled, false);
  assert.equal(f.saved.depositPercent, 15);
  assert.equal(f.saved.depositMinimumServicePence, 0);
  const whole = fixture({ depositsEnabled: 'on', depositPercent: '100', depositMinimumServicePounds: '45' });
  assert.deepEqual(await whole.save(), { status: 'success' });
  assert.equal(whole.saved.depositPercent, 100);
  assert.equal(whole.saved.depositMinimumServicePence, 4500);
});

test('a percentage that is not a whole number from 0 to 100 is refused by name, and nothing is saved', async () => {
  for (const depositPercent of ['101', '-5', '12.5', '', 'twenty', '1e2']) {
    const f = fixture({ depositsEnabled: 'on', depositPercent, depositMinimumServicePounds: '0' });
    const result = await f.save();
    assert.equal(result.status, 'error', depositPercent);
    assert.equal('message' in result && result.message, 'Deposit (% of the price): Enter a whole number from 0 to 100.', depositPercent);
    assert.deepEqual(f.saved, STORED, depositPercent);
    assert.equal(f.audits.length, 0);
  }
});

test('a minimum that is not an amount in pounds is refused by name, and nothing is saved', async () => {
  for (const depositMinimumServicePounds of ['£30', '30.505', '-1', 'thirty', '1234567', '30p']) {
    const f = fixture({ depositsEnabled: 'on', depositPercent: '20', depositMinimumServicePounds });
    const result = await f.save();
    assert.equal(result.status, 'error', depositMinimumServicePounds);
    assert.equal(
      'message' in result && result.message,
      'Minimum service price for a deposit (£): Enter an amount in pounds, e.g. 30 or 30.50.',
      depositMinimumServicePounds,
    );
    assert.deepEqual(f.saved, STORED, depositMinimumServicePounds);
  }
});
