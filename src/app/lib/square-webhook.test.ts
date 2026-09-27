import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySquareWebhookSignature } from './square-webhook';

// Square's published signature-validation example: independently known HMAC.
const example = {
  body: '{"hello":"world"}', signatureKey: 'asdf1234',
  notificationUrl: 'https://example.com/webhook',
  signature: '2kRE5qRU2tR+tBGlDwMEw2avJ7QM4ikPYD/PJ3bd9Og=',
};

test('accepts the signature from Square documentation', () => {
  assert.equal(verifySquareWebhookSignature(example), true);
});

test('rejects changed body bytes, URL, and signing key', () => {
  for (const patch of [{ body: '{ "hello": "world" }' }, { notificationUrl: 'https://example.com/webhook/' }, { signatureKey: 'wrong' }]) {
    assert.equal(verifySquareWebhookSignature({ ...example, ...patch }), false);
  }
});

test('rejects missing, malformed, or noncanonical signatures without throwing', () => {
  for (const signature of [null, '', 'a', 'A'.repeat(44), example.signature + 'junk', example.signature.replace('=', '')]) {
    assert.equal(verifySquareWebhookSignature({ ...example, signature }), false);
  }
});

test('does not authenticate with missing or CI placeholder credentials', () => {
  for (const signatureKey of ['', '[SENSITIVE]']) {
    const signature = createHmac('sha256', signatureKey).update(example.notificationUrl + example.body).digest('base64');
    assert.equal(verifySquareWebhookSignature({ ...example, signatureKey, signature }), false);
  }
});

test('handles unicode and exact query-string encoding without normalizing the signed URL', () => {
  const body = '{"name":"海港 💇"}';
  const notificationUrl = 'https://example.com/webhook?a=%2f&b=1';
  const signature = createHmac('sha256', example.signatureKey).update(notificationUrl).update(body).digest('base64');
  assert.equal(verifySquareWebhookSignature({ ...example, body, notificationUrl, signature }), true);
  assert.equal(verifySquareWebhookSignature({ ...example, body, notificationUrl: notificationUrl.replace('%2f', '%2F'), signature }), false);
});
