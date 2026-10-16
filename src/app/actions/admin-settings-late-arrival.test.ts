import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

function fixture(stored: { lateAutoCancelSince: Date | null }, fields: Record<string, string>) {
  const writes: { update: Record<string, unknown>; create: Record<string, unknown> }[] = [];
  const audits: Record<string, unknown>[] = [];
  const tx = {
    auditEvent: { create: async ({ data }: { data: { metadataJson: string } }) => { audits.push(JSON.parse(data.metadataJson)); return { id: 'audit' }; } },
    siteSettings: {
      findUnique: async () => ({ bookingEnabled: false, lateAutoCancelSince: stored.lateAutoCancelSince }),
      upsert: async ({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => { writes.push({ update, create }); return {}; },
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
  return { save: () => actions.updateSiteSettings({ status: 'idle' }, form), writes, audits };
}

test('switching the late-arrival rule on stores the current instant, on update and create alike', async () => {
  const f = fixture({ lateAutoCancelSince: null }, { lateAutoCancelEnabled: 'on' });
  const before = Date.now();
  assert.deepEqual(await f.save(), { status: 'success' });
  const { update, create } = f.writes[0];
  assert.ok(update.lateAutoCancelSince instanceof Date);
  assert.ok((update.lateAutoCancelSince as Date).getTime() >= before && (update.lateAutoCancelSince as Date).getTime() <= Date.now());
  assert.equal(create.lateAutoCancelSince, update.lateAutoCancelSince);
  assert.equal('lateAutoCancelEnabled' in update, false, 'the switch is not a column');
  assert.equal('lateAutoCancelEnabled' in create, false);
  assert.equal(f.audits[0].lateAutoCancel, true);
});

test('saving again with the box ticked keeps the instant it was first switched on', async () => {
  const earlier = new Date('2026-10-01T09:00:00Z');
  const f = fixture({ lateAutoCancelSince: earlier }, { lateAutoCancelEnabled: 'on' });
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal(f.writes[0].update.lateAutoCancelSince, earlier);
  assert.equal(f.writes[0].create.lateAutoCancelSince, earlier);
  assert.equal(f.audits[0].lateAutoCancel, true);
});

test('saving without the box switches the rule off, whatever was stored', async () => {
  const f = fixture({ lateAutoCancelSince: new Date('2026-10-01T09:00:00Z') }, {});
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal(f.writes[0].update.lateAutoCancelSince, null);
  assert.equal(f.writes[0].create.lateAutoCancelSince, null);
  assert.equal(f.audits[0].lateAutoCancel, false);
});
