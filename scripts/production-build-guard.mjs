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

/**
 * Returns why this build must not run, or null when it may.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function productionBuildBlocker(env) {
  if (env.VERCEL_ENV !== 'production') return null;
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF === 'refs/heads/main') return null;
  return 'Production builds only run in the GitHub Actions deploy job on main. ' +
    'Commit your change, push (or merge a PR) to main, and let CI deploy it — ' +
    'do not run `vercel --prod` locally.';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const blocker = productionBuildBlocker(process.env);
  if (blocker) {
    console.error(`\n[production-build-guard] ${blocker}\n`);
    process.exit(1);
  }
}
