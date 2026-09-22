import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { productionBuildBlocker } from '../../../scripts/production-build-guard.mjs';

const ci = { VERCEL_ENV: 'production', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main' };

test('the GitHub Actions production job on main may build', () => {
  assert.equal(productionBuildBlocker(ci), null);
});

test('production builds from a laptop, a Vercel git build or another branch are refused', () => {
  for (const env of [
    { VERCEL_ENV: 'production' },
    { ...ci, GITHUB_ACTIONS: undefined },
    { ...ci, GITHUB_REF: 'refs/heads/feature' },
    { ...ci, GITHUB_REF: 'refs/pull/7/merge' },
  ]) assert.match(productionBuildBlocker(env) ?? '', /GitHub Actions/, JSON.stringify(env));
});

test('preview and local non-Vercel builds are not affected', () => {
  assert.equal(productionBuildBlocker({ VERCEL_ENV: 'preview' }), null);
  assert.equal(productionBuildBlocker({ VERCEL: '1', VERCEL_ENV: 'preview' }), null);
  assert.equal(productionBuildBlocker({ VERCEL: '1', VERCEL_ENV: 'development' }), null);
  assert.equal(productionBuildBlocker({}), null);
});

test('a Vercel build with no VERCEL_ENV is refused, because its target is unknown', () => {
  // `vercel pull` without --environment writes development env, yet
  // `vercel build --prod` still emits production output (and would skip migrations).
  assert.match(productionBuildBlocker({ VERCEL: '1' }) ?? '', /no VERCEL_ENV/);
  assert.match(productionBuildBlocker({ VERCEL: '1', GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main' }) ?? '', /no VERCEL_ENV/);
});

// Start from the runner's env (CI itself sets GITHUB_ACTIONS/GITHUB_REF) and
// replace only the variables the guard reads.
function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VERCEL_ENV; delete env.VERCEL; delete env.GITHUB_ACTIONS; delete env.GITHUB_REF;
  return Object.assign(env, overrides);
}

test('the script exits non-zero when run for a refused production build', () => {
  const script = fileURLToPath(new URL('../../../scripts/production-build-guard.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script], { env: childEnv({ VERCEL_ENV: 'production' }), stdio: 'pipe' }));
  execFileSync(process.execPath, [script], { env: childEnv(ci), stdio: 'pipe' });
});

test('the guard still runs when the checkout path has spaces, accents or #', async () => {
  // import.meta.url is percent-encoded while argv[1] is not; comparing them
  // naively skipped the guard silently in such folders.
  const { mkdtemp, mkdir, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'guard-'));
  try {
    const odd = join(root, 'client website café #1');
    await mkdir(odd);
    const script = join(odd, 'production-build-guard.mjs');
    await copyFile(fileURLToPath(new URL('../../../scripts/production-build-guard.mjs', import.meta.url)), script);
    assert.throws(() => execFileSync(process.execPath, [script], { env: childEnv({ VERCEL_ENV: 'production' }), stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, ['production-build-guard.mjs'], { cwd: odd, env: childEnv({ VERCEL_ENV: 'production' }), stdio: 'pipe' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('vercel-build runs the guard before migrations or the Next build', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['vercel-build'], /^node scripts\/production-build-guard\.mjs && /);
});
