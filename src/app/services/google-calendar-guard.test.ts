import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const { guardGoogleCalendarChange } = loadServerModule<typeof import('./google-calendar-guard')>('src/app/services/google-calendar-guard.ts', {});
const PRIMARY = 'harbourhairuk@gmail.com';

type State = { calendarId: string | null; channelId: string | null; resourceId: string | null; channelExpiresAt: Date | null; busyHash: string | null };
function fakeDb(state: State | null, rows = 3) {
  const log: string[] = [];
  const store = { state: state ? { ...state } : null, rows };
  const client = {
    googleCalendarSyncState: {
      findUnique: async () => { log.push('read'); return store.state ? { calendarId: store.state.calendarId } : null; },
      updateMany: async ({ where, data }: { where: { OR: ({ calendarId: null } | { calendarId: { not: string } })[] }; data: Partial<State> }) => {
        const current = store.state?.calendarId ?? null;
        const differs = where.OR.some((branch) => branch.calendarId === null ? current === null : current !== null && current !== (branch.calendarId as { not: string }).not);
        if (!store.state || !differs) return { count: 0 };
        Object.assign(store.state, data);
        log.push('reset');
        return { count: 1 };
      },
      upsert: async ({ create }: { create: Partial<State> }) => { store.state = { channelId: null, resourceId: null, channelExpiresAt: null, busyHash: null, calendarId: null, ...create }; log.push('create'); },
    },
    googleCalendarEvent: { deleteMany: async () => { log.push('delete-rows'); const count = store.rows; store.rows = 0; return { count }; } },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => { log.push('tx'); return fn(client); },
  };
  return { client, log, store };
}
const channel = { channelId: 'ch', resourceId: 'res', channelExpiresAt: new Date('2026-10-20T00:00:00Z'), busyHash: 'h' };

test('the same calendar: one read, nothing else', async () => {
  const f = fakeDb({ calendarId: PRIMARY, ...channel });
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'same');
  assert.deepEqual(f.log, ['read']);
  assert.equal(f.store.rows, 3);
});

test('another calendar configured: the event rows and the channel are cleared, the new id recorded', async () => {
  const f = fakeDb({ calendarId: 'old@group.calendar.google.com', ...channel });
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'switched');
  assert.deepEqual(f.log, ['read', 'tx', 'reset', 'delete-rows']);
  assert.deepEqual(f.store.state, { calendarId: PRIMARY, channelId: null, resourceId: null, channelExpiresAt: null, busyHash: 'h' });
  assert.equal(f.store.rows, 0);
});

test('no calendar recorded yet (the first run after this shipped) counts as a change', async () => {
  const f = fakeDb({ calendarId: null, ...channel });
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'switched');
  assert.equal(f.store.rows, 0);
});

test('no state row at all: it is created with the id; rows are cleared', async () => {
  const f = fakeDb(null);
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'switched');
  assert.equal(f.store.state?.calendarId, PRIMARY);
  assert.equal(f.store.rows, 0);
});

test('a racing caller already switched: the second clears nothing', async () => {
  const f = fakeDb({ calendarId: 'old@group.calendar.google.com', ...channel });
  // Both read "old" before either wrote.
  const first = guardGoogleCalendarChange(f.client as never, PRIMARY);
  const second = guardGoogleCalendarChange(f.client as never, PRIMARY);
  assert.deepEqual((await Promise.all([first, second])).sort(), ['same', 'switched']);
  assert.equal(f.log.filter((entry) => entry === 'delete-rows').length, 1);
});
