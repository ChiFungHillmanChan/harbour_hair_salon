# Environment variables

> Every variable the app reads, where it is set, and the Vercel policies that bite. Part of the agent guide: `CLAUDE.md` / `AGENTS.md` link here. Keep it true when the code changes.

- `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` — Vercel Postgres (auto-injected by Neon)
- `DATABASE_URL` — Local SQLite (in `.env`)
- `SESSION_SECRET` — JWT signing key (required, no fallback)
- `RESEND_API_KEY` — Email service
- `EMAIL_FROM` / `EMAIL_REPLY_TO` — sender and reply-to on every email.
- `SALON_NOTIFY_EMAIL` — the salon inbox for new-request alerts and the daily ops alert. Falls back to `EMAIL_REPLY_TO`.
- `RESEND_AUDIENCE_ID` — the marketing list. Unsubscribe and customer erasure remove contacts from it.
- `NOTIFICATIONS_ENABLED` — `"true"` turns on booking emails, reminders and the daily ops alert. Anything else makes the notifications and reminders crons return before touching the DB. The online-booking go-live gate also requires it (`lib/booking-maintenance.ts`); beta booking does not, and a beta tester's booking emails go out even while it is off (per-appointment dispatch only; the crons stay off). Production: `false` until launch.
- `CALENDAR_SYNC_ENABLED` — `"true"` lets the calendar-sync cron run (production: `true`). The late-arrival rule runs inside it, so it stops too when the cron is off (as do the Google Calendar steps, below).
- `GOOGLE_CALENDAR_SYNC_ENABLED` / `GOOGLE_CALENDAR_ID` / `GOOGLE_CALENDAR_SA_EMAIL` / `GOOGLE_CALENDAR_SA_PRIVATE_KEY` / `GOOGLE_CALENDAR_WEBHOOK_SECRET` — the Google Calendar sync (`lib/google-calendar-config.ts`). **Vercel Production only, never Preview.** All five must be present and `GOOGLE_CALENDAR_SYNC_ENABLED` must be `"true"`, else the sync is off (webhook 404). The private key is a PEM whose newlines are the literal characters `\n`. Rotating the webhook secret refuses the live channel's notifications (401) until Sync now, which replaces the channel at once (redeploy, then Sync now: `docs/google-calendar-setup.md` §5). The 30-minute retry of failed writes and the safety-net pull run inside the calendar-sync cron, so they need `CALENDAR_SYNC_ENABLED=true` and run in staff hours only.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google sign-in: the OAuth client "Harbour website sign-in" in the `harbourhair` Google Cloud project (harbourhairuk@gmail.com; consent screen published, External). Its redirect URIs are `https://www.harbourhair.co.uk/api/auth/google/callback`, the bare-domain one and `http://localhost:3000/...`. Production and Preview.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `_TOKEN`) — Upstash Redis for rate limits (`lib/redis-credentials.ts`).
- `NEXT_PUBLIC_SITE_URL` — canonical site URL; defaults to `https://www.harbourhair.co.uk`.
- `TREATWELL_API_ENABLED` — `"true"` turns on the Treatwell API worker (`services/treatwell-api.ts`).
- `CRON_SECRET` — Vercel cron auth (auto-injected)
- `HOUSEKEEPING_ENABLED` — the daily housekeeping cron runs unless this is `"false"` (retention in the privacy notice, delivery-lease recovery, request lapsing and card-deposit reconciliation depend on it).
- `TREATWELL_SYNC_ENABLED` — kill-switch for `/api/cron/treatwell-sync`. Unset/anything but `"true"` makes the route return before touching the DB. Deliberately off (see below).
- `SQUARE_*` (seven variables) — Square deposits. Sandbox values on Vercel **Preview** only, production values on **Production** only; what goes where, and why sandbox credentials never open production booking: `docs/square-payments-setup.md` §2. Production has all seven since 2026-10-18. Preview currently has no `SQUARE_ACCESS_TOKEN` / `SQUARE_WEBHOOK_SIGNATURE_KEY` (its card form says "not available"): re-add the sandbox ones before the next sandbox test.
- `PREVIEW_EMAIL_ALLOWLIST` — Vercel **Preview** only: comma-separated addresses and/or `@domain` entries. Previews run on a copy of production's customers, so on a preview deployment (`VERCEL_ENV=preview`) `sendPreparedEmail` emails only these recipients; anything else is dropped as if sent (no retry), and with it unset a preview sends nothing (`lib/preview-email.ts`). Set it to your own address before `NOTIFICATIONS_ENABLED=true` on Preview (`docs/square-payments-setup.md` §3). Since 2026-10-18 Preview keeps the allowlist and has `NOTIFICATIONS_ENABLED=false` (switched off, not deleted).
- **GitHub Actions** (repository settings, not Vercel):
  - Secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are needed for every deploy.
  - The optional `NEON_API_KEY` secret plus the `NEON_PROJECT_ID` variable turn on the pre-migration Neon snapshot.
- **Vercel's team policy makes new variables Sensitive.** `vercel env pull` and the deploy job's `vercel pull` then read the literal `[SENSITIVE]` instead of the value. Anything the BUILD reads must be added with `vercel env add --no-sensitive`, or the build sees the placeholder: `NEXT_PUBLIC_*`, and the database URLs that `prisma migrate deploy` uses. The team also has **"Separate Production Secret Values"**: a Secret's Production value must differ from its Preview value, so add a production secret as a NEW Production-only variable, never into the Preview one (that happened on 2026-10-18 and was fixed by retargeting).
