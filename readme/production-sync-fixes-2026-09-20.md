# Production sync fixes — 20 September 2026

## Released

Deployed to https://www.harbourhair.co.uk on the existing Vercel Pro project.
Deployment: `dpl_GJWo8xefeLLM8t9yXvzBcuhN255h`, region `lhr1`, state `READY`.
Vercel's deployment API confirms `/api/cron/calendar-sync` uses `*/15 * * * *`.
No database schema changes or new migrations. No paid plan changes.

- Inbound calendar imports run on quarter-hour ticks only inside the saved active-staff opening windows, with 15 minutes before opening and after closing. Times use Europe/London, including BST/GMT changes and buffers crossing midnight.
- Opening hours are cached without timed expiry. Closed ticks skip feed fetching and job-state writes. A cold/evicted cache still requires one database read; this is not a zero-compute guarantee.
- Admin opening-hours edits immediately invalidate the schedule cache and booking display cache. Stylist deletion invalidates the schedule cache. Direct database edits to hours or staff activation require explicit `calendar-sync-hours` cache invalidation; redeployment alone may retain Next's Data Cache.
- Visible day/week/month calendars refresh shortly after the quarter-hour import, allowing its 90-second execution budget. Hidden tabs and closed periods stop automatic database refreshes. Year totals refresh on demand. Mutations and Refresh now still refresh immediately.
- Calendar UI shows when the server data was loaded and explains the difference between screen refresh and platform import. Existing source labels, UK start/end times, stylist/import metadata, mobile lists and overlapping/cross-day display remain covered by regression tests.
- Manual integration tests remain available outside opening hours.

The saved schedule (unchanged) gives these combined sync windows:

| Days | UK sync window |
| --- | --- |
| Monday–Wednesday | 09:45–19:45 |
| Thursday–Sunday | 10:00–19:15 |

These reflect the site's stored staff hours, not confirmation that platform rotas or the salon's Sunday hours agree.

## Verification

- Node 24: **625 tests passed, 0 failed, 0 skipped**.
- ESLint, TypeScript and whitespace checks passed.
- Local production build using isolated PostgreSQL passed; Vercel production build and alias promotion succeeded.
- New window tests cover exact buffered boundaries, BST/GMT, closed/malformed schedules, adjacent-day buffers, quarter-hour screen refresh and the final closing-time import. The closed-hours route regression was observed failing before implementation and passes now without job-state or import calls.
- Disposable PostgreSQL integration checks passed: booking races/caps, inactive staff rejection, price snapshots and discount rollback, transactional outbox, import reconciliation and failure preservation, year aggregation across database timezones, payroll concurrency and rollback.
- Full booking lifecycle passed on synthetic data: create → confirm → reschedule → cancel; ownership/status and 24-hour rules; imported conflicts; stale-feed rejection; moved/deleted external events; outbound feed updates and unique notification keys. No external messages were sent.
- Production-server HTTP checks passed for access protection on ten admin routes, MFA enrollment/replay/rate limits, customer and blog pagination, PII bounds and kiosk access.
- Local browser: synthetic administrator sign-in, day calendar, imported Treatwell 10:00–11:00 and Fresha 13:00–13:30, refresh control, desktop and 390px mobile layouts inspected. Synthetic Treatwell events do not prove live Treatwell connectivity.
- Live authenticated import after deployment: HTTP 200, `ok: true`, all four Fresha connections succeeded; 0/14/16/0 blocks reconciled. Used the existing cron credential in memory through normal Vercel access; no secret values were printed or stored.
- Live smoke: home/services/offers/contact/book HTTP 200; anonymous admin/integrations redirect to sign-in; unauthenticated calendar cron returns 401. `/book` remains closed.

## Production blockers remain

| Requested outcome | Current result |
| --- | --- |
| Admin panel | Existing regression/integration checks pass; updated calendar UI deployed. This is not an assertion that every possible admin workflow has been manually exercised. |
| Website booking | Transactional flow passes isolated acceptance; production master switch remains OFF. Missing active-channel coverage and notification readiness still prevent safe launch. |
| Accurate calendar | Displays imported data with source/time metadata. Fresha Funky/Ivan have 14/16 future blocks in the snapshot (including prior synthetic platform blocks). Lox/Shania feeds succeed but have no future blocks; real nonempty coverage remains unproven. |
| Treatwell import | No readable inbound connection for the active Treatwell stylists. Software cannot import unavailable source data. |
| Notifications | Production delivery remains OFF; stored readiness report fails that check. No client emails, platform settings, or synthetic platform blocks were changed in this task. |
| Free operation | Database wake-ups reduced; entirely free Vercel hosting is not available for this commercial salon under Hobby rules. |

Other acceptance items in the supplied report remain outstanding: owner confirmation of Sunday hours, durations/prices and Shania's availability; password reset completion and inbox/spam checks; removal of earlier platform test blocks; real-device/camera acceptance; backup retention policy. No evidence was fabricated for these items.

## Cost and freshness limits

Read-only Neon project snapshot reported approximately **10.66 CU-hours consumed** in the current period ending 1 October 2026. This is cumulative compute usage, not instantaneous CPU utilisation. Branch logical size was approximately 34 MB. This task did not change compute sizing or autosuspend settings.

At an **assumed** 0.25 CU with a five-minute idle tail, the saved schedule permits about 275 inbound ticks per week, or roughly 1,218 per 31-day month. Sync-only idle tails would therefore be approximately `1,218 × 5/60 × 0.25 = 25.4 CU-hours/month`, before execution time. This is an estimate, not a measured monthly total or cap. Screen refreshes, visitors, notification jobs, outbound feed refreshes, bot traffic, cache misses and other branches can add usage. A database held awake continuously at 0.25 CU would consume about 186 CU-hours in 31 days.

The existing **90-minute successful-import freshness ceiling is preserved**. With imports paused outside opening hours, direct website booking can close overnight until the next fresh successful import. External platforms can still accept bookings overnight, so treating old data as current would risk conflicts. Once direct booking is otherwise ready, 24-hour website booking would require a different sync policy.

Quarter-hour cron is best effort. Provider export delays and late cron runs can add latency; the UI is not a real-time cross-platform reservation guarantee. Failed imports retain prior busy blocks and block readiness rather than silently making those periods available.

Official limits checked for this task:
- [Vercel Hobby: personal, non-commercial use](https://vercel.com/docs/plans/hobby)
- [Vercel cron frequency and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Neon plan allowances and scale to zero](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md)
