import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactPhone, toTelHref } from './phone';

test('strips spaces and converts a leading 0 to +44', () => {
  assert.equal(toTelHref('07831 830898'), 'tel:+447831830898');
});

test('leaves an already-international number untouched aside from stripping spaces', () => {
  assert.equal(toTelHref('+44 7831 830898'), 'tel:+447831830898');
});

test('does not double-prefix a number with no leading 0 or +', () => {
  assert.equal(toTelHref('7831830898'), 'tel:7831830898');
});

test('a UK or international number is kept as written, trimmed', () => {
  assert.equal(normalizeContactPhone('07700 900123'), '07700 900123');
  assert.equal(normalizeContactPhone('  +44 7700 900123 '), '+44 7700 900123');
  assert.equal(normalizeContactPhone('(0113) 496-0000'), '(0113) 496-0000');
  assert.equal(normalizeContactPhone('+852 9123  4567'), '+852 9123 4567', 'inner spaces collapse');
});

test('missing, too short, too long or non-phone text is refused', () => {
  for (const raw of [undefined, null, '', '   ', '12345', 'call me', '07700 900123 ext 4', '0770090012345678', '+44 (0) 7700 900 123 45']) {
    assert.equal(normalizeContactPhone(raw), null, String(raw));
  }
});
