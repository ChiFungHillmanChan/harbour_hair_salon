import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAdminMoveClashes, type MoveClash } from './admin-move-clashes';

// 2099-09-15 is inside BST, so 09:00Z is 10:00 in the salon's local frame.
const AT_10_00 = new Date('2099-09-15T09:00:00Z');

type Row = Record<string, unknown>;

/**
 * Apply the subset of Prisma `where` semantics these tests rely on, so the
 * double actually filters. A fake that ignores `where` would pass whether or not
 * the production query excludes the row being moved — which is the single most
 * important thing here.
 */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (!(key in row)) return true; // window/date filters aren't modelled
    const actual = row[key];
    if (expected && typeof expected === 'object' && 'not' in (expected as Row)) {
      return actual !== (expected as Row).not;
    }
    if (expected && typeof expected === 'object' && 'in' in (expected as Row)) {
      return ((expected as Row).in as unknown[]).includes(actual);
    }
    if (typeof expected === 'string') return actual === expected;
    return true;
  });
}

function fakeDb(options: {
  availability?: { startTime: string; endTime: string } | null;
  appointments?: Row[];
  externalBusy?: Row[];
  patchTests?: { date: Date; status: string }[];
  roster?: Row[];
  diary?: { start: Date; end: Date }[];
} = {}) {
  const calls: { availabilityWhere?: Row; appointmentWhere?: Row } = {};
  return {
    calls,
    db: {
      availability: {
        findFirst: async ({ where }: { where: Row }) => {
          calls.availabilityWhere = where;
          return options.availability === undefined
            ? { startTime: '09:00', endTime: '18:00' }
            : options.availability;
        },
        findMany: async () => options.roster ?? [],
      },
      googleDiaryEntry: { findMany: async () => options.diary ?? [] },
      appointment: {
        findMany: async ({ where }: { where: Row }) => {
          // Only the patch-test lookup filters on `service`; everything else is
          // the day-window scan for this stylist.
          if (where && typeof where === 'object' && 'service' in where) {
            return options.patchTests ?? [];
          }
          calls.appointmentWhere = where;
          return (options.appointments ?? []).filter((row) => matches(row, where));
        },
      },
      externalBusyBlock: {
        findMany: async () => options.externalBusy ?? [],
      },
    },
  };
}

const baseInput = {
  appointmentId: 'appt-moving',
  stylistId: 'stylist-1',
  start: AT_10_00,
  durationMin: 60,
  userId: 'user-1',
  requiresPatchTest: false,
};

const kinds = (clashes: MoveClash[]) => clashes.map((c) => c.kind).sort();

test('a free slot inside working hours reports no clashes', async () => {
  const { db } = fakeDb();
  assert.deepEqual(await describeAdminMoveClashes(db as never, baseInput), []);
});

test('an overlapping booking is reported with the customer and the times', async () => {
  const { db } = fakeDb({
    appointments: [{
      id: 'other', date: new Date('2099-09-15T09:30:00Z'), durationAtBooking: 60,
      status: 'CONFIRMED', user: { name: 'Mei L.' }, service: { duration: 30 },
    }],
  });

  const clashes = await describeAdminMoveClashes(db as never, baseInput);

  assert.equal(clashes.length, 1);
  const clash = clashes[0];
  assert.equal(clash.kind, 'OVERLAP');
  if (clash.kind !== 'OVERLAP') return;
  assert.equal(clash.appointmentId, 'other');
  assert.equal(clash.customerName, 'Mei L.');
  assert.equal(clash.start.toISOString(), '2099-09-15T09:30:00.000Z');
  assert.equal(clash.end.toISOString(), '2099-09-15T10:30:00.000Z', 'end uses durationAtBooking, not service.duration');
});

test('the appointment being moved is excluded from its own overlap scan', async () => {
  // Without this a 1-minute nudge would always collide with itself and every
  // drag would raise a bogus warning.
  const { db, calls } = fakeDb({
    appointments: [{
      id: 'appt-moving', date: AT_10_00, durationAtBooking: 60,
      status: 'CONFIRMED', user: { name: 'Self' }, service: { duration: 60 },
    }],
  });

  const clashes = await describeAdminMoveClashes(db as never, baseInput);

  assert.deepEqual(clashes, []);
  assert.deepEqual(
    (calls.appointmentWhere as { id?: unknown }).id,
    { not: 'appt-moving' },
    'exclusion must happen in the query, not only in memory',
  );
});

test('a cancelled booking never counts as an overlap', async () => {
  const { db, calls } = fakeDb({
    appointments: [{
      id: 'dead', date: AT_10_00, durationAtBooking: 60,
      status: 'CANCELLED', user: { name: 'Gone' }, service: { duration: 60 },
    }],
  });

  await describeAdminMoveClashes(db as never, baseInput);

  assert.deepEqual(
    (calls.appointmentWhere as { status?: unknown }).status,
    { not: 'CANCELLED' },
  );
});

test('running past closing time is reported with the stylist working hours', async () => {
  const { db } = fakeDb();
  // 16:30Z is 17:30 local; a 2-hour job would finish at 19:30, past an 18:00 close.
  const clashes = await describeAdminMoveClashes(db as never, {
    ...baseInput, start: new Date('2099-09-15T16:30:00Z'), durationMin: 120,
  });

  assert.equal(clashes.length, 1);
  const clash = clashes[0];
  assert.equal(clash.kind, 'OUTSIDE_HOURS');
  if (clash.kind !== 'OUTSIDE_HOURS') return;
  assert.deepEqual(clash.availability, { startTime: '09:00', endTime: '18:00' });
});

test('a stylist who does not work that day is reported with no hours', async () => {
  const { db } = fakeDb({ availability: null });

  const clashes = await describeAdminMoveClashes(db as never, baseInput);

  assert.equal(clashes.length, 1);
  const clash = clashes[0];
  assert.equal(clash.kind, 'OUTSIDE_HOURS');
  if (clash.kind !== 'OUTSIDE_HOURS') return;
  assert.equal(clash.availability, null);
});

test('the availability lookup asks for the salon-local weekday', async () => {
  // 2099-09-15 is a Tuesday in the salon's frame. Deriving the weekday from a
  // browser-local Date is what caused the wrong-day booking bug.
  const { db, calls } = fakeDb();
  await describeAdminMoveClashes(db as never, baseInput);
  assert.equal((calls.availabilityWhere as { dayOfWeek?: number }).dayOfWeek, 2);
  assert.equal((calls.availabilityWhere as { isOff?: boolean }).isOff, false);
});

test('a synced external busy block is reported separately from real bookings', async () => {
  const { db } = fakeDb({
    externalBusy: [{
      stylistId: 'stylist-1',
      start: new Date('2099-09-15T09:45:00Z'),
      end: new Date('2099-09-15T10:15:00Z'),
    }],
  });

  const clashes = await describeAdminMoveClashes(db as never, baseInput);

  assert.equal(clashes.length, 1);
  assert.equal(clashes[0].kind, 'EXTERNAL_BUSY');
});

test('a colour appointment moved with no patch test on file is flagged', async () => {
  const { db } = fakeDb({ patchTests: [] });

  const clashes = await describeAdminMoveClashes(db as never, {
    ...baseInput, requiresPatchTest: true,
  });

  assert.equal(clashes.length, 1);
  const clash = clashes[0];
  assert.equal(clash.kind, 'PATCH_TEST');
  if (clash.kind !== 'PATCH_TEST') return;
  assert.equal(clash.reason, 'none');
});

test('a service that needs no patch test never triggers the patch-test lookup', async () => {
  let asked = false;
  const { db } = fakeDb();
  const spied = {
    ...db,
    appointment: {
      findMany: async (args: { where: Row }) => {
        if ('service' in (args.where ?? {})) asked = true;
        return [];
      },
    },
  };

  await describeAdminMoveClashes(spied as never, baseInput);

  assert.equal(asked, false);
});

test('several independent clashes are all reported at once', async () => {
  const { db } = fakeDb({
    availability: { startTime: '09:00', endTime: '10:30' },
    appointments: [{
      id: 'other', date: new Date('2099-09-15T09:30:00Z'), durationAtBooking: 60,
      status: 'CONFIRMED', user: { name: 'Mei L.' }, service: { duration: 30 },
    }],
    externalBusy: [{
      stylistId: 'stylist-1',
      start: new Date('2099-09-15T09:45:00Z'),
      end: new Date('2099-09-15T10:15:00Z'),
    }],
  });

  const clashes = await describeAdminMoveClashes(db as never, baseInput);

  assert.deepEqual(kinds(clashes), ['EXTERNAL_BUSY', 'OUTSIDE_HOURS', 'OVERLAP']);
});

const AT_11_00 = new Date(AT_10_00.getTime() + 60 * 60_000);
const ROSTER = [
  { stylistId: 'stylist-1', dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
  { stylistId: 'stylist-2', dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
];

test('a Google walk-in left with no free stylist is a DIARY_CHAIR warning, never a refusal', async () => {
  const { db } = fakeDb({
    roster: ROSTER,
    appointments: [{ id: 'busy-2', stylistId: 'stylist-2', date: AT_10_00, durationAtBooking: 60, status: 'CONFIRMED', user: { name: 'Mei L.' }, service: { duration: 60 } }],
    diary: [{ start: AT_10_00, end: AT_11_00 }],
  });
  const clashes = await describeAdminMoveClashes(db as never, baseInput);
  assert.deepEqual(kinds(clashes), ['DIARY_CHAIR']);
  const [chair] = clashes;
  assert.ok(chair.kind === 'DIARY_CHAIR');
  assert.deepEqual([chair.needed, chair.free, chair.start.toISOString(), chair.end.toISOString()], [1, 0, AT_10_00.toISOString(), AT_11_00.toISOString()]);
});

test('moving stylist-2’s own booking to stylist-1 frees stylist-2 for the walk-in: no warning', async () => {
  const { db } = fakeDb({
    roster: ROSTER,
    appointments: [{ id: 'busy-2', stylistId: 'stylist-2', date: AT_10_00, durationAtBooking: 60, status: 'CONFIRMED', user: { name: 'Mei L.' }, service: { duration: 60 } }],
    diary: [{ start: AT_10_00, end: AT_11_00 }],
  });
  assert.deepEqual(await describeAdminMoveClashes(db as never, { ...baseInput, appointmentId: 'busy-2' }), []);
});
