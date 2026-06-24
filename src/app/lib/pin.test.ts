import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPin, hashPin, verifyPin } from './pin';

test('isValidPin accepts 4-6 digit PINs', () => {
  for (const ok of ['0000', '12345', '987654']) assert.equal(isValidPin(ok), true);
});

test('isValidPin rejects non-digit, too-short, too-long', () => {
  for (const bad of ['', '123', '1234567', '12a4', '12 4', ' 1234']) assert.equal(isValidPin(bad), false);
});

test('hashPin/verifyPin round-trips and rejects wrong PIN', async () => {
  const hash = await hashPin('4821');
  assert.notEqual(hash, '4821');
  assert.equal(await verifyPin('4821', hash), true);
  assert.equal(await verifyPin('0000', hash), false);
});
