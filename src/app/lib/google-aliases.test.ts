import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleAliases } from './google-aliases';

test('aliases: comma lists in English and Chinese punctuation, trimmed, de-duplicated ignoring case', () => {
  assert.deepEqual(parseGoogleAliases(' F , f,,Funky '), ['F', 'Funky']);
  assert.deepEqual(parseGoogleAliases('天，阿天、 T '), ['天', '阿天', 'T']);
  assert.deepEqual(parseGoogleAliases(null), []);
  assert.deepEqual(parseGoogleAliases(undefined), []);
  assert.deepEqual(parseGoogleAliases('  ,  '), []);
});
