import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const PROVIDERS = ['vercel', 'dev', 'prod'] as const;
const block = (schema: string, model: string) => {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${model} missing`);
  return match[0];
};

for (const provider of PROVIDERS) {
  test(`${provider} schema has the late-arrival columns, all nullable`, () => {
    const schema = readFileSync(`prisma/${provider}/schema.prisma`, 'utf8');
    assert.match(block(schema, 'Appointment'), /\n\s+arrivedAt\s+DateTime\?/);
    assert.match(block(schema, 'Appointment'), /\n\s+lateCancelledAt\s+DateTime\?/);
    assert.match(block(schema, 'SiteSettings'), /\n\s+lateAutoCancelSince\s+DateTime\?/);
  });
  test(`${provider} has the late-arrival migration`, () => {
    const file = `prisma/${provider}/migrations/20261016120000_late_arrival_auto_cancel/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    for (const column of ['arrivedAt', 'lateCancelledAt', 'lateAutoCancelSince']) assert.match(sql, new RegExp(column));
  });
}
