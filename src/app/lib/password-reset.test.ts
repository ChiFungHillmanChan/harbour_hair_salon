import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateResetToken,
  hashResetToken,
  evaluateResetToken,
  RESET_TOKEN_TTL_MS,
} from './password-reset';

test('generated tokens are URL-safe and unpredictable', () => {
  const a = generateResetToken();
  const b = generateResetToken();
  assert.notEqual(a, b, 'two tokens must never collide');
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'must survive a query string unescaped');
  // 32 raw bytes -> 43 base64url chars.
  assert.equal(a.length, 43);
});

test('hashing is deterministic, 64-char hex, and differs per token', () => {
  const token = generateResetToken();
  assert.equal(hashResetToken(token), hashResetToken(token));
  assert.match(hashResetToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashResetToken(token), hashResetToken(generateResetToken()));
});

test('the raw token is not recoverable from its hash', () => {
  const token = generateResetToken();
  assert.ok(!hashResetToken(token).includes(token));
});

test('a fresh, unused token is accepted', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  const record = { expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS), usedAt: null };
  assert.deepEqual(evaluateResetToken(record, now), { ok: true });
});

test('an already-used token is rejected even while unexpired', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  const record = {
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    usedAt: new Date(now.getTime() - 1000),
  };
  assert.deepEqual(evaluateResetToken(record, now), { ok: false, reason: 'used' });
});

test('an expired token is rejected', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  const record = { expiresAt: new Date(now.getTime() - 1), usedAt: null };
  assert.deepEqual(evaluateResetToken(record, now), { ok: false, reason: 'expired' });
});

test('expiry is exclusive — a token expiring exactly now is rejected', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  assert.deepEqual(evaluateResetToken({ expiresAt: now, usedAt: null }, now), {
    ok: false,
    reason: 'expired',
  });
});

test('used takes precedence over expired for a consumed, stale token', () => {
  const now = new Date('2026-07-25T12:00:00Z');
  const record = {
    expiresAt: new Date(now.getTime() - 10_000),
    usedAt: new Date(now.getTime() - 20_000),
  };
  assert.deepEqual(evaluateResetToken(record, now), { ok: false, reason: 'used' });
});
