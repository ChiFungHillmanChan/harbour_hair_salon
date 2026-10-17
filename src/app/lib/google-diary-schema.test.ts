import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Google diary mirror (spec §3, §7): the fields and table in all three schemas,
// and one migration per provider.
const PROVIDERS = ['vercel', 'dev', 'prod'] as const;
const MIGRATION = '20261017120000_google_diary_mirror';
const block = (schema: string, model: string) => {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${model} missing`);
  return match[0];
};
const field = (name: string, type: string) => new RegExp(`\\n\\s+${name}\\s+${type.replace(/[?[\]]/g, '\\$&')}(\\s|$)`);

for (const provider of PROVIDERS) {
  const schema = () => readFileSync(`prisma/${provider}/schema.prisma`, 'utf8');

  test(`${provider}: Stylist has googleColorId and googleAliases`, () => {
    const model = block(schema(), 'Stylist');
    assert.match(model, field('googleColorId', 'String?'));
    assert.match(model, field('googleAliases', 'String?'));
  });

  test(`${provider}: SiteSettings has the diary colours with Tomato and Graphite defaults`, () => {
    const model = block(schema(), 'SiteSettings');
    assert.match(model, /\n\s+googleUnassignedColorId\s+String\s+@default\("11"\)/);
    assert.match(model, /\n\s+googleLeaveColorId\s+String\s+@default\("8"\)/);
  });

  test(`${provider}: GoogleCalendarSyncState records the calendar its rows belong to`, () => {
    assert.match(block(schema(), 'GoogleCalendarSyncState'), field('calendarId', 'String?'));
  });

  test(`${provider}: GoogleDiaryEntry as in spec §7, without a blocks column`, () => {
    const model = block(schema(), 'GoogleDiaryEntry');
    assert.match(model, /\n\s+id\s+String\s+@id @default\(cuid\(\)\)/);
    assert.match(model, /\n\s+googleEventId\s+String\s+@unique/);
    assert.match(model, field('kind', 'String'));
    assert.match(model, /\n\s+stylistIdsJson\s+String\s+@default\("\[\]"\)/);
    assert.match(model, field('title', 'String'));
    assert.match(model, field('colorId', 'String?'));
    assert.match(model, field('start', 'DateTime'));
    assert.match(model, field('end', 'DateTime'));
    assert.match(model, /\n\s+allDay\s+Boolean\s+@default\(false\)/);
    assert.match(model, field('htmlLink', 'String?'));
    assert.match(model, /\n\s+lastSyncAt\s+DateTime\s+@default\(now\(\)\)/);
    assert.doesNotMatch(model, /\n\s+blocks\s/);
    assert.match(model, /@@index\(\[kind, start\]\)/);
    assert.match(model, /@@index\(\[end\]\)/);
  });

  test(`${provider}: the migration adds every field, the table and its indexes`, () => {
    const file = `prisma/${provider}/migrations/${MIGRATION}/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    for (const name of ['googleColorId', 'googleAliases', 'googleUnassignedColorId', 'googleLeaveColorId', 'calendarId']) assert.match(sql, new RegExp(name), name);
    assert.match(sql, /CREATE TABLE \S*GoogleDiaryEntry/);
    for (const name of ['GoogleDiaryEntry_googleEventId_key', 'GoogleDiaryEntry_kind_start_idx', 'GoogleDiaryEntry_end_idx']) assert.match(sql, new RegExp(name), name);
    assert.match(sql, /DEFAULT '11'/);
    assert.match(sql, /DEFAULT '8'/);
  });
}

test('prod (SQL Server) wraps the migration in the TRY/TRAN frame its siblings use', () => {
  const sql = readFileSync(`prisma/prod/migrations/${MIGRATION}/migration.sql`, 'utf8');
  assert.match(sql, /^BEGIN TRY\s+BEGIN TRAN;/);
  assert.match(sql, /COMMIT TRAN;\s+END TRY\s+BEGIN CATCH/);
});

// Who counts as a chair for red walk-ins (owner, 2026-10-17): on by default, so
// every existing stylist keeps counting until Admin unticks them.
for (const provider of PROVIDERS) {
  test(`${provider}: Stylist.takesWalkIns defaults to true, added by its own migration`, () => {
    assert.match(block(readFileSync(`prisma/${provider}/schema.prisma`, 'utf8'), 'Stylist'), /\n\s+takesWalkIns\s+Boolean\s+@default\(true\)/);
    const file = `prisma/${provider}/migrations/20261017150000_stylist_takes_walk_ins/migration.sql`;
    assert.ok(existsSync(file), file);
    assert.match(readFileSync(file, 'utf8'), provider === 'prod' ? /\[takesWalkIns\] BIT NOT NULL .*DEFAULT 1/ : /"takesWalkIns" BOOLEAN NOT NULL DEFAULT true/);
  });
}
