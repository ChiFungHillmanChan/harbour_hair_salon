# Harbour Hair Salon

Next.js 16 salon website with authenticated booking requests, customer appointment management, an admin calendar, per-stylist calendar connections, and a transactional notification outbox. Production runs on Vercel Pro with Neon PostgreSQL.

## Salon handover

Use the [fillable Cantonese PDF](output/pdf/harbour-hair-salon-handover-fillable.pdf) for the salon visit, account invitations, staff schedules, calendar evidence, and launch acceptance. Save a separate completed copy; do not put passwords, API keys, private calendar URLs, or completed customer forms in Git.

The [technical rollout record](readme/production-readiness-rollout-cantonese.md) documents the implementation, verification, outstanding production prerequisites, and rollout sequence. The [function registry](readme/structure.md) describes the source layout. See [AGENTS.md](AGENTS.md) for development commands and repository conventions.

The [backend security operations runbook](readme/backend-security-operations.md) covers administrator bootstrap, mandatory MFA, recovery, signing-key rotation, kiosk revocation and database maintenance. Administrator bootstrap uses secret-manager environment values and an explicit maintenance target; command-line passwords are not accepted.

## Production behaviour

- Website bookings remain requests pending salon confirmation.
- Calendar connections exchange ICS busy periods. They do not create complete Treatwell/Fresha orders, payments, or refunds, and they do not relay one marketplace's events into the other marketplace.
- Opening booking requires complete schedules, applicable calendar evidence, and successful runtime checks. `NOTIFICATIONS_ENABLED` and `CALENDAR_SYNC_ENABLED` default to disabled.
- Production deployment runs through [GitHub Actions](.github/workflows/deploy.yml) when `main` is pushed. The production build runs PostgreSQL migrations before building the application. Preview builds skip migrations.

## Verification

Use Node.js 24 LTS (`nvm use`) and pnpm 10.33.0. CI reads `.nvmrc`;
`packageManager` pins the pnpm version. Install with `pnpm install --frozen-lockfile`.
The 2026-09-16 upgrade and selected launch fixes are recorded in
[the verification report](readme/upgrade-verification-2026-09-16-cantonese.md).

```bash
pnpm test
pnpm lint
pnpm build
```

Database integration verification uses `pnpm test:integration` with `SALON_TEST_DATABASE_URL`. The script accepts only a disposable local database named `salon_test`; never use production credentials. Details and a sample command are in the rollout record.

The PDF builder lives in `scripts/pdf/`. It needs ReportLab, pypdf, fontTools, and an embeddable CJK font. Only the blank master belongs in this repository.
