# Evidence-aware Hair Colour Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans. User has approved the design and direct edits on main.

**Goal:** Improve current-colour analysis and treatment-aware predictions with honest provenance and shared photo/video behaviour.

**Architecture:** Keep the browser segmentation and renderer. Add a consultation contract and robust analysis/colour measurement helpers; expose their context in existing bilingual controls. No new backend or database.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, MediaPipe, node:test, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-29-trycolor-evidence-design.md`

## Global Constraints

- Work on main as requested; preserve unrelated changes. The user subsequently authorized commit/push and deployment through the existing GitHub CI/CD, after verification.
- No invented manufacturer shade mappings, measured tresses, or accuracy percentages.
- Follow the exact shared contract in the spec; no dependency additions needed.

## Task 1: Analysis and rendering engine

Files: constants.ts, colorMath.ts, colorMath.test.ts; optional focused colour-science helper/tests under src/components/try-color.

- [x] Add failing behavioural tests for no-hair/poor exposure, robust highlights, deposit no-lift, history restrictions, orange versus pale-yellow prelightening, identical custom/preset HEX, and exact zero-strength identity.
- [x] Implement the shared contract, robust samples/region summaries and source-labelled colour metadata. Preserve existing mask/texture tests, changing obsolete guaranteed-post-bleach assumptions.
- [x] Test with `node --import tsx --test src/components/try-color/*.test.ts` and targeted ESLint.

Core assertions include `assert.equal(deposit.achievedLevel, baseLevel)`, `assert.deepEqual(zeroStrength.data, source.data)`, and `assert.equal(empty.quality, 'unusable')`.

## Task 2: Consultation controls and bilingual guidance

Files: ColorPalette.tsx, src/i18n/messages/en/tryColor.ts, src/i18n/messages/zh/tryColor.ts.

- [x] Replace pre/post buttons with the three explicit services and history/base/grey selectors.
- [x] Show quality issues, estimated range, approximate region levels and translated result notices. Use '--' before a usable analysis; no fallback level 5 label.
- [x] Show illustrative shade provenance, generic scale explanation and capture guidance. Keep colour selection and accessible manual override.
- [x] Verify message completeness and target ESLint; browser validation follows integration.

## Task 3: Integration and evidence collection

Files: TryColorClient.tsx, VideoTryOn.tsx, focused shared preview helper/tests if required, research/calibration documentation, targeted readme/structure.md entries.

- [x] Thread stable consultation requests through photo/video/worker; report video context without rerender loops, clear stale context, cancel outdated media processing.
- [x] Paint first uploaded photo after mount and retain exact original preview at zero strength.
- [x] Provide a validated measured-tress format and collection protocol without fictitious data; clarify brand scales and D65 versus CSS Lab white points.
- [x] Run feature tests, translations, lint and TypeScript/build. Inspect photo/video controls in browser in both languages and mobile width; use local fixtures only.
- [x] Independent final review, fix substantive issues, record verification and physical-data limitations.

## Verification results — 2026-09-29

- Worked directly on `main`, as requested; no push or deployment.
- Node 24.21.0: full `pnpm test` passed **876/876**; feature engine/calibration tests passed **37/37**.
- Source ESLint (`src`, `scripts/validate-hair-calibration.ts`, `next.config.ts`), TypeScript `--noEmit`, and `git diff --check` passed.
- `next build --webpack --experimental-build-mode compile` passed. This verifies production compilation, not a complete prerender/deploy.
- Full `pnpm build` compiled and passed TypeScript, then failed while prerendering `/zh-hk`: the existing database lacks `Service.offeringId`. It also logged missing `SiteSettings.salonNotificationLocale`. No database changes were made.
- Plain `pnpm lint` traversed generated files inside an existing `.claude/worktrees` checkout and failed there. The current website source and added script/config pass separately.
- Chromium: first photo paint; byte-identical original at zero strength; service/history/assumed-base controls; no-hair rejection; stale delayed-image callback after navigation; normal replacement; video extraction, play/pause, scrubbing, current-frame analysis and JPEG download. English desktop and Traditional Chinese at 390px were inspected; no horizontal overflow. No claim of a physical iPhone/Safari test.
- Browser-discovered video CSP failure fixed with `media-src 'self' blob:` and a regression test. Existing analytics CSP and missing site-settings database-column diagnostics remain outside this feature.
- Independent review found and verified fixes for preset/custom brightness jumps and stale photo decoding. A final warm-pigment boundary was smoothed and regression-tested.

Physical hair-tress measurements and independent salon outcome validation remain future data collection. No measured shade catalogue, dye recipe, or numerical accuracy claim is included.

## Release verification — 2026-09-29

The user authorized mobile/iPad polish, final checks, commit/push to main and GitHub-driven Vercel deployment.

- Fixed clipped upload instructions at 320px, undersized touch controls, WebKit native select sizing, and retained scroll position when changing media. Upload zones support keyboard selection; photo/video previews preserve their source aspect ratio.
- Chromium checked 320×740, 390×844, 768×1024, 834×1194, 1024×768 and 1194×834. Photo previews remain painted through resizing, with no horizontal overflow or main buttons/selects/ranges below 44px.
- Playwright WebKit emulated iPhone at 390×664 / 844×390 and iPad at 834×1194 / 1194×834. Photo/video rendering, touch selection, playback, timeline, JPEG downloads and mode-switch scrolling passed. This is browser-engine/device emulation, not physical Apple hardware testing.
- Full lint now passes after excluding only local nested worktrees and generated browser artifacts. The 876-test app suite, 3D tests/build consistency and both dependency audits pass.
- A separate temporary localhost PostgreSQL 17.11 cluster was initialized and migrated. PostgreSQL/SQLite migration replay and drift, database concurrency/rollback, booking lifecycle, full production build, production HTTP authorization/pagination and TypeScript checks pass. GitHub CI independently repeats these checks with PostgreSQL 18.
- No existing or production database was changed locally. The original build failure above was due to the old configured schema; validation succeeds against the current migrated disposable database. Production migrations remain exclusively in the approved GitHub deployment workflow.
