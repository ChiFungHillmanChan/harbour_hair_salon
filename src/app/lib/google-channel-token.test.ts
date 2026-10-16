import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { channelToken, channelTokenMatches } from './google-channel-token';

const NOW = new Date('2099-09-01T12:00:00Z');
const EXPIRES = new Date('2099-09-08T13:00:00Z');
const EXP_SEC = String(EXPIRES.getTime() / 1000);

test('the channel token carries its expiry and HMAC-SHA256 of the channel id and that expiry, in hex', () => {
  const hmac = createHmac('sha256', 'secret').update(`channel-1.${EXP_SEC}`).digest('hex');
  assert.equal(channelToken('secret', 'channel-1', EXPIRES), `${EXP_SEC}.${hmac}`);
  assert.match(channelToken('secret', 'channel-1', EXPIRES), /^\d+\.[0-9a-f]{64}$/);
  assert.ok(channelToken('secret', 'channel-1', EXPIRES).length <= 256, 'within Google\'s token limit');
  assert.notEqual(channelToken('secret', 'channel-2', EXPIRES), channelToken('secret', 'channel-1', EXPIRES), 'each channel has its own token');
  assert.notEqual(channelToken('other', 'channel-1', EXPIRES), channelToken('secret', 'channel-1', EXPIRES), 'and it depends on the secret');
  // Sub-second parts of the expiry are dropped, never rounded up.
  assert.equal(channelToken('secret', 'channel-1', new Date(EXPIRES.getTime() + 999)), channelToken('secret', 'channel-1', EXPIRES));
});

test('only the token minted for that channel and secret matches, until it expires', () => {
  const token = channelToken('secret', 'channel-1', EXPIRES);
  assert.equal(channelTokenMatches('secret', 'channel-1', token, NOW), true);
  assert.equal(channelTokenMatches('secret', 'channel-1', token, new Date(EXPIRES.getTime() - 1)), true, 'up to its expiry');
  const [, hmac] = token.split('.');
  const later = String(Number(EXP_SEC) + 365 * 24 * 3600);
  for (const wrong of [
    '', token.slice(0, -1), `${token}0`, token.toUpperCase(), `x${token}`, hmac, `.${hmac}`, `${EXP_SEC}.`, `${EXP_SEC}.${hmac}.${EXP_SEC}`,
    channelToken('secret', 'channel-2', EXPIRES), channelToken('other', 'channel-1', EXPIRES),
    // A longer life written over a real signature: the signature no longer matches.
    `${later}.${hmac}`,
    `-1.${hmac}`, `${EXP_SEC}.${'0'.repeat(64)}`,
  ]) {
    assert.equal(channelTokenMatches('secret', 'channel-1', wrong, NOW), false, wrong);
  }
});

test('an expired token is refused even with a valid signature', () => {
  const token = channelToken('secret', 'channel-1', EXPIRES);
  assert.equal(channelTokenMatches('secret', 'channel-1', token, EXPIRES), false);
  assert.equal(channelTokenMatches('secret', 'channel-1', token, new Date(EXPIRES.getTime() + 24 * 3600_000)), false);
});
