import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeSeedTarget } from '../../../prisma/seed-safety';

const repository = process.cwd();
test('destructive seed requires explicit opt-in and refuses remote and production targets even with it', () => {
  assert.throws(() => assertSafeSeedTarget({ DATABASE_URL: 'file:./dev.db' }, repository), /opt.in/i);
  for (const env of [
    { POSTGRES_URL: 'postgresql://example.invalid/salon_test' },
    { POSTGRES_URL: 'postgresql://localhost/salon' },
    { POSTGRES_URL: 'postgresql://localhost/salon_test', NODE_ENV: 'production' },
    { POSTGRES_URL: 'postgresql://localhost/salon_test', VERCEL: '1' },
    { DATABASE_URL: 'file:/Users/somebody/production.db' },
    { DATABASE_URL: 'file://example.invalid/dev.db' },
    { DATABASE_URL: 'file:./production.db' },
  ] as const) assert.throws(() => assertSafeSeedTarget({ ...env, SALON_ALLOW_DESTRUCTIVE_SEED: 'true' }, repository), /seed|disposable/i);
});

test('destructive seed accepts only named disposable local PostgreSQL and dev SQLite targets', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `postgresql://${host}:5432/salon_test`;
    assert.equal(assertSafeSeedTarget({ POSTGRES_URL: url, SALON_ALLOW_DESTRUCTIVE_SEED: 'true' }, repository), url);
  }
  const sqlite = assertSafeSeedTarget({ DATABASE_URL: 'file:./dev.db', SALON_ALLOW_DESTRUCTIVE_SEED: 'true' }, repository);
  assert.equal(sqlite, `file:${join(repository, 'prisma/dev/dev.db')}`);
});

test('a local SQLite name cannot escape the disposable directory through a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'seed-guard-fixture-'));
  try {
    mkdirSync(join(root, 'prisma/dev'), { recursive: true });
    // Outside the repository, /private/tmp and the temp directory alike, on
    // every platform this runs on.
    symlinkSync('/Users', join(root, 'prisma/dev/escape'));
    assert.throws(() => assertSafeSeedTarget({ DATABASE_URL: 'file:./escape/dev.db', SALON_ALLOW_DESTRUCTIVE_SEED: 'true' }, root), /disposable/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a symlink is followed even when its target does not exist yet', () => {
  // The dangerous case: SQLite CREATES the file, so the link has nothing to
  // point at while the guard runs. Judging the link by its own location would
  // let the write land anywhere the link happens to aim.
  const root = mkdtempSync(join(tmpdir(), 'seed-guard-dangling-'));
  try {
    mkdirSync(join(root, 'prisma/dev'), { recursive: true });
    symlinkSync('/no-such-root-for-seed-guard', join(root, 'prisma/dev/escape'));
    assert.throws(() => assertSafeSeedTarget({ DATABASE_URL: 'file:./escape/dev.db', SALON_ALLOW_DESTRUCTIVE_SEED: 'true' }, root), /disposable/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
