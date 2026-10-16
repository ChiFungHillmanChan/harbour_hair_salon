import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { retryOnSerializationFailure, serializableRetryDelayMs, SERIALIZABLE_MAX_ATTEMPTS } from './serializable-retry';

const conflict = () => new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock', { code: 'P2034', clientVersion: '6.19.3' });

test('a serialization failure is retried after a growing, jittered wait', async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await retryOnSerializationFailure(async () => {
    calls += 1;
    if (calls < 4) throw conflict();
    return 'booked';
  }, { sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
  assert.equal(result, 'booked');
  assert.equal(calls, 4);
  assert.deepEqual(waits, [25, 50, 100]);
});

test('the wait is spread between half and one and a half times the step', () => {
  assert.equal(serializableRetryDelayMs(1, () => 0), 13);
  assert.equal(serializableRetryDelayMs(1, () => 0.999), 37);
  assert.equal(serializableRetryDelayMs(3, () => 0), 50);
  assert.equal(serializableRetryDelayMs(3, () => 0.999), 150);
});

test('it gives up after the last attempt and rethrows the conflict', async () => {
  let calls = 0;
  await assert.rejects(
    retryOnSerializationFailure(async () => { calls += 1; throw conflict(); }, { sleep: async () => {} }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034',
  );
  assert.equal(calls, SERIALIZABLE_MAX_ATTEMPTS);
});

test('any other error is thrown at once, without waiting', async () => {
  let calls = 0;
  let waited = false;
  await assert.rejects(
    retryOnSerializationFailure(async () => { calls += 1; throw new Error('slot taken'); }, { sleep: async () => { waited = true; } }),
    /slot taken/,
  );
  assert.equal(calls, 1);
  assert.equal(waited, false);
});

test('a unique-constraint failure is not a serialization failure', async () => {
  let calls = 0;
  const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' });
  await assert.rejects(retryOnSerializationFailure(async () => { calls += 1; throw duplicate; }, { sleep: async () => {} }));
  assert.equal(calls, 1);
});
