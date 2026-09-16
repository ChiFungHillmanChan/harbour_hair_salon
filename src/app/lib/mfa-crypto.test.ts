import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Secret } from 'otpauth';
import { encryptMfaSecret, decryptMfaSecret, matchTotpStep, createRecoveryCodes, hashRecoveryCode } from './mfa-crypto';

process.env.SESSION_SECRET = 'fixture-mfa-encryption-key-not-production';

test('MFA seed encryption is authenticated and randomized', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const encrypted = encryptMfaSecret(secret);
  assert.equal(decryptMfaSecret(encrypted), secret);
  assert.notEqual(encrypted, encryptMfaSecret(secret));
  assert.equal(encrypted.includes(secret), false);
  const parts = encrypted.split('.');
  parts[2] = Buffer.alloc(16).toString('base64url');
  assert.throws(() => decryptMfaSecret(parts.join('.')));
});

test('TOTP matches the RFC 6238 SHA1 vector and returns the replay-protection counter', () => {
  const secret = Secret.fromUTF8('12345678901234567890').base32;
  assert.equal(matchTotpStep(secret, '287082', 59_000), 1);
  assert.equal(matchTotpStep(secret, '000000', 59_000), null);
  assert.equal(matchTotpStep(secret, '287082', 150_000), null);
});

test('recovery codes are unpredictable and only normalized hashes are stored', () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    assert.match(code, /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/);
    assert.equal(hashRecoveryCode(code), hashRecoveryCode(code.toLowerCase().replaceAll('-', '')));
    assert.equal(hashRecoveryCode(code).length, 64);
  }
});

test('maintenance can re-encrypt a seed with a new domain-separated key', () => {
  const oldKey = 'old-fixture-key-at-least-32-characters';
  const newKey = 'new-fixture-key-at-least-32-characters';
  const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', oldKey);
  assert.equal(decryptMfaSecret(encrypted, oldKey), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decryptMfaSecret(encrypted, newKey));
  const rotated = encryptMfaSecret(decryptMfaSecret(encrypted, oldKey), newKey);
  assert.equal(decryptMfaSecret(rotated, newKey), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decryptMfaSecret(rotated, oldKey));
});
