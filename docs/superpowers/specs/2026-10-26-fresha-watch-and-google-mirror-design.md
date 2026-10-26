# Fresha watch (5-minute Fresha → website) and the Fresha → Google mirror

Date: 2026-10-26. Owner decisions the same day: keep Neon (no database move), sync Fresha
within 5 minutes in opening hours (first built at 1 minute; the owner chose 5 the same day, §2a), and copy Fresha's busy times into Google ("A2") so the admin can keep
using Google Calendar while getting used to the website. Ships **off**.

## 1. Why the existing import cannot simply run more often

- Fresha → website was bounded by our own poll: the calendar-sync cron imports every feed every
  30 minutes. Measured 2026-10-26, Fresha's export is rendered live on every request
  (`cache-control: max-age=0`, no ETag/Last-Modified, every `DTSTAMP` = request time), so
  polling faster really is faster.
- But every calendar-sync tick writes to the database. At one tick a minute, production's fixed
  0.25 CU compute would never suspend in staff hours: about 100–110 CU-hours a month, over the
  free plan's 100 (the database is **suspended** when it runs out) and ~US$11–12 on Launch. A
  plain `*/5` import is the August 2026 failure (`docs/agents/neon-budget.md`).
- Website → Fresha is Fresha polling our busy feed (up to ~15 minutes). No change here can
  speed that up; the approval-time refresh (`refreshCalendarFeedsBeforeApproval`) stays the guard.

## 2. Design

A new cron, `/api/cron/fresha-watch`, `*/5 8-19` UTC (covers GMT and BST), that runs from 15
minutes before the first stylist starts until the last one finishes (`afterCloseMs: 0`; the
half-hourly import keeps its 15 minutes after closing) and only reaches the database when a
Fresha feed changed:

1. `CRON_SECRET`, then `CALENDAR_SYNC_ENABLED` and `FRESHA_WATCH_ENABLED` (both must be `true`).
2. The cached staff hours (`isScheduledCalendarSyncOpen`, as calendar-sync).
3. The Upstash state (one key, `fresha-watch:v1`): per connection the fingerprint last imported
   and last mirrored, plus retry times. No Redis → do nothing (never "import to be safe").
4. The feed list from the Data Cache (`fresha-watch-connections`, 24 h, tag-invalidated).
5. Fetch every Fresha feed in parallel with the pinned transport; fingerprint = sha256 of the
   unfolded lines without `DTSTAMP`.
6. Changed → `syncCalendarFeeds({ connectionId })` with the text already fetched (one wake). The
   fingerprint is stored whether the import succeeded or not; only a held lease
   (`skipped: 'locked'`) retries next tick. The half-hourly import is the retry and keeps
   `lastSuccessAt` fresh for the booking gate, exactly as before.
7. A feed that cannot be fetched is left for 15 minutes (three ticks; Fresha is not asked on every tick while failing).
8. **Hard ceiling:** at most 4 ticks an hour may import (`MAX_IMPORT_TICKS_PER_HOUR`; a tick
   counts once however many feeds it imports). Should Fresha's export gain another field that
   changes on every request, the fingerprint would change on every tick; the ceiling keeps that
   from pinning Neon (worst case ~4 extra wakes an hour in staff hours, still under the free
   plan). Changes over the ceiling wait for the next allowed tick or the half-hourly import.
   The mirror is not limited by it (it costs no Neon).

Cost: about 5–15 extra CU-hours a month (only Fresha changes outside an existing wake cost a
five-minute tail), ~4k Upstash commands and ~4.3k Vercel invocations a month.

## 2a. Why 5 minutes, not 1

- Polling faster costs Neon nothing extra (only changes do), so the choice is latency against
  Fresha load: 1 minute is 4 feeds × ~600 requests a day, 5 minutes a fifth of that, and an
  export URL polled every minute is the likelier one to be rate-limited.
- The minutes saved buy little: staff approvals re-read the approved stylist's Fresha feed when
  it is over 5 minutes old (`APPROVAL_REFRESH_MINUTES`), Website → Fresha is Fresha's own poll
  (up to ~15 minutes) whatever we do, and staff glancing at the Google mirror can wait 5.
- At night nothing runs: booking needs staff approval, which refreshes Fresha itself, and Admin
  → Integrations → Sync now imports a feed on demand.
- Back to 1 minute is the schedule alone (`* 8-19`); the code does not assume an interval.

## 3. The mirror (A2)

- On a change (or while the mirror is behind), parse the feed (`parseCalendarBusyIntervals`,
  the same 90-day window and RRULE handling as the import) and reconcile a SEPARATE Google
  calendar, `GOOGLE_FRESHA_MIRROR_CALENDAR_ID`, with the existing service account and gateway.
- Ids `hf` + 40 hex of (connection id, Fresha UID): reruns are idempotent. Private property
  `harbourFreshaMirror` = connection id; only those copies are ever deleted, and only future ones.
- Titles "<stylist> · Fresha booking / blocked time / busy", in the salon's diary language, the
  stylist's Google colour; the description says to change it in Fresha.
- Never the salon calendar: the pull reads HarbourHair, so the copies would become GOOGLE blocks
  and go back to Fresha. `freshaMirrorCalendarConfig` refuses that id.
- Google errors: `retryable` → next tick; anything else (not shared, wrong id) → 30 minutes.
  A run cut off by the deadline finishes next tick.
- Fresha's export carries only generic titles, so no customer data reaches the mirror.

## 4. Not done

- The admin schedule's auto-refresh still follows the half-hourly import ticks; a Fresha block
  imported by the watch shows on the next refresh or reload.
- A connection removed from Integrations leaves its old copies in the mirror (reversible, by
  owner preference); hide or delete them in Google.
- Fresha's own internal delay between a sale and its export is unmeasured (needs the Fresha login).
