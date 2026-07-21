import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleAuthorization,
  readGoogleState,
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

test('Google authorization rejects an altered state value', async () => {
  const { stateCookie } = await createGoogleAuthorization('http://localhost:3000', '/appointments');
  await assert.rejects(readGoogleState(stateCookie, 'attacker-controlled-state'), /Invalid OAuth state/);
});

test('OAuth origin accepts localhost and requires HTTPS for remote hosts', () => {
  assert.equal(resolveOAuthOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(
    resolveOAuthOrigin('https://preview.example.com', 'https://harbourhairsalon.vercel.app/path'),
    'https://harbourhairsalon.vercel.app'
  );
  assert.throws(() => resolveOAuthOrigin('http://example.com'), /must use HTTPS/);
});
