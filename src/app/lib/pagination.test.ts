import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateCursor, encodeDateCursor, pageNumber, searchText } from './pagination';

test('pagination clamps malformed, duplicate and excessively large query input', () => {
  for (const value of [undefined, '0', '-1', '10000', '1e9', '1.5', ['1', '2']]) assert.equal(pageNumber(value), 1);
  assert.equal(pageNumber('42'), 42);
  assert.equal(searchText(' x '.repeat(200)).length, 100);
  assert.equal(searchText(['two', 'terms']), '');
});
test('date cursor preserves tie-breaking ID and rejects invalid or excessive input', () => {
  const row = { id: 'cuid-example', date: new Date('2026-09-16T12:00:00Z') };
  assert.deepEqual(dateCursor(encodeDateCursor(row)), row);
  for (const value of ['garbage', 'x'.repeat(401), ['a', 'b'], Buffer.from('{"date":"invalid","id":"test"}').toString('base64url')]) assert.equal(dateCursor(value), null);
});
