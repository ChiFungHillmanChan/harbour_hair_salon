import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ratelimit } from '@upstash/ratelimit';
import { createFailureLimiter, createRateLimiter, DEPOSIT_DECLINE_ACCOUNT_POLICY, DEPOSIT_DECLINE_IP_POLICY } from './rate-limit';

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

// Money-safety review I4: card testing through one verified account (or one
// address) was limited only by bookingLimiter (6 an hour). Declines are
// counted in a limiter of their own; checking it spends nothing.
const declines = { prefix: 'rl:test-decline', limit: 3, windowSeconds: 24 * 60 * 60 };

test('a failure limiter spends nothing on a check: only recorded failures count, per key', async () => {
  const limiter = createFailureLimiter(declines, { redis: null });
  for (let i = 0; i < 10; i++) assert.equal(await limiter.allows('user:1'), true, 'checks alone never use it up');
  await limiter.record('user:1');
  await limiter.record('user:1');
  assert.equal(await limiter.allows('user:1'), true, 'two declines: still allowed');
  await limiter.record('user:1');
  assert.equal(await limiter.allows('user:1'), false, 'the third decline closes it');
  assert.equal(await limiter.allows('user:2'), true);
});

test('a failure limiter never fails open: Redis down or silent, what this instance counted still decides', async (t) => {
  t.mock.method(console, 'error', () => {});
  const down = createFailureLimiter(declines, {
    redis: { limit: async () => { throw new Error('connection refused'); }, getRemaining: async () => { throw new Error('connection refused'); } },
  });
  for (let i = 0; i < 3; i++) await down.record('user:1');
  assert.equal(await down.allows('user:1'), false);

  const silent = createFailureLimiter(declines, {
    redis: { limit: async () => ({ success: true, reason: 'timeout' }), getRemaining: () => new Promise<{ remaining: number }>(() => {}) },
    timeoutMs: 20,
  });
  assert.equal(await silent.allows('ip:1'), true, 'nothing counted yet');
  for (let i = 0; i < 3; i++) await silent.record('ip:1');
  assert.equal(await silent.allows('ip:1'), false, 'a Redis that never answers cannot reopen it');
});

test('Redis\'s count is trusted when it answers: declines another instance saw close it here too', async () => {
  const recorded: string[] = [];
  const shared = createFailureLimiter(declines, {
    redis: { limit: async (key: string) => { recorded.push(key); return { success: true }; }, getRemaining: async () => ({ remaining: 0 }) },
  });
  assert.equal(await shared.allows('user:1'), false);
  await shared.record('user:9');
  assert.deepEqual(recorded, ['user:9'], 'a decline is counted in Redis');
});

test('deposit declines: 3 per account and 5 per address in 24 hours', () => {
  assert.deepEqual(DEPOSIT_DECLINE_ACCOUNT_POLICY, { prefix: 'rl:decline-acct', limit: 3, windowSeconds: 24 * 60 * 60 });
  assert.deepEqual(DEPOSIT_DECLINE_IP_POLICY, { prefix: 'rl:decline-ip', limit: 5, windowSeconds: 24 * 60 * 60 });
});
