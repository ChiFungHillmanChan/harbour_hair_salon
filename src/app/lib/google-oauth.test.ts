import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleAuthorization,
  decideGoogleLink,
  getGoogleCallbackUrl,
  googleProfileFromClaims,
  isGoogleAuthoritativeEmail,
  readGoogleState,
  readGoogleStateLocale,
  resolveOAuthOrigin,
} from './google-oauth';

process.env.SESSION_SECRET = 'google-oauth-test-session-secret-32-chars';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

test('Google authorization preserves a safe destination and enables PKCE', async () => {
  const { authorizationUrl, stateCookie } = await createGoogleAuthorization(
    'http://localhost:3000',
    '/book?stylist=amy'
  );
  const url = new URL(authorizationUrl);

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/callback');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));

  const state = await readGoogleState(stateCookie, url.searchParams.get('state'));
  assert.equal(state.redirectTo, '/book?stylist=amy');
});

test('Google authorization carries the page language through the signed state', async () => {
  const { authorizationUrl, stateCookie } = await createGoogleAuthorization(
    'http://localhost:3000',
    '/zh-hk/book',
    'zh-HK'
  );
  const url = new URL(authorizationUrl);
  // The callback registered with Google never changes with the language.
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/callback');

  const state = await readGoogleState(stateCookie, url.searchParams.get('state'));
  assert.equal(state.locale, 'zh-HK');
  assert.equal(state.redirectTo, '/zh-hk/book');
  assert.equal(await readGoogleStateLocale(stateCookie), 'zh-HK');

  const legacy = await createGoogleAuthorization('http://localhost:3000', null);
  assert.equal(await readGoogleStateLocale(legacy.stateCookie), null);
  assert.equal(await readGoogleStateLocale('not-a-signed-state'), null);
  assert.equal(await readGoogleStateLocale(undefined), null);
});

test('Google authorization rejects an altered state value', async () => {
  const { stateCookie } = await createGoogleAuthorization('http://localhost:3000', '/appointments');
  await assert.rejects(readGoogleState(stateCookie, 'attacker-controlled-state'), /Invalid OAuth state/);
});

test('Google callback URL ignores the sensitive-env placeholder in production', () => {
  const env = process.env as Record<string, string | undefined>;
  const prevNodeEnv = env.NODE_ENV;
  const prevSiteUrl = env.NEXT_PUBLIC_SITE_URL;
  env.NODE_ENV = 'production';
  try {
    // GH Actions builds inline NEXT_PUBLIC_* as the literal "[SENSITIVE]"
    // placeholder; the callback must fall back to the request origin.
    process.env.NEXT_PUBLIC_SITE_URL = '[SENSITIVE]';
    assert.equal(
      getGoogleCallbackUrl('https://www.harbourhair.co.uk'),
      'https://www.harbourhair.co.uk/api/auth/google/callback'
    );

    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.harbourhair.co.uk';
    assert.equal(
      getGoogleCallbackUrl('https://harbourhairsalon.vercel.app'),
      'https://www.harbourhair.co.uk/api/auth/google/callback'
    );
  } finally {
    if (prevNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prevNodeEnv;
    if (prevSiteUrl === undefined) delete env.NEXT_PUBLIC_SITE_URL;
    else env.NEXT_PUBLIC_SITE_URL = prevSiteUrl;
  }
});

test('OAuth origin accepts localhost and requires HTTPS for remote hosts', () => {
  assert.equal(resolveOAuthOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(
    resolveOAuthOrigin('https://preview.example.com', 'https://harbourhairsalon.vercel.app/path'),
    'https://harbourhairsalon.vercel.app'
  );
  assert.throws(() => resolveOAuthOrigin('http://example.com'), /must use HTTPS/);
});

test('Google is authoritative only for Gmail and Workspace addresses', () => {
  assert.equal(isGoogleAuthoritativeEmail('owner@gmail.com', undefined), true);
  assert.equal(isGoogleAuthoritativeEmail('owner@googlemail.com', undefined), true);
  assert.equal(isGoogleAuthoritativeEmail('owner@salon.example', 'salon.example'), true);
  // A Google account registered on a third-party mailbox: verified once, maybe
  // for someone else.
  assert.equal(isGoogleAuthoritativeEmail('owner@outlook.example', undefined), false);
  assert.equal(isGoogleAuthoritativeEmail('owner@outlook.example', ''), false);
  assert.equal(isGoogleAuthoritativeEmail('owner@outlook.example', 42), false);
  // The domain must BE gmail.com, not merely end with it.
  assert.equal(isGoogleAuthoritativeEmail('owner@notgmail.com', undefined), false);
  assert.equal(isGoogleAuthoritativeEmail('owner@gmail.com.example', undefined), false);
});

test('a first Google sign-in never takes over an account through a non-authoritative email', () => {
  const stale = { emailAuthoritative: false };
  assert.deepEqual(decideGoogleLink(stale, { role: 'ADMIN', hasPassword: true }), { kind: 'REFUSE', code: 'google_email_unverified' });
  assert.deepEqual(decideGoogleLink(stale, { role: 'USER', hasPassword: true }), { kind: 'REFUSE', code: 'google_email_unverified' });
  // Nor creates one the real mailbox owner would later recover with the
  // stale identity still attached.
  assert.deepEqual(decideGoogleLink(stale, null), { kind: 'REFUSE', code: 'google_email_unverified' });
});

test('a first Google sign-in links customers but never administrators', () => {
  const owner = { emailAuthoritative: true };
  assert.deepEqual(decideGoogleLink(owner, null), { kind: 'CREATE' });
  assert.deepEqual(decideGoogleLink(owner, { role: 'ADMIN', hasPassword: true }), { kind: 'REFUSE', code: 'google_admin_link' });
  assert.deepEqual(decideGoogleLink(owner, { role: 'ADMIN', hasPassword: false }), { kind: 'REFUSE', code: 'google_admin_link' });
  assert.deepEqual(decideGoogleLink(owner, { role: 'USER', hasPassword: true }), { kind: 'LINK', clearPassword: true });
  assert.deepEqual(decideGoogleLink(owner, { role: 'USER', hasPassword: false }), { kind: 'LINK', clearPassword: false });
});

test('the real ID-token mapping marks Workspace (hd) and Gmail identities authoritative, and nothing else', () => {
  const claims = { nonce: 'n', sub: 'google-sub', email_verified: true };
  assert.equal(googleProfileFromClaims({ ...claims, email: 'Owner@Salon.example', hd: 'salon.example' }, 'n').emailAuthoritative, true);
  assert.equal(googleProfileFromClaims({ ...claims, email: 'owner@gmail.com' }, 'n').emailAuthoritative, true);
  const thirdParty = googleProfileFromClaims({ ...claims, email: ' Owner@Outlook.example ', name: ' Owner ' }, 'n');
  assert.deepEqual(thirdParty, { id: 'google-sub', email: 'owner@outlook.example', name: 'Owner', emailAuthoritative: false });
  assert.throws(() => googleProfileFromClaims({ ...claims, email: 'owner@gmail.com' }, 'other-nonce'), /verified identity/);
  assert.throws(() => googleProfileFromClaims({ ...claims, email: 'owner@gmail.com', email_verified: false }, 'n'), /verified identity/);
});
