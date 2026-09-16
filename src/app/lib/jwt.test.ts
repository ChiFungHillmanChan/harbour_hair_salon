import test from 'node:test';
import assert from 'node:assert/strict';
// NOTE: static import, not `await import('./jwt')` as in the task brief. This repo's
// package.json has no "type": "module", so tsx/esbuild transforms *.test.ts as CommonJS,
// which does not support top-level await (`Transform failed ... Top-level await is
// currently not supported with the "cjs" output format`). jwt.ts only reads
// SESSION_SECRET lazily inside getKey() at call time (never at module load), so a
// static import is equivalent here: the env var below is still set before any test
// body runs and actually calls encrypt/decrypt.
import { encrypt, decrypt } from './jwt';
import { decodeJwt, SignJWT } from 'jose';

process.env.SESSION_SECRET = 'test-session-secret-value-32-chars-min';

test('encrypt/decrypt round-trips a session payload', async () => {
  const token = await encrypt({ userId: 'u1', role: 'ADMIN', sessionVersion: 3, expiresAt: new Date(Date.now() + 1000) });
  const payload = await decrypt(token);
  assert.equal(payload?.userId, 'u1');
  assert.equal(payload?.role, 'ADMIN');
  assert.equal(payload?.sessionVersion, 3);
});

test('decrypt returns null for a tampered token', async () => {
  const token = await encrypt({ userId: 'u1', role: 'USER', sessionVersion: 0, expiresAt: new Date(Date.now() + 1000) });
  const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
  assert.equal(await decrypt(tampered), null);
});

test('decrypt returns null for undefined/empty input', async () => {
  assert.equal(await decrypt(undefined), null);
  assert.equal(await decrypt(''), null);
});

test('JWT expiration matches its bounded session expiry instead of always lasting 30 days', async () => {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const token = await encrypt({ userId: 'admin', role: 'ADMIN', sessionVersion: 0, expiresAt });
  assert.equal(decodeJwt(token).exp, Math.floor(expiresAt.getTime() / 1000));
});

test('legacy administrator tokens cannot remain valid beyond eight hours', async () => {
  const issuedAt = Math.floor(Date.now() / 1000) - 9 * 60 * 60;
  const token = await new SignJWT({ userId: 'admin', role: 'ADMIN', sessionVersion: 0, expiresAt: new Date(Date.now() + 86_400_000) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt(issuedAt).setExpirationTime('1d')
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
  assert.equal(await decrypt(token), null);
});
