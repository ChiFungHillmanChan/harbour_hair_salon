import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindow } from './sliding-window';

test('allows up to the limit then blocks', () => {
  const w = new SlidingWindow({ limit: 3, windowMs: 1000 });
  assert.equal(w.check('a', 0), true);
  assert.equal(w.check('a', 100), true);
  assert.equal(w.check('a', 200), true);
  assert.equal(w.check('a', 300), false);
});

test('keys are independent', () => {
  const w = new SlidingWindow({ limit: 1, windowMs: 1000 });
  assert.equal(w.check('a', 0), true);
  assert.equal(w.check('b', 0), true);
  assert.equal(w.check('a', 1), false);
  assert.equal(w.check('b', 1), false);
});

test('the window slides — old hits stop counting', () => {
  const w = new SlidingWindow({ limit: 2, windowMs: 1000 });
  assert.equal(w.check('a', 0), true);
  assert.equal(w.check('a', 500), true);
  assert.equal(w.check('a', 900), false, 'both hits still inside the window');
  // t=1001 drops the t=0 hit (cutoff is exclusive of <= now-windowMs).
  assert.equal(w.check('a', 1001), true);
  assert.equal(w.check('a', 1002), false, 't=500 and t=1001 now fill the window');
});

test('a blocked attempt does not extend the window', () => {
  // Regression guard: rejected attempts must not be recorded, otherwise a
  // hammering client could never recover once blocked.
  const w = new SlidingWindow({ limit: 1, windowMs: 1000 });
  assert.equal(w.check('a', 0), true);
  assert.equal(w.check('a', 500), false);
  assert.equal(w.check('a', 900), false);
  assert.equal(w.check('a', 1001), true, 'recovers once the original hit ages out');
});

test('limit of 1 blocks the second call immediately', () => {
  const w = new SlidingWindow({ limit: 1, windowMs: 60_000 });
  assert.equal(w.check('x', 0), true);
  assert.equal(w.check('x', 0), false);
});

test('evicts expired keys instead of growing without bound', () => {
  const w = new SlidingWindow({ limit: 5, windowMs: 1000, maxKeys: 10 });
  for (let i = 0; i < 50; i++) w.check(`key-${i}`, i);
  // Well past the window: the next check should sweep every stale key.
  w.check('fresh', 100_000);
  assert.ok(w.size() <= 11, `expected bounded key set, got ${w.size()}`);
});

test('eviction keeps the map bounded even when all keys are live', () => {
  const w = new SlidingWindow({ limit: 5, windowMs: 100_000, maxKeys: 10 });
  for (let i = 0; i < 100; i++) w.check(`key-${i}`, i);
  assert.ok(w.size() <= 11, `expected <= 11 keys, got ${w.size()}`);
});

test('rejects nonsensical configuration', () => {
  assert.throws(() => new SlidingWindow({ limit: 0, windowMs: 1000 }));
  assert.throws(() => new SlidingWindow({ limit: 1, windowMs: 0 }));
});
