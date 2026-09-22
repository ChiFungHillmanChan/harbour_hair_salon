// Production is deployed ONLY by the "Deploy to Vercel Production" job in
// .github/workflows/deploy.yml, which runs after the full CI gate (tests,
// PostgreSQL integration checks, migration drift, build) passes on `main`.
//
// On 2026-09-20 production was deployed with `vercel --prod` from a laptop with
// uncommitted changes (Vercel recorded gitDirty=1), so for two days the live
// site ran code that existed in no commit and the next push to main would have
// silently reverted it. This guard runs first in `vercel-build` and refuses any
// production build that is not that GitHub Actions job on main:
//   - `vercel --prod` from a laptop (remote build on Vercel)
//   - `vercel build --prod` locally, then `vercel deploy --prebuilt --prod`
//   - Vercel's own git-triggered builds (also disabled in vercel.json)
// Preview builds and instant rollbacks (no rebuild) are unaffected.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Returns why this build must not run, or null when it may.
 *
 * `vercel build` sets VERCEL=1 but takes VERCEL_ENV only from the env file
 * that `vercel pull --environment=<target>` wrote, so a Vercel build with no
 * VERCEL_ENV has an UNKNOWN target (a plain `vercel pull` defaults to
 * development, yet `vercel build --prod` still emits production output). Treat
 * that like production instead of waving it through — and it would also skip
 * `prisma migrate deploy` below.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function productionBuildBlocker(env) {
  const target = env.VERCEL_ENV;
  if (target === 'preview' || target === 'development') return null;
  if (target !== 'production' && env.VERCEL !== '1') return null; // not a Vercel build (e.g. `pnpm build`)
  if (target === 'production' && env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF === 'refs/heads/main') return null;
  if (target !== 'production') {
    return 'This Vercel build has no VERCEL_ENV, so its target is unknown. Run ' +
      '`vercel pull --environment=preview` before a preview build; production ' +
      'builds only run in the GitHub Actions deploy job on main.';
  }
  return 'Production builds only run in the GitHub Actions deploy job on main. ' +
    'Commit your change, push (or merge a PR) to main, and let CI deploy it — ' +
    'do not run `vercel --prod` locally.';
}

/**
 * Compare real paths, not `import.meta.url` with `file://${argv[1]}`: the URL is
 * percent-encoded (spaces, accents, `#`) and symlink-resolved while argv[1] is
 * neither, and a mismatch silently skipped the whole guard.
 */
function isRunDirectly() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
}

if (isRunDirectly()) {
  const blocker = productionBuildBlocker(process.env);
  if (blocker) {
    console.error(`\n[production-build-guard] ${blocker}\n`);
    process.exit(1);
  }
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
    console.log(`[production-build-guard] ${process.env.VERCEL_ENV} build allowed.`);
  }
}
