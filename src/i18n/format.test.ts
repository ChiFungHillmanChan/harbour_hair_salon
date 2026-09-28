import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage, interpolate, lookup, placeholders } from './format';
import { createTranslator } from './translator';

test('interpolation and plural selection follow the locale', () => {
  assert.equal(interpolate('Hello {name}', { name: 'Ivy' }), 'Hello Ivy');
  assert.equal(interpolate('Hello {name}', {}), 'Hello {name}');
  const bookings = { one: '{count} booking', other: '{count} bookings' };
  assert.equal(formatMessage('en-GB', bookings, { count: 1 }), '1 booking');
  assert.equal(formatMessage('en-GB', bookings, { count: 3 }), '3 bookings');
  assert.equal(formatMessage('zh-HK', { other: '{count} 個預約' }, { count: 1 }), '1 個預約');
  assert.equal(formatMessage('en-GB', { zero: 'No bookings', one: '{count} booking', other: '{count} bookings' }, { count: 0 }), 'No bookings');
});

test('lookup walks dotted keys and refuses to treat a plural form as a branch', () => {
  const tree = { step: { title: 'Pick' }, count: { one: 'a', other: 'b' } };
  assert.equal(lookup(tree, 'step.title'), 'Pick');
  assert.deepEqual(lookup(tree, 'count'), { one: 'a', other: 'b' });
  assert.equal(lookup(tree, 'count.one'), undefined);
  assert.equal(lookup(tree, 'missing.key'), undefined);
  assert.deepEqual(placeholders({ one: '{count} x', other: '{count} {name}' }), ['count', 'name']);
});

test('a missing message stays visible instead of rendering blank', () => {
  const t = createTranslator('en-GB', { a: 'A' }, 'demo');
  assert.equal(t.dynamic('nope', {}, undefined), 'demo.nope');
  assert.equal(t.dynamic('nope', {}, 'Fallback'), 'Fallback');
  assert.equal(t.has('a'), true);
});
