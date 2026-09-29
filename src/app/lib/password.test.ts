import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BCRYPT_MAX_PASSWORD_BYTES, fitsBcryptLimit, hashPassword, verifyPassword } from './password';

test('bcrypt ignores everything after 72 bytes, which is why longer new passwords are refused', async () => {
  const shared = 'x'.repeat(BCRYPT_MAX_PASSWORD_BYTES);
  const hash = await hashPassword(`${shared}abc`);
  // Different tail, same first 72 bytes: bcrypt cannot tell them apart.
  assert.equal(await verifyPassword(`${shared}xyz`, hash), true);
  assert.equal(fitsBcryptLimit(`${shared}abc`), false);
});

test('the limit counts UTF-8 bytes, not characters', () => {
  assert.equal(fitsBcryptLimit('a'.repeat(72)), true);
  assert.equal(fitsBcryptLimit('a'.repeat(73)), false);
  // A Chinese character is three bytes: 24 fit, 25 do not.
  assert.equal(fitsBcryptLimit('髮'.repeat(24)), true);
  assert.equal(fitsBcryptLimit('髮'.repeat(25)), false);
  // An accented letter is two.
  assert.equal(fitsBcryptLimit('é'.repeat(36)), true);
  assert.equal(fitsBcryptLimit('é'.repeat(37)), false);
});
