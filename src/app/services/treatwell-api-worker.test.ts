import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPendingTreatwellBookings } from './treatwell-api-worker';

test('unsupported Treatwell API worker refuses before reading the queue or sending a stale command', async () => {
  let reads = 0;
  let sends = 0;
  const db = { appointment: { findMany: async () => { reads++; return []; }, update: async () => { throw new Error('must not mutate'); } } };
  const adapter = {
    ping: async () => ({ latencyMs: 0 }),
    upsertBooking: async () => { sends++; return { bookingId: 'fixture' }; },
    cancelBooking: async () => { sends++; return { bookingId: 'fixture' }; },
  };
  await assert.rejects(syncPendingTreatwellBookings(adapter, { db }), /official.*versioned|versioned.*official/i);
  assert.equal(reads, 0);
  assert.equal(sends, 0);
});
