import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// site-settings-service.ts imports 'server-only' and prisma, so it cannot be
// imported into a plain unit test. The safety property that matters here is a
// static one — that every layer defaults online booking to CLOSED — so assert
// it against the source and schema text directly.
//
// This guards the single most dangerous regression in this feature: flipping
// any of these defaults to `true` would silently open online booking on a fresh
// environment (or whenever settings fail to load), which risks double-booking
// against Treatwell.

const root = join(process.cwd(), 'src');

test('the settings DEFAULTS fall back to booking CLOSED', () => {
  const source = readFileSync(join(root, 'app/services/site-settings-service.ts'), 'utf8');
  assert.match(
    source,
    /bookingEnabled:\s*false/,
    'DEFAULTS.bookingEnabled must be false so an unreadable settings row fails closed',
  );
  assert.doesNotMatch(source, /bookingEnabled:\s*true/);
});

test('every Prisma schema defaults bookingEnabled to false', () => {
  for (const env of ['dev', 'vercel', 'prod']) {
    const schema = readFileSync(join(process.cwd(), 'prisma', env, 'schema.prisma'), 'utf8');
    assert.match(
      schema,
      /bookingEnabled\s+Boolean\s+@default\(false\)/,
      `${env} schema must default bookingEnabled to false`,
    );
  }
});

test('the migration adds the column defaulting to false', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/vercel/migrations/20260725180000_add_booking_enabled_setting/migration.sql'),
    'utf8',
  );
  assert.match(sql, /ADD COLUMN\s+"bookingEnabled"\s+BOOLEAN NOT NULL DEFAULT false/i);
});

test('all five booking entry points gate on isBookingEnabled', () => {
  const actions = readFileSync(join(root, 'app/actions/booking.ts'), 'utf8');
  const guards = actions.match(/if \(!\(await isBookingEnabled\(\)\)\)/g) ?? [];
  assert.equal(
    guards.length,
    5,
    'getAvailableSlotsAction, fetchSlots, fetchBookingDays, submitBooking and rescheduleAppointment must each gate',
  );
  // The old compile-time constant must be fully gone from the gating path.
  assert.doesNotMatch(actions, /if \(BOOKING_MAINTENANCE\)/);
});

test('cancellation is NOT gated by the booking switch', () => {
  const actions = readFileSync(join(root, 'app/actions/booking.ts'), 'utf8');
  const cancelStart = actions.indexOf('export async function cancelAppointment');
  assert.ok(cancelStart > -1, 'cancelAppointment must exist');
  const nextExport = actions.indexOf('export async function', cancelStart + 1);
  const body = actions.slice(cancelStart, nextExport === -1 ? undefined : nextExport);
  assert.doesNotMatch(
    body,
    /isBookingEnabled/,
    'customers must always be able to cancel, even while booking is closed',
  );
});
