import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESHA_MIRROR_PROPERTY, freshaMirrorEventId, reconcileFreshaMirror, renderFreshaMirrorEvent, type FreshaMirrorGateway } from './fresha-mirror';
import { GoogleCalendarError, type GoogleEvent } from './google-calendar-gateway';

const NOW = new Date('2026-11-02T09:00:00Z');
const WINDOW_END = new Date('2027-01-31T09:00:00Z');
const CONNECTION = { id: 'conn-funky', stylistName: '  Funky   K ', googleColorId: '5' };
const BOOKING = { uid: 'fresha-1', start: new Date('2026-11-02T11:00:00Z'), end: new Date('2026-11-02T12:00:00Z'), summary: 'Fresha Appointment' };
const BLOCK = { uid: 'fresha-2', start: new Date('2026-11-03T13:00:00Z'), end: new Date('2026-11-03T14:00:00Z'), summary: 'Fresha Blocked Time' };

function fakeGateway(listed: GoogleEvent[] = [], options: { insertConflict?: boolean } = {}) {
  const calls: string[] = [];
  const gateway: FreshaMirrorGateway = {
    listEvents: async () => listed,
    putEvent: async (event) => { calls.push(`put ${event.id}`); return event; },
    insertEvent: async (event) => {
      if (options.insertConflict) throw new GoogleCalendarError('conflict', 409);
      calls.push(`insert ${event.id}`);
      return event;
    },
    deleteEvent: async (id) => { calls.push(`delete ${id}`); },
  };
  return { gateway, calls };
}

const run = (gateway: FreshaMirrorGateway, intervals = [BOOKING, BLOCK], extra: { deadline?: number; clock?: () => number } = {}) =>
  reconcileFreshaMirror({ gateway, connection: CONNECTION, intervals, locale: 'en-GB', now: NOW, windowEnd: WINDOW_END, deadline: extra.deadline ?? Infinity, clock: extra.clock });

test('mirror ids are stable, per connection, and valid Google ids', () => {
  const id = freshaMirrorEventId('conn-funky', 'fresha-1');
  assert.match(id, /^hf[0-9a-f]{40}$/);
  assert.equal(freshaMirrorEventId('conn-funky', 'fresha-1'), id);
  assert.notEqual(freshaMirrorEventId('conn-ivan', 'fresha-1'), id);
});

test('a copy says whose time it is and what kind, in the salon\'s language, and carries the marker', () => {
  const event = renderFreshaMirrorEvent(CONNECTION, BOOKING, 'en-GB');
  assert.equal(event.summary, 'Funky K · Fresha booking');
  assert.equal(event.colorId, '5');
  assert.equal(event.transparency, 'opaque');
  assert.equal(Date.parse(event.start?.dateTime ?? ''), BOOKING.start.getTime());
  assert.equal(event.start?.timeZone, 'Europe/London');
  assert.equal(event.extendedProperties?.private?.[FRESHA_MIRROR_PROPERTY], 'conn-funky');
  assert.equal(renderFreshaMirrorEvent(CONNECTION, BLOCK, 'zh-HK').summary, 'Funky K · Fresha 封鎖時間');
  assert.equal(renderFreshaMirrorEvent({ ...CONNECTION, googleColorId: null }, { ...BOOKING, summary: undefined }, 'en-GB').summary, 'Funky K · Fresha busy');
  assert.equal(renderFreshaMirrorEvent({ ...CONNECTION, googleColorId: null }, BOOKING, 'en-GB').colorId, undefined);
});

test('an empty mirror gets every busy time', async () => {
  const { gateway, calls } = fakeGateway();
  assert.deepEqual(await run(gateway), { written: 2, deleted: 0, unchanged: 0, complete: true });
  assert.deepEqual(calls, [`insert ${freshaMirrorEventId('conn-funky', 'fresha-1')}`, `insert ${freshaMirrorEventId('conn-funky', 'fresha-2')}`]);
});

test('unchanged copies are left alone; a moved one is rewritten; a vanished future one is deleted', async () => {
  const kept = renderFreshaMirrorEvent(CONNECTION, BOOKING, 'en-GB');
  const moved = { ...renderFreshaMirrorEvent(CONNECTION, BLOCK, 'en-GB'), start: { dateTime: '2026-11-03T12:00:00+00:00', timeZone: 'Europe/London' } };
  const vanished = renderFreshaMirrorEvent(CONNECTION, { ...BOOKING, uid: 'fresha-gone' }, 'en-GB');
  const otherStylist = renderFreshaMirrorEvent({ ...CONNECTION, id: 'conn-ivan' }, { ...BOOKING, uid: 'ivan-1' }, 'en-GB');
  const salonOwn: GoogleEvent = { id: 'abc123', summary: 'Lunch' };
  const { gateway, calls } = fakeGateway([kept, moved, vanished, otherStylist, salonOwn]);
  assert.deepEqual(await run(gateway), { written: 1, deleted: 1, unchanged: 1, complete: true });
  assert.deepEqual(calls, [`put ${moved.id}`, `delete ${vanished.id}`]);
});

test('a copy deleted or edited in Google is written back; its marker stripped too', async () => {
  const deleted: GoogleEvent = { id: freshaMirrorEventId('conn-funky', 'fresha-1'), status: 'cancelled' };
  const stripped = { ...renderFreshaMirrorEvent(CONNECTION, BLOCK, 'en-GB'), extendedProperties: undefined };
  const { gateway, calls } = fakeGateway([deleted, stripped]);
  assert.equal((await run(gateway)).written, 2);
  assert.deepEqual(calls, [`put ${deleted.id}`, `put ${stripped.id}`]);
});

test('an id Google already holds outside the window is written in place', async () => {
  const { gateway, calls } = fakeGateway([], { insertConflict: true });
  await run(gateway, [BOOKING]);
  assert.deepEqual(calls, [`put ${freshaMirrorEventId('conn-funky', 'fresha-1')}`]);
});

test('other Google errors are thrown for the caller', async () => {
  const { gateway } = fakeGateway();
  gateway.insertEvent = async () => { throw new GoogleCalendarError('auth', 403); };
  await assert.rejects(run(gateway, [BOOKING]), (error: unknown) => error instanceof GoogleCalendarError && error.kind === 'auth');
});

test('past the deadline no write starts and the run reports itself incomplete', async () => {
  const { gateway, calls } = fakeGateway();
  let now = 0;
  const result = await run(gateway, [BOOKING, BLOCK], { deadline: 0, clock: () => now++ });
  assert.deepEqual(result, { written: 1, deleted: 0, unchanged: 0, complete: false });
  assert.equal(calls.length, 1);
});
