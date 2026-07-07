import test from 'node:test';
import assert from 'node:assert/strict';
import { toBookedInterval, toSlotAppointment, loadExternalBusy } from './external-busy';

const row = {
  stylistId: 's1',
  start: new Date('2026-07-01T09:00:00Z'),
  end: new Date('2026-07-01T09:45:00Z'),
};

test('toBookedInterval converts end→durationMin', () => {
  assert.deepEqual(toBookedInterval(row), {
    start: new Date('2026-07-01T09:00:00Z'),
    durationMin: 45,
  });
});

test('toSlotAppointment shapes a pseudo-appointment', () => {
  assert.deepEqual(toSlotAppointment(row), {
    date: new Date('2026-07-01T09:00:00Z'),
    service: { duration: 45 },
  });
});

test('loadExternalBusy queries the overlap window and passes rows through', async () => {
  const calls: { where: unknown }[] = [];
  const fakeDb = {
    externalBusyBlock: {
      findMany: async (args: { where: unknown; select: unknown }) => {
        calls.push(args);
        return [row];
      },
    },
  };
  const window = {
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-07-01T23:59:59Z'),
  };
  const out = await loadExternalBusy(fakeDb as never, ['s1'], window);
  assert.equal(out.length, 1);
  assert.equal(out[0].stylistId, 's1');
  assert.deepEqual(calls[0].where, {
    stylistId: { in: ['s1'] },
    start: { lte: window.end },
    end: { gte: window.start },
  });
});

test('loadExternalBusy short-circuits on empty stylist list (no query)', async () => {
  let called = false;
  const fakeDb = {
    externalBusyBlock: {
      findMany: async () => {
        called = true;
        return [];
      },
    },
  };
  const out = await loadExternalBusy(fakeDb as never, [], {
    start: new Date('2026-07-01T00:00:00Z'),
    end: new Date('2026-07-01T23:59:59Z'),
  });
  assert.deepEqual(out, []);
  assert.equal(called, false);
});
