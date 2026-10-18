import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Beta booking's list lives on SiteSettings in all three schemas, with a
// migration in each folder (CLAUDE.md: every schema change needs all three).
const PROVIDERS = ['vercel', 'dev', 'prod'] as const;
const MIGRATION = '20261018120000_booking_beta_emails';
const block = (schema: string, model: string) => {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${model} missing`);
  return match[0];
};

for (const provider of PROVIDERS) {
  test(`${provider} schema has SiteSettings.bookingBetaEmails, an empty list by default`, () => {
    const schema = readFileSync(`prisma/${provider}/schema.prisma`, 'utf8');
    assert.match(block(schema, 'SiteSettings'), /\n\s+bookingBetaEmails\s+String\s+@default\(""\)/);
  });
  test(`${provider} has the beta list migration, adding the column with an empty default`, () => {
    const file = `prisma/${provider}/migrations/${MIGRATION}/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    assert.match(sql, /SiteSettings/);
    assert.match(sql, /bookingBetaEmails/);
    assert.match(sql, /NOT NULL/);
    assert.match(sql, /DEFAULT ''/);
  });
}
