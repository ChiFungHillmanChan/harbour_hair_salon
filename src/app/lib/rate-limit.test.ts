import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ratelimit } from '@upstash/ratelimit';
import { createRateLimiter } from './rate-limit';

const policy = { prefix: 'rl:test', limit: 2, windowSeconds: 60 };

async function checkTimes(limiter: ReturnType<typeof createRateLimiter>, times: number) {
  const verdicts: boolean[] = [];
  for (let i = 0; i < times; i++) verdicts.push(await limiter.check('same-client'));
  return verdicts;
}

test('a Redis timeout falls back to the in-memory window instead of allowing every attempt', async () => {
  const limiter = createRateLimiter(policy, {
    redisLimiter: { limit: async () => ({ success: true, reason: 'timeout' }) },
  });
  assert.deepEqual(await checkTimes(limiter, 3), [true, true, false]);
  assert.equal(limiter.backend(), 'memory');
});

test('a thrown Redis error also falls back to the in-memory window', async () => {
  const limiter = createRateLimiter(policy, {
    redisLimiter: { limit: async () => { throw new Error('connection refused'); } },
  });
  assert.deepEqual(await checkTimes(limiter, 3), [true, true, false]);
  assert.equal(limiter.backend(), 'memory');
});

test('a normal Redis verdict is trusted, including a refusal', async () => {
  const limiter = createRateLimiter(policy, {
    redisLimiter: { limit: async () => ({ success: false }) },
  });
  assert.equal(await limiter.check('same-client'), false);
  assert.equal(limiter.backend(), 'redis');
});

// Pins the library behaviour the fallback depends on: if a future
// @upstash/ratelimit starts rejecting on timeout instead, the catch path still
// covers it, but if it starts resolving a DIFFERENT marker this test goes red.
test('@upstash/ratelimit resolves reason "timeout" (not a rejection) when Redis never answers', async () => {
  const neverAnswers = new Proxy({}, { get: () => () => new Promise(() => {}) });
  const real = new Ratelimit({
    redis: neverAnswers as never,
    limiter: Ratelimit.slidingWindow(2, '60 s'),
    prefix: 'rl:test-real',
    timeout: 20,
  });
  const result = await real.limit('same-client');
  assert.equal(result.reason, 'timeout');
  assert.equal(result.success, true, 'the library fails open on timeout, which is why rate-limit.ts must not trust it');

  const limiter = createRateLimiter(policy, { redisLimiter: real });
  assert.deepEqual(await checkTimes(limiter, 3), [true, true, false]);
});
