import test from 'node:test';
import assert from 'node:assert/strict';
import { toTelHref } from './phone';

test('strips spaces and converts a leading 0 to +44', () => {
  assert.equal(toTelHref('07831 830898'), 'tel:+447831830898');
});

test('leaves an already-international number untouched aside from stripping spaces', () => {
  assert.equal(toTelHref('+44 7831 830898'), 'tel:+447831830898');
});

test('does not double-prefix a number with no leading 0 or +', () => {
  assert.equal(toTelHref('7831830898'), 'tel:7831830898');
});
