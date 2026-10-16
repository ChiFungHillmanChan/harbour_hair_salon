import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { channelToken, channelTokenMatches } from './google-channel-token';

test('the channel token is HMAC-SHA256 of the channel id under the webhook secret, in hex', () => {
  const expected = createHmac('sha256', 'secret').update('channel-1').digest('hex');
  assert.equal(channelToken('secret', 'channel-1'), expected);
  assert.match(channelToken('secret', 'channel-1'), /^[0-9a-f]{64}$/);
  assert.notEqual(channelToken('secret', 'channel-2'), expected, 'each channel has its own token');
  assert.notEqual(channelToken('other', 'channel-1'), expected, 'and it depends on the secret');
});

test('only the token minted for that channel and secret matches', () => {
  const token = channelToken('secret', 'channel-1');
  assert.equal(channelTokenMatches('secret', 'channel-1', token), true);
  for (const wrong of ['', token.slice(0, -1), `${token}0`, token.toUpperCase(), channelToken('secret', 'channel-2'), channelToken('other', 'channel-1'), 'x'.repeat(64)]) {
    assert.equal(channelTokenMatches('secret', 'channel-1', wrong), false, wrong);
  }
});
