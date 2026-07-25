import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedisCredentials } from './redis-credentials';

test('resolves the Vercel Marketplace KV_* pair', () => {
  // This is the shape `vercel integration add upstash/upstash-kv` produces.
  assert.deepEqual(
    resolveRedisCredentials({
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'tok',
    }),
    { url: 'https://example.upstash.io', token: 'tok' },
  );
});

test('resolves the hand-configured UPSTASH_* pair', () => {
  assert.deepEqual(
    resolveRedisCredentials({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok',
    }),
    { url: 'https://example.upstash.io', token: 'tok' },
  );
});

test('UPSTASH_* wins when both schemes are present', () => {
  assert.deepEqual(
    resolveRedisCredentials({
      UPSTASH_REDIS_REST_URL: 'https://explicit.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'explicit',
      KV_REST_API_URL: 'https://integration.upstash.io',
      KV_REST_API_TOKEN: 'integration',
    }),
    { url: 'https://explicit.upstash.io', token: 'explicit' },
  );
});

test('the two schemes may be mixed', () => {
  assert.deepEqual(
    resolveRedisCredentials({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'tok',
    }),
    { url: 'https://example.upstash.io', token: 'tok' },
  );
});

test('a half-configured environment resolves to null, not a broken client', () => {
  assert.equal(resolveRedisCredentials({ KV_REST_API_URL: 'https://example.upstash.io' }), null);
  assert.equal(resolveRedisCredentials({ KV_REST_API_TOKEN: 'tok' }), null);
});

test('empty and whitespace-only values count as missing', () => {
  assert.equal(resolveRedisCredentials({ KV_REST_API_URL: '', KV_REST_API_TOKEN: 'tok' }), null);
  assert.equal(resolveRedisCredentials({ KV_REST_API_URL: '   ', KV_REST_API_TOKEN: 'tok' }), null);
});

test('values are trimmed', () => {
  assert.deepEqual(
    resolveRedisCredentials({ KV_REST_API_URL: '  https://x.upstash.io  ', KV_REST_API_TOKEN: ' tok ' }),
    { url: 'https://x.upstash.io', token: 'tok' },
  );
});

test('the read-only token is NOT accepted — rate limiting must write', () => {
  assert.equal(
    resolveRedisCredentials({
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_READ_ONLY_TOKEN: 'readonly',
    }),
    null,
  );
});

test('an empty environment resolves to null', () => {
  assert.equal(resolveRedisCredentials({}), null);
});
