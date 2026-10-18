import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { placeholderEmailFor } from '../lib/walk-in-customer';

/** Admin → Settings saving the beta testers' list (lib/booking-beta.ts) with the rest of the form. */
function fixture(fields: Record<string, string>, locale: Locale = 'en-GB') {
  const writes: { update: Record<string, unknown>; create: Record<string, unknown> }[] = [];
  const audits: Record<string, unknown>[] = [];
  const tx = {
    auditEvent: { create: async ({ data }: { data: { metadataJson: string } }) => { audits.push(JSON.parse(data.metadataJson)); return { id: 'audit' }; } },
    siteSettings: {
      findUnique: async () => ({ bookingEnabled: false, lateAutoCancelSince: null }),
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
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator(locale, namespace) },
    'next/cache': { updateTag() {}, revalidatePath() {} },
  });
  const form = new FormData();
  form.set('phone', '09876543210');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return { save: () => actions.updateSiteSettings({ status: 'idle' }, form), writes, audits };
}

test('the list is saved normalised (lowercase, one each, ", "-joined), and the audit records how many — never who', async () => {
  const f = fixture({ bookingBetaEmails: ' HillmanChan709@gmail.com\r\nTester@Example.com\n\nhillmanchan709@gmail.com ' });
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal(f.writes[0].update.bookingBetaEmails, 'hillmanchan709@gmail.com, tester@example.com');
  assert.equal(f.writes[0].create.bookingBetaEmails, 'hillmanchan709@gmail.com, tester@example.com');
  assert.equal(f.audits[0].bookingBetaTesters, 2);
  assert.equal(JSON.stringify(f.audits).includes('@'), false, 'no address in the audit log (it outlives an erasure)');
});

test('an empty box clears the list', async () => {
  const f = fixture({ bookingBetaEmails: '  \n ' });
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal(f.writes[0].update.bookingBetaEmails, '');
  assert.equal(f.audits[0].bookingBetaTesters, 0);
});

test('a form without the box (an older page) leaves the stored list alone', async () => {
  const f = fixture({});
  assert.deepEqual(await f.save(), { status: 'success' });
  assert.equal('bookingBetaEmails' in f.writes[0].update, false);
  assert.equal('bookingBetaEmails' in f.writes[0].create, false);
  assert.equal('bookingBetaTesters' in f.audits[0], false);
});

test('an invalid address, a placeholder or too many addresses are refused like the form\'s other errors, and nothing is saved', async () => {
  const walkIn = placeholderEmailFor('mrs-wong');
  const many = Array.from({ length: 21 }, (_, i) => `t${i}@example.com`).join('\n');
  for (const [box, message] of [
    ['ok@example.com\nnot-an-email', 'Beta testers: “not-an-email” is not a valid email address.'],
    [walkIn, `Beta testers: “${walkIn}” is a walk-in or erased placeholder, not a real email address.`],
    [many, 'Beta testers: Enter at most 20 email addresses.'],
  ]) {
    const f = fixture({ bookingBetaEmails: box });
    assert.deepEqual(await f.save(), { status: 'error', message }, box.slice(0, 30));
    assert.equal(f.writes.length, 0);
    assert.equal(f.audits.length, 0);
  }
});

test('the refusal is in Chinese on the Chinese admin', async () => {
  const f = fixture({ bookingBetaEmails: 'not-an-email' }, 'zh-HK');
  assert.deepEqual(await f.save(), { status: 'error', message: 'Beta 測試用戶：「not-an-email」不是有效的電郵地址。' });
});
