import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { describeFault } from './fault';

// Logs carry the error's name and code, never its message: a driver or fetch
// message can quote the database host or a private calendar-feed URL.

test('a Neon outage keeps its Prisma code, which lives in errorCode', () => {
  const error = new Prisma.PrismaClientInitializationError("Can't reach database server at `ep-secret.eu-west-2.aws.neon.tech`", '6.19.3', 'P1001');
  assert.deepEqual(describeFault(error), { error: 'PrismaClientInitializationError', code: 'P1001' });
});

test('a known request error keeps its code', () => {
  const error = new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict', { code: 'P2034', clientVersion: '6.19.3' });
  assert.deepEqual(describeFault(error), { error: 'PrismaClientKnownRequestError', code: 'P2034' });
});

test('a plain error gives its name only, and the message never appears', () => {
  const described = describeFault(new TypeError('fetch failed for https://example.com/private?token=secret'));
  assert.deepEqual(described, { error: 'TypeError' });
  assert.doesNotMatch(JSON.stringify(described), /secret|example\.com/);
});

test('a non-error throw is reported as unknown', () => {
  assert.deepEqual(describeFault('boom'), { error: 'unknown' });
  assert.deepEqual(describeFault(null), { error: 'unknown' });
});
