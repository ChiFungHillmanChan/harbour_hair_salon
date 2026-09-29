import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Next's compiler refuses a 'use server' module that exports anything but async
// functions ("Only async functions are allowed to be exported"), and only
// `next build` notices — tsc, eslint and these tests do not. A value export
// here therefore passes every local check and then fails the deploy.
const actions = join(process.cwd(), 'src/app/actions');

test("'use server' action files export only async functions and types", () => {
  const offenders = readdirSync(actions)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => {
      const source = readFileSync(join(actions, file), 'utf8');
      if (!/^\s*['"]use server['"]/.test(source)) return [];
      return [...source.matchAll(/^export\s+(?:const|let|var|class|enum|function\s)[^\n]*/gm)].map((match) => `${file}: ${match[0]}`);
    });
  assert.deepEqual(offenders, []);
});
