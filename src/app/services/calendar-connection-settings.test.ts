import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { parseCalendarConnectionSettings } from './calendar-connection-settings';
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
test('blank inbound value retains masked existing secret; explicit clear removes it', () => {
  const existing = 'https://example.com/calendar?token=private';
  assert.equal(parseCalendarConnectionSettings(form({ stylistId: 's1', provider: 'FRESHA', inboundUrl: '' }), existing).inboundUrl, existing);
  assert.equal(parseCalendarConnectionSettings(form({ stylistId: 's1', provider: 'FRESHA', clearInboundUrl: 'on' }), existing).inboundUrl, null);
});
test('enabled inbound needs a valid URL and independent sales checkbox', () => {
  assert.throws(() => parseCalendarConnectionSettings(form({ stylistId: 's1', provider: 'TREATWELL', inboundEnabled: 'on' }), null));
  const parsed = parseCalendarConnectionSettings(form({ stylistId: 's1', provider: 'TREATWELL', receivesBookings: 'on', inboundEnabled: 'on', inboundUrl: 'https://example.com/a.ics' }), null);
  assert.equal(parsed.receivesBookings, true); assert.equal(parsed.inboundEnabled, true);
});
test('unknown providers and internal HTTP endpoints are rejected', () => {
  assert.throws(() => parseCalendarConnectionSettings(form({ stylistId: 's1', provider: 'UNKNOWN' }), null));
  assert.throws(() => parseCalendarConnectionSettings(form({ stylistId: 's1', provider: 'TREATWELL', inboundUrl: 'https://127.0.0.1/a' }), null));
});

import type { PrismaClient } from '@prisma/client';
import { saveCalendarConnectionSettings } from './calendar-connection-settings';

test('calendar save returns a safe validation message and preserves existing settings for private URLs', async (context) => {
  let writes = 0;
  let networkRequests = 0;
  context.mock.method(https, 'request', () => { networkRequests++; throw new Error('Unexpected network request'); });
  context.mock.method(globalThis, 'fetch', async () => { networkRequests++; throw new Error('Unexpected fetch'); });
  const db = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      calendarConnection: {
        findUnique: async () => ({ id: 'c1', inboundUrl: 'https://example.com/old?token=old-secret', inboundEnabled: false, updatedAt: new Date() }),
        updateMany: async () => { writes++; return { count: 1 }; },
      },
    }),
  } as unknown as Pick<PrismaClient, '$transaction'>;
  const result = await saveCalendarConnectionSettings(form({ stylistId: 's1', provider: 'TREATWELL', inboundUrl: 'https://127.0.0.1/private?token=new-secret' }), db);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /public HTTPS/i);
  assert.doesNotMatch(result.error ?? '', /127\.0\.0\.1|new-secret|old-secret/);
  assert.equal(writes, 0);
  assert.equal(networkRequests, 0);
});
test('calendar save returns an expected form error when inbound sync is enabled without a saved URL', async () => {
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ calendarConnection: { findUnique: async () => null } }) } as unknown as Pick<PrismaClient, '$transaction'>;
  const result = await saveCalendarConnectionSettings(form({ stylistId: 's1', provider: 'FRESHA', inboundEnabled: 'on' }), db);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Add a feed URL/i);
});
