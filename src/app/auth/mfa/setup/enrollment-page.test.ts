import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Secret, TOTP } from 'otpauth';
import { redirect } from 'next/dist/client/components/redirect';
import { loadServerModule } from '../../../../test/load-server-module';
import { encryptMfaSecret } from '../../../lib/mfa-crypto';

test('enrollment cookie mutations keep the setup page mounted for one-time recovery codes', async (t) => {
  const prior = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'fixture-mfa-render-session-secret-32-characters';
  t.after(() => { if (prior === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prior; });
  const secret = new Secret({ size: 20 }).base32;
  const user = {
    id: 'admin-render', email: 'render@example.invalid', role: 'ADMIN', sessionVersion: 3, password: 'fixture-hash',
    mfaSecretEncrypted: null, mfaEnabledAt: null, mfaLastUsedStep: null, mfaRecoveryCodesJson: '[]',
    mfaPendingSecretEncrypted: encryptMfaSecret(secret), mfaPendingExpiresAt: new Date(Date.now() + 600_000),
  };
  const values = new Map<string, string>();
  const store = { get: (key: string) => values.has(key) ? { value: values.get(key) } : undefined,
    set: (key: string, value: string) => values.set(key, value), delete: (key: string) => values.delete(key) };
  const db = { user: {
    findUnique: async () => ({ ...user }),
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(user, data, { sessionVersion: typeof data.sessionVersion === 'object' ? user.sessionVersion + 1 : user.sessionVersion }); return { count: 1 };
    },
  }, auditEvent: { count: async () => 0 }, $transaction: async (run: (tx: unknown) => unknown) => run(db) };
  const session = loadServerModule<typeof import('../../../lib/session')>('src/app/lib/session.ts', {
    'next/headers': { cookies: async () => store }, 'next/navigation': { redirect }, '@/app/lib/prisma': db,
  });
  const challenge = loadServerModule<typeof import('../../../lib/admin-mfa')>('src/app/lib/admin-mfa.ts', {
    'next/headers': { cookies: async () => store }, 'next/navigation': { redirect }, '@/app/lib/prisma': db, '@/app/lib/session': session,
  });
  const actions = loadServerModule<typeof import('../../../actions/admin-mfa')>('src/app/actions/admin-mfa.ts', {
    'next/headers': { headers: async () => new Headers() }, 'next/navigation': { redirect },
    '@/app/lib/prisma': db, '@/app/lib/admin-mfa': challenge, '@/app/lib/session': session,
    '@/app/lib/rate-limit': { createRateLimiter: () => ({ check: async () => true }) },
    '@/app/lib/audit': { appendAuditEvent: async () => {} },
  });
  const SetupForm = () => null;
  const page = loadServerModule<typeof import('./page')>('src/app/auth/mfa/setup/page.tsx', {
    'next/navigation': { redirect }, '@/app/lib/admin-mfa': challenge, '@/app/lib/session': session,
    '@/components/auth/AdminMfaForms': { AdminMfaSetupForm: SetupForm },
  });
  await challenge.beginAdminMfaChallenge(user.id, user.sessionVersion);
  await page.default();
  const data = new FormData();
  data.set('code', TOTP.generate({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }));
  const result = await actions.finishMfaEnrollment({}, data);
  assert.equal(result.recoveryCodes?.length, 10);
  assert.equal(values.get('admin_mfa_pending'), '');
  assert.equal((await session.requireAdmin()).role, 'ADMIN');
  // Next renders the page again with updated cookies before returning the
  // action result. A redirect here would discard its one-time recovery codes.
  const rendered = await page.default();
  assert.ok(rendered);
  const form = rendered.props.children.props.children[1];
  assert.equal(form.type, SetupForm);
  assert.equal(form.props.enrolled, true);
});
