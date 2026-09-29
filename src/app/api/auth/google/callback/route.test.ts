import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../../test/load-server-module';
import { decideGoogleLink, isGoogleAuthoritativeEmail, type GoogleProfile } from '../../../../lib/google-oauth';

type FixtureUser = { id: string; email: string; name: string | null; role: string; password: string | null; sessionVersion: number };

/**
 * The real callback and link policy; only Google's network calls and the
 * database are replaced. `profile` is what a genuinely signed Google ID token
 * would carry — the attack needs no forged signature, only a Google account
 * whose third-party email Google once verified.
 */
function callbackFixture(profile: Omit<GoogleProfile, 'emailAuthoritative'>, users: FixtureUser[], linked: { providerAccountId: string; userId: string }[] = []) {
  const resetTokens = users.map((user) => ({ userId: user.id, usedAt: null as Date | null }));
  const sessions: { userId: string; role: string }[] = [];
  const audits: { action: string; targetId?: string | null; metadata?: Record<string, unknown> }[] = [];
  const tx = {
    oAuthAccount: {
      findUnique: async ({ where }: { where: { provider_providerAccountId: { providerAccountId: string } } }) => {
        const account = linked.find((row) => row.providerAccountId === where.provider_providerAccountId.providerAccountId);
        return account ? { ...account, user: users.find((user) => user.id === account.userId) } : null;
      },
      create: async ({ data }: { data: { providerAccountId: string; userId: string } }) => { linked.push(data); return data; },
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => users.find((user) => user.email === where.email) ?? null,
      create: async ({ data }: { data: Omit<FixtureUser, 'id' | 'password' | 'sessionVersion'> }) => {
        const user = { ...data, id: `user-${users.length + 1}`, password: null, sessionVersion: 0 };
        users.push(user);
        return user;
      },
      update: async ({ where, data }: { where: { id: string }; data: { password?: null; name?: string; sessionVersion?: { increment: number } } }) => {
        const user = users.find((row) => row.id === where.id)!;
        if ('password' in data) user.password = data.password ?? null;
        if (data.name) user.name = data.name;
        if (data.sessionVersion) user.sessionVersion += data.sessionVersion.increment;
        return { ...user };
      },
    },
    passwordResetToken: {
      deleteMany: async ({ where }: { where: { userId: string; usedAt: null } }) => {
        const before = resetTokens.length;
        resetTokens.splice(0, resetTokens.length, ...resetTokens.filter((token) => token.userId !== where.userId || token.usedAt !== null));
        return { count: before - resetTokens.length };
      },
    },
  };
  const route = loadServerModule<typeof import('./route')>('src/app/api/auth/google/callback/route.ts', {
    '@/app/lib/prisma': { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) },
    '@/app/lib/session': { createSession: async (userId: string, role: string) => { sessions.push({ userId, role }); } },
    '@/app/lib/audit': { appendAuditEvent: async (event: typeof audits[number]) => { audits.push(event); } },
    '@/app/lib/google-oauth': {
      GOOGLE_OAUTH_STATE_COOKIE: 'google_oauth_state',
      getGoogleOAuthStateCookieOptions: () => ({ httpOnly: true, path: '/api/auth/google' }),
      getGoogleCallbackUrl: () => 'https://salon.example/api/auth/google/callback',
      readGoogleStateLocale: async () => null,
      readGoogleState: async () => ({ state: 's', nonce: 'n', codeVerifier: 'v', redirectTo: '/appointments' }),
      exchangeGoogleCode: async () => 'signed-id-token',
      verifyGoogleIdToken: async () => ({ ...profile, emailAuthoritative: isGoogleAuthoritativeEmail(profile.email, undefined) }),
      decideGoogleLink,
    },
    '@/i18n/request': { getRequestLocale: async () => 'en-GB' },
  });
  const run = async () => {
    const response = await route.GET(new NextRequest('https://salon.example/api/auth/google/callback?code=c&state=s', { headers: { cookie: 'google_oauth_state=signed' } }));
    return new URL(response.headers.get('location')!);
  };
  return { run, users, linked, resetTokens, sessions, audits };
}

const admin = (): FixtureUser => ({ id: 'admin-1', email: 'owner@outlook.example', name: 'Owner', role: 'ADMIN', password: 'admin-hash', sessionVersion: 3 });

test('a stale Google identity for a third-party address cannot take over an unlinked administrator', async () => {
  const f = callbackFixture({ id: 'google-sub-old-owner', email: 'owner@outlook.example', name: 'Previous owner' }, [admin()]);
  const location = await f.run();
  assert.equal(location.pathname, '/auth/signin');
  assert.equal(location.searchParams.get('error'), 'google_email_unverified');
  assert.equal(f.users[0].password, 'admin-hash', 'the administrator keeps their password');
  assert.equal(f.users[0].sessionVersion, 3, 'no session is revoked');
  assert.equal(f.linked.length, 0);
  assert.equal(f.resetTokens.length, 1);
  assert.deepEqual(f.sessions, []);
  assert.deepEqual(f.audits, [{ action: 'AUTH.GOOGLE_LINK_REFUSED', targetType: 'User', targetId: 'admin-1', metadata: { reason: 'google_email_unverified' } }]);
});

test('a stale Google identity cannot create an account for a third-party address either', async () => {
  const f = callbackFixture({ id: 'google-sub-x', email: 'someone@outlook.example', name: 'Someone' }, []);
  const location = await f.run();
  assert.equal(location.searchParams.get('error'), 'google_email_unverified');
  assert.equal(f.users.length, 0);
  assert.deepEqual(f.sessions, []);
  assert.deepEqual(f.audits, [], 'no account was matched, so nothing to record against');
});

test('even an authoritative Gmail identity is never auto-linked to an administrator', async () => {
  const f = callbackFixture({ id: 'google-sub-1', email: 'owner@gmail.com', name: 'Owner' }, [{ ...admin(), email: 'owner@gmail.com' }]);
  const location = await f.run();
  assert.equal(location.searchParams.get('error'), 'google_admin_link');
  assert.equal(f.users[0].password, 'admin-hash');
  assert.equal(f.linked.length, 0);
  assert.deepEqual(f.sessions, []);
  assert.equal(f.audits[0].action, 'AUTH.GOOGLE_LINK_REFUSED');
});

test('a Gmail owner reclaims a pre-registered customer account: planted password and its reset links are destroyed', async () => {
  const f = callbackFixture({ id: 'google-sub-2', email: 'client@gmail.com', name: 'Client' }, [
    { id: 'user-1', email: 'client@gmail.com', name: null, role: 'USER', password: 'planted-hash', sessionVersion: 0 },
  ]);
  const location = await f.run();
  assert.equal(location.pathname, '/appointments');
  assert.equal(f.users[0].password, null);
  assert.equal(f.users[0].sessionVersion, 1);
  assert.equal(f.users[0].name, 'Client');
  assert.equal(f.resetTokens.length, 0);
  assert.deepEqual(f.linked, [{ provider: 'google', providerAccountId: 'google-sub-2', userId: 'user-1' }]);
  assert.deepEqual(f.sessions, [{ userId: 'user-1', role: 'USER' }]);
});

test('an identity already linked by Google id keeps signing in, whatever its address', async () => {
  const f = callbackFixture(
    { id: 'google-sub-linked', email: 'owner@outlook.example', name: 'Owner' },
    [admin()],
    [{ providerAccountId: 'google-sub-linked', userId: 'admin-1' }],
  );
  const location = await f.run();
  assert.equal(location.pathname, '/admin');
  assert.deepEqual(f.sessions, [{ userId: 'admin-1', role: 'ADMIN' }]);
  assert.equal(f.users[0].password, 'admin-hash');
});
