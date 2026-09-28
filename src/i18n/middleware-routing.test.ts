import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { loadServerModule } from '../test/load-server-module';

const SECRET = 'middleware-routing-test-secret-at-least-32-chars';
process.env.SESSION_SECRET = SECRET;
const { middleware } = loadServerModule<typeof import('../middleware')>('src/middleware.ts', {});

async function sessionCookie(role: 'ADMIN' | 'USER') {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ userId: `${role.toLowerCase()}-1`, role, sessionVersion: 0, expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(SECRET));
  return `session=${token}`;
}

const visit = (path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) =>
  middleware(new NextRequest(`https://salon.test${path}`, { headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers } }));

const location = (response: Response) => {
  const value = response.headers.get('location');
  return value ? new URL(value).pathname + new URL(value).search : null;
};

test('English keeps its URLs (served from the internal segment); /zh-hk is served as is', async () => {
  const english = await visit('/services');
  assert.equal(new URL(english.headers.get('x-middleware-rewrite')!).pathname, '/en-gb/services');
  assert.equal(english.headers.get('x-middleware-request-x-harbour-locale'), 'en-GB');
  const home = await visit('/');
  assert.equal(new URL(home.headers.get('x-middleware-rewrite')!).pathname, '/en-gb');
  const chinese = await visit('/zh-hk/services');
  assert.equal(chinese.headers.get('x-middleware-rewrite'), null);
  assert.equal(chinese.headers.get('x-middleware-request-x-harbour-locale'), 'zh-HK');
});

test('the internal English segment is never a second public URL', async () => {
  const response = await visit('/en-gb/book?x=1');
  assert.equal(response.status, 308);
  assert.equal(location(response), '/book?x=1');
});

test('a client cannot choose the language header; middleware always overwrites it', async () => {
  const response = await visit('/services', { headers: { 'x-harbour-locale': 'zh-HK' } });
  assert.equal(response.headers.get('x-middleware-request-x-harbour-locale'), 'en-GB');
});

test('protected areas have the same rules in both languages, and redirects keep the language', async () => {
  for (const [prefix, signIn] of [['', '/auth/signin'], ['/zh-hk', '/zh-hk/auth/signin']] as const) {
    assert.equal(location(await visit(`${prefix}/admin`)), signIn, `${prefix}/admin anonymous`);
    assert.equal(location(await visit(`${prefix}/admin/services`, { cookie: await sessionCookie('USER') })), prefix || '/', `${prefix}/admin as customer`);
    assert.equal((await visit(`${prefix}/admin`, { cookie: await sessionCookie('ADMIN') })).headers.get('location'), null, `${prefix}/admin as admin`);
    assert.equal(location(await visit(`${prefix}/appointments`)), `${signIn}?redirect=${encodeURIComponent(`${prefix}/appointments`)}`);
    assert.equal(location(await visit(`${prefix}/kiosk`)), `${signIn}?redirect=${encodeURIComponent(`${prefix}/kiosk`)}`);
    assert.equal(location(await visit(`${prefix}/reviews/new?appointmentId=a1`)), `${signIn}?redirect=${encodeURIComponent(`${prefix}/reviews/new?appointmentId=a1`)}`);
  }
});

test('a lookalike prefix is not a language and cannot reach a protected page unguarded', async () => {
  const response = await visit('/zh-hkx/admin');
  // Treated as an ordinary English path (which does not exist → 404 page), never as /admin.
  assert.equal(new URL(response.headers.get('x-middleware-rewrite')!).pathname, '/en-gb/zh-hkx/admin');
  assert.equal(location(await visit('/zh-hk/zh-hk/admin')), null, 'a doubled prefix is not the admin area either');
});
