import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinTimeout } from './within-timeout';

// Shared by the Redis limiter and the Resend contact calls (erasure,
// unsubscribe): those tests reach it only through their callers.

test('work that answers in time is returned, and its timer is cleared', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const cleared = context.mock.method(globalThis, 'clearTimeout');
  assert.equal(await withinTimeout(Promise.resolve('answer'), 10_000), 'answer');
  assert.equal(cleared.mock.callCount(), 1, 'no live timer is left behind for each call');
});

test('work that fails in time passes its own error through', async () => {
  const failure = new Error('provider refused');
  await assert.rejects(withinTimeout(Promise.reject(failure), 10_000), (error) => error === failure);
});

test('work that never answers is given up exactly at the limit', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  let failure: unknown;
  const result = withinTimeout(new Promise<never>(() => {}), 10_000).catch((error: unknown) => { failure = error; }).finally(() => { settled = true; });
  context.mock.timers.tick(9_999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'still waiting a moment before the limit');
  context.mock.timers.tick(1);
  await result;
  assert.ok(failure instanceof Error && failure.message === 'timeout');
});

test('an answer arriving after the limit changes nothing', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let answer!: (value: string) => void;
  const late = withinTimeout(new Promise<string>((resolve) => { answer = resolve; }), 10_000);
  context.mock.timers.tick(10_000);
  answer('too late');
  await assert.rejects(late, /timeout/);
});
