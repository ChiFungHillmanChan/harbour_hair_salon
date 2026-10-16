import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const PROVIDERS = ['vercel', 'dev', 'prod'] as const;
const MIGRATION = '20261016150000_google_calendar_sync';
const block = (schema: string, model: string) => {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${model} missing`);
  return match[0];
};
const field = (name: string, type: string) => new RegExp(`\\n\\s+${name}\\s+${type.replace(/[?[\]]/g, '\\$&')}(\\s|$)`);

for (const provider of PROVIDERS) {
  test(`${provider} schema has GoogleCalendarEvent as in spec §4`, () => {
    const model = block(readFileSync(`prisma/${provider}/schema.prisma`, 'utf8'), 'GoogleCalendarEvent');
    assert.match(model, /\n\s+appointmentId\s+String\s+@id/);
    assert.match(model, /\n\s+appointment\s+Appointment\s+@relation\(fields: \[appointmentId\], references: \[id\], onDelete: Cascade\)/);
    assert.match(model, /\n\s+eventId\s+String\s+@unique/);
    assert.match(model, field('syncedHash', 'String?'));
    assert.match(model, field('syncedAt', 'DateTime?'));
    assert.match(model, /\n\s+removed\s+Boolean\s+@default\(false\)/);
    assert.match(model, /\n\s+attempts\s+Int\s+@default\(0\)/);
    assert.match(model, field('lastError', 'String?'));
    assert.match(model, /\n\s+updatedAt\s+DateTime\s+@updatedAt/);
  });

  test(`${provider} schema has the GoogleCalendarSyncState singleton as in spec §4`, () => {
    const model = block(readFileSync(`prisma/${provider}/schema.prisma`, 'utf8'), 'GoogleCalendarSyncState');
    assert.match(model, /\n\s+id\s+String\s+@id @default\("singleton"\)/);
    for (const name of ['channelId', 'resourceId', 'lastPullError', 'busyHash']) assert.match(model, field(name, 'String?'), name);
    for (const name of ['channelExpiresAt', 'lastPullAt', 'lastPullSuccessAt']) assert.match(model, field(name, 'DateTime?'), name);
  });

  test(`${provider} Appointment has the optional googleCalendarEvent back-relation`, () => {
    const model = block(readFileSync(`prisma/${provider}/schema.prisma`, 'utf8'), 'Appointment');
    assert.match(model, field('googleCalendarEvent', 'GoogleCalendarEvent?'));
  });

  test(`${provider} has the Google Calendar sync migration`, () => {
    const file = `prisma/${provider}/migrations/${MIGRATION}/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    for (const table of ['GoogleCalendarEvent', 'GoogleCalendarSyncState']) assert.match(sql, new RegExp(`CREATE TABLE \\S*${table}`));
    assert.match(sql, /GoogleCalendarEvent_eventId_key/);
    assert.match(sql, /ON DELETE CASCADE/);
  });
}

// SQL Server parity: an error sentence can be longer than NVARCHAR(1000), like every other lastError there.
test('prod (SQL Server) stores the Google error sentences as NVARCHAR(MAX), in the schema and its migration', () => {
  const schema = readFileSync('prisma/prod/schema.prisma', 'utf8');
  assert.match(block(schema, 'GoogleCalendarEvent'), /\n\s+lastError\s+String\?\s+@db\.NVarChar\(Max\)/);
  assert.match(block(schema, 'GoogleCalendarSyncState'), /\n\s+lastPullError\s+String\?\s+@db\.NVarChar\(Max\)/);
  const sql = readFileSync(`prisma/prod/migrations/${MIGRATION}/migration.sql`, 'utf8');
  assert.match(sql, /\[lastError\] NVARCHAR\(MAX\),/);
  assert.match(sql, /\[lastPullError\] NVARCHAR\(MAX\),/);
});
