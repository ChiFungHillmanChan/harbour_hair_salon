# Neon compute budget

> Read before scheduling anything, adding a public route that touches the database, or changing caching. Part of the agent guide: `CLAUDE.md` / `AGENTS.md` link here. Keep it true when the code changes.

Neon bills **compute time (CU-hours), not queries**, and its free tier suspends the
compute endpoint after **5 minutes idle**. The dominant cost driver is therefore
*how often something touches the database*, not how heavy the work is. One
trivial query every 5 minutes costs far more than a heavy query once an hour,
because it keeps the endpoint from ever suspending.

This bit us in August 2026: a `*/5` Treatwell sync cron sat exactly on the
suspend threshold and held the compute awake 24/7 — roughly the entire monthly
CU-hour allowance — while doing literally nothing, since no stylist has ever had
`treatwellIcalUrl` set and `ExternalBusyBlock` was empty. Fixed by removing the
cron and gating the route behind `TREATWELL_SYNC_ENABLED`.

Rules that follow from this:

- **Any new cron needs an interval over 5 minutes** (30+ preferred) and a
  business-hours window where possible. Vercel cron schedules are **UTC**; the
  salon runs on Europe/London, so a year-round window must cover both GMT and
  BST — `*/30 9-19 * * *` covers Mon–Fri 10:00–19:30 and Sat–Sun 10:30–18:00
  local in either season. Short `*/10` runs can allow suspension, but consume
  roughly 90 CU-hours per 30-day month at 0.25 CU with a five-minute idle tail;
  aligned `*/30` runs start around 30 CU-hours before execution time and traffic.
- **Put cost kill-switches above the first DB call**, never below. Entering a
  function that opens with a query already wakes the compute, so an early return
  that sits after the query has bought nothing. `treatwell-sync/route.ts` has a
  test locking this ordering.
- **Keep public pages on ISR** (`export const revalidate`). They currently serve
  from cache and stay off the database; making one `force-dynamic` puts bot and
  crawler traffic directly onto Neon compute.
- **`/api/health` runs `SELECT 1` and is `force-dynamic`.** Never point a
  frequent uptime monitor at it — that alone would pin the compute awake 24/7,
  independent of any cron.
- **A public endpoint that something external polls is a cron you do not
  control.** These rules used to police `vercel.json` only, and that is how the
  August 2026 failure came back in September: Fresha and Treatwell both
  subscribe to `/api/ical/[stylistId]`, which was `force-dynamic` + `no-store`,
  so three stylist feeds were fetched twice each every five minutes — twelve
  queries per five minutes, forever, pinning the compute exactly as the old
  cron had. It is now served from the Data Cache (`stylist-ical-cache.ts`) and
  invalidated by `invalidateStylistIcalFeed()` on every appointment mutation.
  **A cache's timed expiry is itself a poll.** Its 30-minute safety net was
  still the largest Neon cost in September 2026 (~45 wakes, ~1.7 CU-h a day —
  about half the free plan), because every expiry turned the next marketplace
  poll into a wake. When mutations already invalidate a tag, keep the timed
  expiry to a day or more. Measure with Neon's operations log
  (`start_compute`/`suspend_compute`), not guesses.
  Before shipping any public route that touches the database, ask who polls it
  and how often, and check the runtime logs for the real cadence — not just
  `vercel.json`.
- **A page that reads `searchParams` is dynamic, whatever its `revalidate` says.**
  `/blog` (`?page=`) ran two Neon queries on every visit until 2026-09-29; its
  cards now come from one Data Cache entry per language (`BLOG_POSTS_TAG` in
  `blog-service.ts`, dropped by every blog/translation publish and by Admin →
  Settings → Save). A direct write (translation import, seed script, SQL) is
  NOT seen for up to 24 h — press Settings → Save or run
  `npx vercel cache invalidate --tag blog-posts --yes`. Any new dynamic public
  page must do the same or stay off the database.
- **Site settings are cached for 24 hours** (`getSiteSettings`, tag `site-settings`). Admin → Settings, opening hours and content saves drop the tag. A direct database write is not seen until then: press Save in Admin → Settings. The settings form and the deposit policy read the live row (`getSiteSettingsForEditing`); a form built from the cached copy once switched booking off when saved.
- **Each Google Calendar notification wakes the database** (the webhook pulls after answering; a pull reads and may replace busy blocks and the diary). That is a public endpoint something external calls: the website's own writes notify it too, so bursts collapse into one pull at a time plus one re-run, the webhook refuses (404/401) before any DB access, and its token expires with its channel. Notifications only follow a change on the salon calendar — since the diary mirror that is the staff's whole diary, so volume is bookings plus every diary edit, mostly in opening hours — and the Google steps ride the existing calendar-sync and housekeeping crons (no new cron). Watch Neon's operations log after turning it on, and again after switching `GOOGLE_CALENDAR_ID` to HarbourHair.
- **The chair rule adds one `GoogleDiaryEntry` read to the booking reads** (three more when the range holds a walk-in); it rides requests that are already awake. The diary is written only when it changed.
- **Beta booking costs a signed-out visitor nothing.** While booking is closed, `/book`, the slot/day lookups and the price preview read the session cookie only; the beta check (the live `SiteSettings` row, then the account's email, then calendar readiness for a tester) runs only for a signed-in caller, and in the lookups only after their input and per-address checks. With the switch off, the outbox reads the beta list once per per-appointment dispatch (inside actions that already woke the database); the crons still return before any query.
- **Housekeeping is on by default**: one daily wake at 03:15 UTC, about 2.5 CU-hours a month. It already carries retention, request lapses, Square reconciliation and the daily Google Calendar run, so put a new daily chore there rather than adding a cron. Likewise, a 30-minute chore rides calendar-sync (as the late-arrival rule does).
- **Never return a fallback from inside a cached function.** `unstable_cache`
  stores whatever the callback returns, so a `catch { return DEFAULTS }` inside it
  caches the fallback for the whole revalidate period. Site settings did exactly
  that on every Neon cold-start hiccup (up to an hour of default content, fixed
  in PR #57). Let the read throw out of the cache and fall back outside it.
- **Preview deployments have their own London database** since 2026-09-30:
  Neon project `harbour-hair-preview-lhr` (`aged-glitter-18950253`, PG 18,
  eu-west-2), provisioned through the Vercel Marketplace (`PREVIEWDB_*` vars) with
  its own password and its own free CU-hours — preview code cannot reach
  production. It holds an **exact copy of production taken 2026-09-30, including
  real customer data**: treat it like production. Previews never migrate, so
  apply every new migration to it too (`prisma migrate deploy` with the preview
  env) or every PR's "Deploy Preview" fails. The last one applied by hand was
  `20261018200000_deposit_locked_at` (2026-10-18; before it `20261018120000_booking_beta_emails`
  the same day, and `20261017180000_stylist_show_on_website`, `20261017150000_stylist_takes_walk_ins`
  and `20261017120000_google_diary_mirror` on 2026-10-17). The Blast Radius hook holds
  `prisma migrate` until the owner approves it; when they are away it times out, and the owner
  can run the §7 command themselves (a `!` line in Claude Code). Refresh the copy with a PostgreSQL 18
  `pg_dump` of production restored into it. The old us-east-1 project
  (`neon-beige-river`) is kept, unused, by owner decision.
- `infra/aws/treatwell-sync/` is a **dormant** EventBridge→Lambda fallback for
  the same endpoint. Do not deploy it; see its README.
