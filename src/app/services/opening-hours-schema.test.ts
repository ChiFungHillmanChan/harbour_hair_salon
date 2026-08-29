import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Opening Hours editor upserts one Availability row per (stylist, weekday).
// Without a UNIQUE key that upsert cannot target a row, and duplicates become
// possible — `getAvailableSlots` uses `findFirst`, so a duplicate would make
// the hours the site sells depend on row order. Lock the constraint in every
// schema and in the migration.

test('every Prisma schema makes (stylistId, dayOfWeek) unique', () => {
  for (const env of ['dev', 'vercel', 'prod']) {
    const schema = readFileSync(join(process.cwd(), 'prisma', env, 'schema.prisma'), 'utf8');
    assert.match(
      schema,
      /@@unique\(\[stylistId,\s*dayOfWeek\]\)/,
      `${env} schema must make (stylistId, dayOfWeek) unique`,
    );
  }
});

test('the migration creates the unique index', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/vercel/migrations/20260829210000_availability_unique_stylist_day/migration.sql'),
    'utf8',
  );
  assert.match(sql, /CREATE UNIQUE INDEX/i);
  assert.match(sql, /"stylistId",\s*"dayOfWeek"/);
});

// The action writes the hours the public booking engine sells from, so the two
// properties that must never regress are: only an admin can call it, and no
// week reaches the database unvalidated.
test('the opening-hours action is admin-gated and validates before writing', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/actions/admin-availability.ts'), 'utf8');

  const authIndex = source.indexOf('await requireAdmin()');
  const validateIndex = source.indexOf('validateWeek(');
  const writeIndex = source.search(/prisma\.\$transaction|prisma\.availability\.upsert/);

  assert.ok(authIndex > -1, 'must call requireAdmin()');
  assert.ok(validateIndex > -1, 'must call validateWeek()');
  assert.ok(writeIndex > -1, 'must write availability');
  assert.ok(authIndex < writeIndex, 'requireAdmin() must run before the write');
  assert.ok(validateIndex < writeIndex, 'validateWeek() must run before the write');
});
