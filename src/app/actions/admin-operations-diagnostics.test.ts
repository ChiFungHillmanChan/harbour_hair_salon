import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

// A failed run closes online booking until one passes (operations-readiness.ts),
// so the button cannot read as harmless once booking is open (review 2026-11-08).

function load(status: 'pass' | 'fail', bookingEnabled: boolean, locale: 'en-GB' | 'zh-HK' = 'en-GB') {
  return loadServerModule<typeof import('./admin-operations')>('src/app/actions/admin-operations.ts', {
    '@/app/lib/prisma': { siteSettings: { findUnique: async () => ({ bookingEnabled }) } },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN', userId: 'admin-1' }) },
    '@/app/services/operations-readiness': { runOperationsDiagnostics: async () => [{ status }] },
    '@/app/services/notification-outbox-service': { dispatchPendingNotifications: async () => ({}) },
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/revalidate': { revalidateAllLocales: () => undefined },
    'next/cache': { revalidatePath: () => undefined },
  });
}

test('a failing run with booking on says online booking is now closed', async () => {
  const result = await load('fail', true).runOperationsDiagnosticsAction();
  assert.equal(result.status, 'error');
  assert.match(String(result.message), /Online booking is now closed until a run passes/);
  assert.match(String((await load('fail', true, 'zh-HK').runOperationsDiagnosticsAction()).message), /網上預約現已關閉/);
});

test('a failing run with booking off does not claim it closed anything', async () => {
  const result = await load('fail', false).runOperationsDiagnosticsAction();
  assert.equal(result.status, 'error');
  assert.doesNotMatch(String(result.message), /now closed/);
});

test('a passing run is still reported as passing', async () => {
  assert.equal((await load('pass', true).runOperationsDiagnosticsAction()).status, 'success');
});
