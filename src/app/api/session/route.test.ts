import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../../test/load-server-module';

function route(options: { cookie: boolean; current: boolean }) {
  const decoded = options.cookie ? { userId: 'customer', role: 'USER', sessionVersion: 0, expiresAt: new Date(Date.now() + 60_000) } : null;
  return loadServerModule<typeof import('./route')>('src/app/api/session/route.ts', {
    '@/app/lib/session': { getSession: async () => decoded, isSessionCurrent: async () => options.current },
  });
}

const cleared = (response: Response) => response.headers.getSetCookie()
  .filter((cookie) => /Expires=Thu, 01 Jan 1970/i.test(cookie) || /Max-Age=0/i.test(cookie))
  .map((cookie) => cookie.split('=')[0]);

test('a current session is reported and its header hint refreshed', async () => {
  const response = await route({ cookie: true, current: true }).GET();
  assert.deepEqual(await response.json(), { session: { userId: 'customer', role: 'USER' } });
  assert.deepEqual(cleared(response), []);
});

test('a token revoked by sign-out answers signed out and its cookies are removed', async () => {
  const response = await route({ cookie: true, current: false }).GET();
  assert.deepEqual(await response.json(), { session: null });
  assert.deepEqual(cleared(response).sort(), ['session', 'session_hint']);
});

test('no cookie: signed out, nothing to remove', async () => {
  const response = await route({ cookie: false, current: false }).GET();
  assert.deepEqual(await response.json(), { session: null });
  assert.deepEqual(response.headers.getSetCookie(), []);
});
