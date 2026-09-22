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
  assert.equal(productionBuildBlocker({}), null);
});

// Start from the runner's env (CI itself sets GITHUB_ACTIONS/GITHUB_REF) and
// replace only the variables the guard reads.
function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VERCEL_ENV; delete env.GITHUB_ACTIONS; delete env.GITHUB_REF;
  return Object.assign(env, overrides);
}

test('the script exits non-zero when run for a refused production build', () => {
  const script = fileURLToPath(new URL('../../../scripts/production-build-guard.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script], { env: childEnv({ VERCEL_ENV: 'production' }), stdio: 'pipe' }));
  execFileSync(process.execPath, [script], { env: childEnv(ci), stdio: 'pipe' });
});

test('vercel-build runs the guard before migrations or the Next build', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['vercel-build'], /^node scripts\/production-build-guard\.mjs && /);
});
