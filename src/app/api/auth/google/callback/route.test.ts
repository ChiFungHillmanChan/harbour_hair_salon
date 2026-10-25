import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../../test/load-server-module';
import { decideGoogleLink, isGoogleAuthoritativeEmail, type GoogleProfile } from '../../../../lib/google-oauth';

type FixtureUser = { id: string; email: string; name: string | null; role: string; password: string | null; sessionVersion: number; preferredLocale?: string | null; emailVerifiedAt?: Date | null };

/**
 * The real callback and link policy; only Google's network calls and the
 * database are replaced. `profile` is what a genuinely signed Google ID token
 * would carry — the attack needs no forged signature, only a Google account
 * whose third-party email Google once verified.
 */
function callbackFixture(
  profile: Omit<GoogleProfile, 'emailAuthoritative'>,
  users: FixtureUser[],
  linked: { providerAccountId: string; userId: string }[] = [],
  /** The language of the page sign-in started from, as the signed state carries it. */
  stateLocale?: 'en-GB' | 'zh-HK',
  /** How many times the transaction first fails as PostgreSQL's Serializable conflict (P2034). */
  options: { serializationConflicts?: number } = {},
) {
  let conflicts = options.serializationConflicts ?? 0;
  const resetTokens = users.map((user) => ({ userId: user.id, usedAt: null as Date | null }));
  const sessions: { userId: string; role: string }[] = [];
  const audits: { action: string; targetId?: string | null; metadata?: Record<string, unknown> }[] = [];
  let localeWrites = 0;
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
      updateMany: async ({ where, data }: { where: { id: string; preferredLocale: null }; data: { preferredLocale: string } }) => {
        const user = users.find((row) => row.id === where.id && !row.preferredLocale);
        if (!user) return { count: 0 };
        user.preferredLocale = data.preferredLocale;
        localeWrites++;
        return { count: 1 };
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
    '@/app/lib/prisma': { ...tx, $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      if (conflicts > 0) { conflicts--; throw new Prisma.PrismaClientKnownRequestError('could not serialize access', { code: 'P2034', clientVersion: 'test' }); }
      return run(tx);
    } },
    '@/app/lib/session': { createSession: async (userId: string, role: string) => { sessions.push({ userId, role }); } },
    '@/app/lib/audit': { appendAuditEvent: async (event: typeof audits[number]) => { audits.push(event); } },
    '@/app/lib/google-oauth': {
      GOOGLE_OAUTH_STATE_COOKIE: 'google_oauth_state',
      getGoogleOAuthStateCookieOptions: () => ({ httpOnly: true, path: '/api/auth/google' }),
      getGoogleCallbackUrl: () => 'https://salon.example/api/auth/google/callback',
      readGoogleStateLocale: async () => null,
      readGoogleState: async () => ({ state: 's', nonce: 'n', codeVerifier: 'v', redirectTo: '/appointments', ...(stateLocale ? { locale: stateLocale } : {}) }),
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
  return { run, users, linked, resetTokens, sessions, audits, localeWrites: () => localeWrites };
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

test('a customer who confirmed their email keeps their password when they first sign in with Google', async () => {
  const f = callbackFixture({ id: 'google-sub-3', email: 'client@gmail.com', name: 'Client' }, [
    { id: 'user-1', email: 'client@gmail.com', name: 'Client', role: 'USER', password: 'own-hash', sessionVersion: 4, emailVerifiedAt: new Date('2026-10-01T09:00:00Z') },
  ]);
  const location = await f.run();
  assert.equal(location.pathname, '/appointments');
  assert.equal(f.users[0].password, 'own-hash', 'email + password still signs in');
  assert.equal(f.users[0].sessionVersion, 4, 'no other session is signed out');
  assert.equal(f.resetTokens.length, 1, 'their reset links are left alone');
  assert.deepEqual(f.linked, [{ provider: 'google', providerAccountId: 'google-sub-3', userId: 'user-1' }]);
  assert.deepEqual(f.sessions, [{ userId: 'user-1', role: 'USER' }]);
});

test('an unconfirmed email still loses its password on the first Google sign-in, even with a name already set', async () => {
  const f = callbackFixture({ id: 'google-sub-4', email: 'client@gmail.com', name: 'Client' }, [
    { id: 'user-1', email: 'client@gmail.com', name: 'Someone', role: 'USER', password: 'planted-hash', sessionVersion: 2, emailVerifiedAt: null },
  ]);
  await f.run();
  assert.equal(f.users[0].password, null);
  assert.equal(f.users[0].sessionVersion, 3);
  assert.equal(f.users[0].name, 'Someone', 'a saved name is never overwritten');
  assert.equal(f.resetTokens.length, 0);
  assert.equal(f.linked.length, 1);
});

test('a confirmed administrator is still never auto-linked', async () => {
  const f = callbackFixture({ id: 'google-sub-5', email: 'owner@gmail.com', name: 'Owner' }, [{ ...admin(), email: 'owner@gmail.com', emailVerifiedAt: new Date() }]);
  const location = await f.run();
  assert.equal(location.searchParams.get('error'), 'google_admin_link');
  assert.equal(f.users[0].password, 'admin-hash');
  assert.equal(f.linked.length, 0);
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

// Two first sign-ins at once (a double tap on Google's consent screen) can
// abort each other under Serializable; one retry must sign the customer in
// rather than send them back with "Google sign-in failed" (review 2026-10-24).
test('a first Google sign-in that hits a serialization conflict is retried and signs in', async (context) => {
  context.mock.method(console, 'error', () => {});
  const f = callbackFixture({ id: 'google-sub-new', email: 'mei@gmail.com', name: 'Mei' }, [], [], undefined, { serializationConflicts: 2 });
  const location = await f.run();
  assert.equal(location.pathname, '/appointments');
  assert.equal(f.users.length, 1);
  assert.deepEqual(f.sessions, [{ userId: 'user-1', role: 'USER' }]);
});

test('a conflict that never clears still ends with the sign-in error', async (context) => {
  context.mock.method(console, 'error', () => {});
  const f = callbackFixture({ id: 'google-sub-new', email: 'mei@gmail.com', name: 'Mei' }, [], [], undefined, { serializationConflicts: 99 });
  const location = await f.run();
  assert.equal(location.searchParams.get('error'), 'google_failed');
  assert.deepEqual(f.sessions, []);
});

// The language of the page sign-in started from is the language of the mail
// the salon later sends on the customer's behalf (see customer-language.test.ts).

test('an account Google creates keeps the language the sign-in started from', async () => {
  const f = callbackFixture({ id: 'google-sub-new', email: 'mei@gmail.com', name: 'Mei' }, [], [], 'zh-HK');
  const location = await f.run();
  assert.equal(location.pathname, '/zh-hk/appointments');
  assert.equal(f.users[0].preferredLocale, 'zh-HK');
  assert.equal(f.localeWrites(), 0, 'saved as part of creating the account');
});

test('signing in to, or linking, an account with no saved language fills it in', async () => {
  const signIn = callbackFixture(
    { id: 'google-sub-linked', email: 'mei@gmail.com', name: 'Mei' },
    [{ id: 'user-1', email: 'mei@gmail.com', name: 'Mei', role: 'USER', password: null, sessionVersion: 0, preferredLocale: null }],
    [{ providerAccountId: 'google-sub-linked', userId: 'user-1' }],
    'zh-HK',
  );
  await signIn.run();
  assert.equal(signIn.users[0].preferredLocale, 'zh-HK');

  const link = callbackFixture(
    { id: 'google-sub-2', email: 'client@gmail.com', name: 'Client' },
    [{ id: 'user-2', email: 'client@gmail.com', name: 'Client', role: 'USER', password: 'hash', sessionVersion: 0, preferredLocale: null }],
    [],
    'en-GB',
  );
  await link.run();
  assert.equal(link.linked.length, 1);
  assert.equal(link.users[0].preferredLocale, 'en-GB');
});

test('a language the customer already saved is never overwritten by a Google sign-in', async () => {
  const f = callbackFixture(
    { id: 'google-sub-linked', email: 'mei@gmail.com', name: 'Mei' },
    [{ id: 'user-1', email: 'mei@gmail.com', name: 'Mei', role: 'USER', password: null, sessionVersion: 0, preferredLocale: 'en-GB' }],
    [{ providerAccountId: 'google-sub-linked', userId: 'user-1' }],
    'zh-HK',
  );
  await f.run();
  assert.equal(f.users[0].preferredLocale, 'en-GB');
  assert.equal(f.localeWrites(), 0);
});
