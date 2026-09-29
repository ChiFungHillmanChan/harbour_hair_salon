import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { loadServerModule } from '../../test/load-server-module';
import { accountRateLimitKey } from './rate-limit';

function browser(t: TestContext) {
  const prior = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'login-device-test-session-secret-32-chars';
  t.after(() => { if (prior === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prior; });
  const jar = new Map<string, string>();
  const options: Record<string, unknown>[] = [];
  const store = {
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown>) => { jar.set(name, value); options.push(opts); },
  };
  const device = loadServerModule<typeof import('./login-device')>('src/app/lib/login-device.ts', {
    'next/headers': { cookies: async () => store },
  });
  return { device, jar, options };
}

test('a browser that signed in to an account is recognised for that account only', async (t) => {
  const { device, options } = browser(t);
  assert.equal(await device.isRecognisedLoginDevice('owner@example.invalid'), false);
  await device.rememberLoginDevice('owner@example.invalid');
  assert.equal(await device.isRecognisedLoginDevice('Owner@Example.invalid'), true);
  assert.equal(await device.isRecognisedLoginDevice('someone-else@example.invalid'), false);
  assert.equal(options[0].httpOnly, true);
  assert.equal(options[0].sameSite, 'lax');
});

test('a forged or session-keyed cookie is not recognised', async (t) => {
  const { device, jar } = browser(t);
  const accounts = [accountRateLimitKey('owner@example.invalid')];
  // Signed with the raw session secret — what a session cookie uses — not the derived key.
  jar.set(device.LOGIN_DEVICE_COOKIE, await new SignJWT({ purpose: 'login-device', accounts })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET)));
  assert.equal(await device.isRecognisedLoginDevice('owner@example.invalid'), false);
  jar.set(device.LOGIN_DEVICE_COOKIE, 'not-a-token');
  assert.equal(await device.isRecognisedLoginDevice('owner@example.invalid'), false);
});

test('a shared browser remembers a handful of accounts, newest first', async (t) => {
  const { device } = browser(t);
  for (let i = 1; i <= 6; i++) await device.rememberLoginDevice(`staff-${i}@example.invalid`);
  assert.equal(await device.isRecognisedLoginDevice('staff-6@example.invalid'), true);
  assert.equal(await device.isRecognisedLoginDevice('staff-2@example.invalid'), true);
  assert.equal(await device.isRecognisedLoginDevice('staff-1@example.invalid'), false, 'the oldest drops off');
});
