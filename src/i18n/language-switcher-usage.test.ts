import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The switcher sets its own `inline-flex`, and in the generated CSS that beats
// a `hidden` passed through className. The header once did exactly that
// (`className="hidden xl:inline-flex"`), so the desktop switcher also showed on
// phones and made every public page 24–79px wider than the screen. Hide it
// with a wrapper element instead.

const root = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

test('no LanguageSwitcher is hidden through its className', () => {
  const offenders = sources(root).flatMap((path) => {
    const uses = readFileSync(path, 'utf8').match(/<LanguageSwitcher\b[^>]*>/g) ?? [];
    return uses.filter((use) => /className=[^>]*\bhidden\b/.test(use)).map((use) => `${path}: ${use}`);
  });
  assert.deepEqual(offenders, []);
});

test('the scan actually finds the switcher call sites', () => {
  const count = sources(root).reduce((n, path) => n + (readFileSync(path, 'utf8').match(/<LanguageSwitcher\b/g) ?? []).length, 0);
  assert.ok(count >= 4, `expected the header, menu, admin and kiosk switchers, found ${count}`);
});
