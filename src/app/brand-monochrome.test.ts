import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The brand is monochrome black/white/grey (client requirement, July 2026).
// The retired blue and gold kept creeping back through copied class names and
// the confirmation email, so any of their hex codes in source fails the suite.
const RETIRED = /#(174F7F|123F66|123E64|103653|D8E7F2|D8B36A)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test('no retired brand colour (old blue / gold) remains in src', () => {
  const offenders = sourceFiles('src').filter((file) => RETIRED.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});
