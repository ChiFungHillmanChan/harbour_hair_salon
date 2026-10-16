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
  test(`${provider} schema has the consultation-credit fields (spec §2.1), all optional`, () => {
    const appointment = block(readFileSync(`prisma/${provider}/schema.prisma`, 'utf8'), 'Appointment');
    assert.match(appointment, /\n\s+consultationCreditFromId\s+String\?/);
    assert.match(appointment, /\n\s+consultationCreditPence\s+Int\?/);
    assert.match(appointment, /\n\s+consultationCreditUsedBy\s+Appointment\[\]\s+@relation\("ConsultationCredit"\)/);
    // SQL Server refuses cascading actions on a self-relation; the three schemas stay identical.
    assert.match(
      appointment,
      /\n\s+consultationCreditFrom\s+Appointment\?\s+@relation\("ConsultationCredit", fields: \[consultationCreditFromId\], references: \[id\], onDelete: NoAction, onUpdate: NoAction\)/,
    );
    assert.match(appointment, /@@index\(\[consultationCreditFromId\]\)/);
  });

  test(`${provider} has the consultation-credit migration`, () => {
    const file = `prisma/${provider}/migrations/20261016140000_consultation_credit/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    for (const column of ['consultationCreditFromId', 'consultationCreditPence']) assert.match(sql, new RegExp(column));
    assert.match(sql, /CREATE (NONCLUSTERED )?INDEX/);
    assert.match(sql, /FOREIGN KEY/);
  });
}
