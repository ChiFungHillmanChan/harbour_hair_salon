import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONS_MESSAGES, operationsMessageKey } from './operations-messages';
import { translator } from '@/i18n/messages';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const code = sources('src/app').filter((file) => !file.endsWith('operations-messages.ts')).map((file) => readFileSync(file, 'utf8')).join('\n');

test('every catalogued message is still written somewhere', () => {
  for (const [key, message] of Object.entries(OPERATIONS_MESSAGES)) {
    assert.ok(code.includes(`'${message}'`) || code.includes(`OPERATIONS_MESSAGES.${key}`), `${key} is no longer written by any job`);
  }
});

test('every fixed lastError sentence a job writes is catalogued (so Operations can translate it)', () => {
  const known = new Set<string>(Object.values(OPERATIONS_MESSAGES));
  const written = [...code.matchAll(/lastError: (?:[^'\n]*\? )?'([^']+)'(?: : '([^']+)')?/g)].flatMap((m) => [m[1], m[2]]).filter((m): m is string => Boolean(m));
  assert.ok(written.length >= 5, 'the scan found the writers');
  for (const message of written) assert.ok(known.has(message), `uncatalogued lastError: ${message}`);
});

test('recognised sentences map to a key with copy in both languages; anything else stays raw', () => {
  assert.equal(operationsMessageKey(OPERATIONS_MESSAGES.RETRY_WINDOW_EXPIRED), 'RETRY_WINDOW_EXPIRED');
  assert.equal(operationsMessageKey('ECONNRESET from feed host'), null);
  assert.equal(operationsMessageKey(null), null);
  for (const key of Object.keys(OPERATIONS_MESSAGES)) {
    for (const locale of ['en-GB', 'zh-HK'] as const) {
      const text = translator(locale, 'adminOps')(`operations.messages.${key}` as never);
      assert.ok(text && !text.startsWith('operations.messages.'), `${locale} ${key}`);
    }
  }
});
