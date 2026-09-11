import test from 'node:test';
import assert from 'node:assert/strict';
import { syncTreatwellFeeds } from './treatwell-sync-service';

test('legacy Treatwell entry point uses new calendar connections and limits the provider', async () => {
  let query: unknown;
  const db = { calendarConnection: { findMany: async (args: unknown) => { query = args; return []; } } };
  assert.deepEqual(await syncTreatwellFeeds({ db: db as never, fetchFeed: async () => { throw new Error('must not fetch'); } }), []);
  assert.equal((query as { where: { provider: string } }).where.provider, 'TREATWELL');
});
