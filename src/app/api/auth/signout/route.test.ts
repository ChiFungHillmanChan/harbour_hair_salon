import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../../../../test/load-server-module';

function fixture() {
  const calls: string[] = [];
  const route = loadServerModule<typeof import('./route')>('src/app/api/auth/signout/route.ts', {
    '@/app/lib/session': { endAllSessions: async () => { calls.push('endAllSessions'); } },
    '@/app/lib/admin-mfa': { clearAdminMfaChallenge: async () => { calls.push('clearAdminMfaChallenge'); } },
  });
  return { route, calls };
}

function signOutRequest(fields: Record<string, string>, fetchSite: string | null = 'same-origin') {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (fetchSite) headers.set('sec-fetch-site', fetchSite);
  return new NextRequest('https://www.harbourhair.co.uk/api/auth/signout', {
    method: 'POST', headers, body: new URLSearchParams(fields).toString(),
  });
}

test('sign-out ends every session and tells the browser to clear its cache and storage', async () => {
  const { route, calls } = fixture();
  const response = await route.POST(signOutRequest({ locale: 'en-GB' }));
  assert.deepEqual(calls, ['endAllSessions', 'clearAdminMfaChallenge']);
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('location')!).pathname, '/');
  assert.equal(response.headers.get('clear-site-data'), '"cache", "storage"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('cookies are not on the Clear-Site-Data list, so the kiosk and language choice survive', () => {
  const { route } = fixture();
  assert.doesNotMatch(route.SIGN_OUT_CLEAR_SITE_DATA, /cookies|\*/);
});

test('a Chinese visitor lands on the Chinese home page', async () => {
  const { route } = fixture();
  const response = await route.POST(signOutRequest({ locale: 'zh-HK' }));
  assert.equal(new URL(response.headers.get('location')!).pathname, '/zh-hk');
});

test('an unknown or missing language falls back to English and never becomes a redirect target', async () => {
  const { route } = fixture();
  for (const locale of ['https://evil.example', '//evil.example', 'fr-FR']) {
    const response = await route.POST(signOutRequest({ locale }));
    const location = new URL(response.headers.get('location')!);
    assert.equal(location.origin, 'https://www.harbourhair.co.uk');
    assert.equal(location.pathname, '/');
  }
  const bare = await route.POST(signOutRequest({}, null));
  assert.equal(new URL(bare.headers.get('location')!).pathname, '/');
});

test('another site cannot sign this browser out', async () => {
  for (const fetchSite of ['cross-site', 'same-site']) {
    const { route, calls } = fixture();
    const response = await route.POST(signOutRequest({ locale: 'en-GB' }, fetchSite));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('clear-site-data'), null);
    assert.deepEqual(calls, []);
  }
});

test('sign-out has no GET handler, so a link scanner or prefetch cannot sign anyone out', () => {
  const { route } = fixture();
  assert.equal('GET' in route, false);
});
