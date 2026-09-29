import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  createUnsubscribeToken,
  createUnsubscribeUrl,
  unsubscribeUrl,
  UNSUBSCRIBE_TOKEN_PURPOSE,
  verifyUnsubscribeToken,
} from './unsubscribe-token';

const SECRET = 'unsubscribe-token-test-session-secret-32';
process.env.SESSION_SECRET = SECRET;

const DAY = 86_400_000;

test('a link verifies for the normalised address it was issued to', async () => {
  const token = await createUnsubscribeToken('  Customer@Example.COM ');
  assert.equal(await verifyUnsubscribeToken(token), 'customer@example.com');
});

test('a tampered link is refused', async () => {
  const token = await createUnsubscribeToken('customer@example.com');
  const [header, , signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({
    purpose: UNSUBSCRIBE_TOKEN_PURPOSE, email: 'someone-else@example.com', exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  assert.equal(await verifyUnsubscribeToken(`${header}.${forgedPayload}.${signature}`), null);
  const flipped = signature.slice(0, -2) + (signature.at(-2) === 'A' ? 'B' : 'A') + signature.at(-1);
  assert.equal(await verifyUnsubscribeToken(`${token.split('.').slice(0, 2).join('.')}.${flipped}`), null);
  assert.equal(await verifyUnsubscribeToken('not-a-token'), null);
  assert.equal(await verifyUnsubscribeToken(''), null);
  assert.equal(await verifyUnsubscribeToken('a'.repeat(5000)), null);
});

test('only an unsubscribe token is accepted — not another purpose, nor a session-keyed token', async () => {
  const purposeKey = createHmac('sha256', SECRET).update(UNSUBSCRIBE_TOKEN_PURPOSE).digest();
  const wrongPurpose = await new SignJWT({ purpose: 'password-reset', email: 'customer@example.com' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(purposeKey);
  assert.equal(await verifyUnsubscribeToken(wrongPurpose), null);

  // Signed with the raw SESSION_SECRET, as sessions and OAuth state are.
  const sessionKeyed = await new SignJWT({ purpose: UNSUBSCRIBE_TOKEN_PURPOSE, email: 'customer@example.com' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  assert.equal(await verifyUnsubscribeToken(sessionKeyed), null);

  const unsigned = await new SignJWT({ purpose: UNSUBSCRIBE_TOKEN_PURPOSE, email: 'customer@example.com' })
    .setProtectedHeader({ alg: 'HS512' }).setIssuedAt().setExpirationTime('1h').sign(new Uint8Array(64).fill(1));
  assert.equal(await verifyUnsubscribeToken(unsigned), null);
});

test('a link expires after 30 days', async () => {
  const issued = new Date('2026-09-01T12:00:00Z');
  const token = await createUnsubscribeToken('customer@example.com', issued);
  assert.equal(await verifyUnsubscribeToken(token, new Date(issued.getTime() + 29 * DAY)), 'customer@example.com');
  assert.equal(await verifyUnsubscribeToken(token, new Date(issued.getTime() + 31 * DAY)), null);
});

test('links land on the unsubscribe page in the language they were sent in', async () => {
  assert.match(unsubscribeUrl('abc.def', 'en-GB'), /^https?:\/\/[^/]+\/unsubscribe\?token=abc\.def$/);
  assert.match(unsubscribeUrl('abc.def', 'zh-HK'), /\/zh-hk\/unsubscribe\?token=abc\.def$/);
  const url = new URL(await createUnsubscribeUrl('Customer@Example.com', 'en-GB'));
  assert.equal(await verifyUnsubscribeToken(url.searchParams.get('token') ?? ''), 'customer@example.com');
});
