import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWhere } from './prisma-where';

// The fakes that evaluate `where` through this helper must agree with
// PostgreSQL, or a test passes while the real query drops rows.

test('contains / startsWith / endsWith are case-sensitive unless mode is insensitive', () => {
  const row = { name: 'Mei Ling' };
  assert.equal(matchesWhere(row, { name: { contains: 'mei' } }), false);
  assert.equal(matchesWhere(row, { name: { contains: 'mei', mode: 'insensitive' } }), true);
  assert.equal(matchesWhere(row, { name: { endsWith: 'LING', mode: 'insensitive' } }), true);
});

test('`not` never matches a NULL field, as `x <> value` is unknown in SQL; `not: null` is IS NOT NULL', () => {
  assert.equal(matchesWhere({ phone: null }, { phone: { not: '0770' } }), false);
  assert.equal(matchesWhere({ phone: '0771' }, { phone: { not: '0770' } }), true);
  assert.equal(matchesWhere({ phone: null }, { phone: { not: null } }), false);
  assert.equal(matchesWhere({ phone: '0771' }, { phone: { not: null } }), true);
});

test('NOT over a NULL field throws instead of guessing; over a set field it negates', () => {
  assert.throws(() => matchesWhere({ phone: null }, { NOT: { phone: { contains: '077' } } }), /NULL field "phone"/);
  assert.equal(matchesWhere({ email: 'a@walk-in.invalid' }, { NOT: { email: { endsWith: '@walk-in.invalid' } } }), false);
  assert.equal(matchesWhere({ email: 'a@example.test' }, { NOT: { email: { endsWith: '@walk-in.invalid' } } }), true);
  assert.equal(matchesWhere({ deletedAt: null }, { NOT: { deletedAt: null } }), false, 'NOT { x: null } is IS NOT NULL');
});

test('mode with an operator it does not modify, and unknown operators, throw', () => {
  assert.throws(() => matchesWhere({ name: 'Mei' }, { name: { equals: 'mei', mode: 'insensitive' } }), /mode/);
  assert.throws(() => matchesWhere({ name: 'Mei' }, { name: { in: ['mei'], mode: 'insensitive' } }), /mode/);
  assert.throws(() => matchesWhere({ name: 'Mei' }, { name: { search: 'mei' } }), /unsupported operator "search"/);
});
