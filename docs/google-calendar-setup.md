# Google Calendar two-way sync: runbook

How the website shares the salon's appointment diary with Google Calendar, how to set it up
(Google Cloud, the calendar, Vercel), how to check it works, and what to do when it does not.

- **Design (decisions and reasons):** `docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md`
  (the sync, #72) and `docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md`
  (the diary mirror: colours, the chair rule, the primary calendar).
- **The sync now reads and writes the salon's primary "HarbourHair" calendar**
  (`harbourhairuk@gmail.com`), the diary the staff already keep. #72's separate "Harbour website
  bookings" calendar is retired; production uses it until `GOOGLE_CALENDAR_ID` is switched (§2b).
- **Customer-facing text:** `/privacy` (Google Calendar under "Who we share it with", and "How
  long we keep it": the Google copies and the salon diary shown to staff).
- **Off by default** (a missing variable keeps it off); **on in production since 2026-10-16.** Nothing
  happens until all five variables in §3 are set on Vercel **Production**.

---

## 1. What it does

- **Website to Google (push).** Every booking that is not cancelled is written as one event
  on the salon's primary "HarbourHair" calendar, in its stylist's **Google colour** (Admin →
  Stylists, §2a; a stylist with no colour set → the no-stylist colour, default Tomato). It is
  titled `Stylist · Customer · Service` (a pending request is marked), with the phone number,
  notes, status, any open reschedule request, deposit state and a link to the day in Admin. A change
  reaches Google within seconds (after the response of the action that made it); the
  calendar-sync cron (every 30 minutes in staff hours) retries failures and catches
  cron-made changes (lapses, late cancellations); housekeeping (daily, 03:15 UTC) re-renders
  the whole window and deletes copies of appointments that ended more than **12 months** ago.
- **Google to website (pull): the salon diary.** Every other event in the calendar, from 30 days
  back to 90 days ahead, is copied into the website's diary and sorted, **colour first**:
  1. **A stylist's Google colour** → that stylist's booking: it blocks that stylist.
  2. **The no-stylist colour** (default Tomato) → a booking with no stylist yet (a walk-in
     `(W)`, Treatwell `TW`, …). It **takes one chair**: online booking (the slot grid, `/book`,
     "Anyone", a customer's reschedule request) only offers a time when enough *other*
     stylists work and are free for every such event overlapping it. A booking or move made
     in Admin gets a warning with "Book anyway" instead; staff confirming a request or
     approving a reschedule are not checked.
  3. **Any other colour (the leave colour, Graphite, included) or none** → **names in the
     title**: an event that names a stylist is leave and blocks that stylist (`Ivan off`,
     `早走(L)`; `遲返 (L)(F)` names two and blocks both). An event that names nobody is a
     **note** and blocks nothing (`卡機`, `檢查消防`, `見工 zayn`, `GhD Con`).

  A name is the stylist's name as in Admin → Stylists or one of their Google names (§2a); case
  does not matter:
  - a name of **one letter** counts only in brackets: `早走(L)`, `( F )`; a bare `F` does not;
  - a **longer** name counts when no other letter is glued to its left and it is followed by
    the end, a non-letter or `off`: `Ivan off`, `LoxOff`, `lox.`, `Day off lox` (not `Loxley`
    or `Ivana`);
  - a **Chinese** name counts anywhere in the title: `天off`, `天 driving lesson`.

  **"Show as: Available" is ignored**: such an event blocks like any other. #72's rule that
  available events block nothing is dropped, because Google makes all-day events "available"
  by default and the salon's leave is all-day. Cancelled events are skipped; an all-day event
  covers the whole salon day(s).

  Stylist and leave events are stored as busy time (`ExternalBusyBlock`, source `GOOGLE`): they
  close the stylist's hours on `/book` and are exported in that stylist's outbound busy feed, so
  Fresha stops selling the hour too (as #72). **Walk-ins (the no-stylist colour) and notes are
  never sent to Fresha**: the feed says only "Busy", never a title. Only titles and times are
  copied, never descriptions, attendees or locations.

  **Admin → Schedule shows the whole diary** (30 days back, 90 ahead), read-only, with Google's
  titles and colours: stylist and leave entries in their stylists' columns, walk-ins in a "No
  stylist" column, notes in a strip above the grid; a click opens the entry with "Open in Google
  Calendar". Diary entries are changed in Google, never in Admin.
- **The website's own events are never part of the diary** (a website booking written in Tomato
  never takes a chair), and **the website wins**: an edit of one in Google (time, title, notes,
  colour) or its deletion is written back, for bookings from 7 days back onwards too. Staff
  change website bookings in **Admin**, never in Google. If Google keeps changing an event,
  the website writes it back at most once every 10 minutes. Until then the booking counts
  under "Bookings Google would not take" on Admin → Integrations (§7).
- **Real time.** Google calls `POST /api/webhooks/google-calendar` for every change; the
  website answers at once and pulls afterwards, one pull at a time. If a notification is
  missed, the 30-minute calendar-sync run (staff hours, §3) pulls anyway.

Google is **not** a calendar connection in Admin → Integrations (no per-stylist links); that
page only shows its status, a "Sync now" button, "Clear Google busy time and diary copy" (§6) and the diary
colours (§2a).

---

## 2. Google Cloud and the calendar (one-off)

1. **Google Cloud Console** → the project that already holds the Google sign-in client
   ("Continue with Google"): **`harbourhair`** (`harbourhair-511821`), signed in as
   harbourhairuk@gmail.com. APIs & Services → Library → **Google Calendar API** → Enable.
   (Done 2026-10-16: service account `harbour-website-calendar@harbourhair-511821.iam.gserviceaccount.com`.
   #72's calendar "Harbour website bookings" on harbourhairuk@gmail.com is retired at the switch, §2b.)
2. APIs & Services → Credentials → Create credentials → **Service account**. Name it
   `harbour-website-calendar`; no project roles are needed. Copy its email
   (`…@….iam.gserviceaccount.com`): this is `GOOGLE_CALENDAR_SA_EMAIL`.
3. The service account → Keys → Add key → Create new key → **JSON**. The download holds the
   `private_key` (a PEM). **Never commit this file** or paste it into a chat, a ticket or
   the repo; delete the download once it is in Vercel (§3), or keep it only in the git-ignored
   `.secrets/` folder (mode 600; `.gitignore` covers `.secrets/` and `client_secret_*.json`).
4. Sign in to Google Calendar as **harbourhairuk@gmail.com** (the salon's account) and share
   the **HarbourHair** calendar (its Settings and sharing → **Share with specific people**)
   with the service account's email with **Make changes and see all event details**
   (變更和查看所有活動詳情). Its Calendar ID is `harbourhairuk@gmail.com`: this is
   `GOOGLE_CALENDAR_ID`. (Done 2026-10-17.)
5. Staff keep their own access to HarbourHair, as before: they keep the diary exactly as they
   always have, and the colours and names in §2a decide what the website makes of each event.
6. **Only staff write to this calendar.** Never point Fresha's, or any other app's, Google
   sync at it: a foreign app's events would appear in the diary and, in a stylist's colour or
   naming one, block that stylist.

### 2a. Diary colours and names

Set these before the sync reads HarbourHair (§2b), and press **Sync now** after any change:
they are applied by the next sync.

- **Admin → Stylists**, each stylist → Google colour and Google names (comma-separated; the
  stylist's own name always counts):

  | Stylist | Google colour | Google names | Takes walk-ins |
  |---|---|---|---|
  | Ivan | Lavender | | ✓ |
  | Funky | Sage | `F` | ✓ |
  | Lox | Banana | `L` | ✓ |
  | Shania | none | `天` | – (assistant; owner, 2026-10-17) |

  **Takes walk-ins** (on by default, so a new stylist counts) decides who is a chair for red
  (no-stylist) events: online booking keeps enough of them free. Untick it for staff who take no
  walk-ins: they are never counted free, and their own bookings use no walk-in chair.

  Each active stylist needs a colour of their own, and the no-stylist and leave colours below
  cannot be a stylist's. A stylist with no colour (Shania) is blocked only by events whose
  title names her (`天off`), and her website bookings are written in the no-stylist colour
  (they are the website's own, so they never take a chair).
- **Admin → Integrations → Google Calendar → Diary colours**: no stylist **Tomato**, leave
  **Graphite** (the defaults); the two must differ. Then **Sync now**.

### 2b. Switching to HarbourHair (rollout of the diary mirror)

In this order:

1. Merge and deploy. The production deploy applies `20261017120000_google_diary_mirror`
   itself; apply it to the **preview** database by hand (§3, "Migration"). Little changes for
   staff yet: the sync still uses "Harbour website bookings" (its staff events are now read by
   the rules in §1). The first run after the deploy
   records that calendar, and in doing so forgets its watch channel without stopping it (§4a):
   press **Sync now** to make a new one at once (until then, or the 03:15 UTC run, Admin →
   Operations shows `GOOGLE_CHANNEL_MISSING`).
2. Share HarbourHair with the service account (§2.4). Done 2026-10-17.
3. Set every stylist's Google colour and names, and the diary colours (§2a), **before**
   switching. The first pull of HarbourHair sorts the whole diary by them, and the first push
   writes every booking in its stylist's colour: without them, the customers in a stylist's
   colour would be notes that block nothing.
4. Vercel **Production**: `GOOGLE_CALENDAR_ID` = `harbourhairuk@gmail.com`
   (`vercel env rm GOOGLE_CALENDAR_ID production`, then `vercel env add GOOGLE_CALENDAR_ID
   production`; keep it Sensitive), then redeploy (merge a commit to `main`).
5. Reload **Admin → Integrations → Google Calendar**: it must show the first characters of
   the new calendar id. Then press **Sync now**: it writes every booking in the window to
   HarbourHair, reads the diary and watches HarbourHair (§4a).
6. Verify (§4). Then the owner switches "Harbour website bookings" off (§4.8).

---

## 3. Vercel environment, PRODUCTION ONLY

| Variable | Value |
|---|---|
| `GOOGLE_CALENDAR_SYNC_ENABLED` | `true` (kill-switch: anything else, or unset, turns everything off) |
| `GOOGLE_CALENDAR_ID` | `harbourhairuk@gmail.com`, the HarbourHair calendar (§2.4); changing it: §4a |
| `GOOGLE_CALENDAR_SA_EMAIL` | the service account's email |
| `GOOGLE_CALENDAR_SA_PRIVATE_KEY` | the PEM `private_key` from the JSON key. A single line with the literal two characters `\n` between lines (exactly as in the JSON file); the website turns them back into newlines |
| `GOOGLE_CALENDAR_WEBHOOK_SECRET` | `openssl rand -hex 32` |

```bash
vercel env add GOOGLE_CALENDAR_SYNC_ENABLED production
vercel env add GOOGLE_CALENDAR_ID production
vercel env add GOOGLE_CALENDAR_SA_EMAIL production
vercel env add GOOGLE_CALENDAR_SA_PRIVATE_KEY production
vercel env add GOOGLE_CALENDAR_WEBHOOK_SECRET production
```

- **Production only. Never Preview or Development.** The preview database is a copy of
  production with real customers: with the variables present it would write their names and
  phone numbers to the salon's calendar. The code also switches the sync off whenever
  `VERCEL_ENV` is `preview`, whatever the variables say, but do not rely on that alone.
- **Keep them Sensitive** (the team's default for new variables; never add these with
  `--no-sensitive`). They hold the service account's key and the webhook secret, and only
  the runtime reads them, never the build, so the `[SENSITIVE]` placeholder a build would
  see does not matter here.
- A missing or blank variable means the sync stays off: no Google call, no database read
  from the webhook (it answers 404).
- **Depends on `CALENDAR_SYNC_ENABLED=true`.** The 30-minute retry of failed writes, the
  pickup of cron-made changes (lapses, late cancellations) and the safety-net pull for a
  missed notification all run inside the calendar-sync cron, which does nothing unless
  `CALENDAR_SYNC_ENABLED` is `true` and only runs in saved staff hours (±15 minutes).
  Outside those hours (and with it off) only the webhook's pulls and housekeeping's daily
  03:15 UTC run remain.
- Env changes reach the runtime only after a **redeploy** (merge a commit to `main`; production
  is deployed by GitHub Actions only, never `vercel --prod`).
- **Migration:** the production deploy applies `20261016150000_google_calendar_sync` and
  `20261017120000_google_diary_mirror` itself. Apply them to the **preview** database by hand
  after the merge (`pnpm db:vercel:deploy` with the preview env), or every PR's "Deploy
  Preview" fails (`docs/agents/neon-budget.md`, "Preview deployments").
- The webhook needs the public URL `https://www.harbourhair.co.uk/api/webhooks/google-calendar`
  to stay reachable: Google cannot pass a challenge, so no Vercel Firewall rule or bot
  protection may challenge or deny it (`infra/vercel-firewall/README.md`).

---

## 4. First run and verification

1. Redeploy (§3), then sign in as an admin: **Admin → Integrations → Google Calendar**. It
   should say "Google Calendar sync is on" with the first characters of the calendar id.
2. Press **Sync now** (takes up to a minute). It makes the notification channel, writes every
   booking in the window to Google and reads Google once. Expect "Google Calendar sync
   finished." and a channel expiry about 7 days away. Reload: "Bookings Google would not take"
   must be 0.
3. **The diary.** Open **Admin → Schedule** on a week you know well: every HarbourHair event
   appears with the same title and colour as in Google; customers in their stylist's column,
   red events in "No stylist", notes in the strip above the grid.
4. **A red event takes a chair.** Find a red (no-stylist) event at a time when only one
   stylist works and is free: that stylist's slot is shown taken in the slot grid (`/book`,
   once booking is open). While booking is closed in production, start a phone booking for
   that stylist at that time in Admin → Schedule instead: it warns "Leaves too few stylists
   for the Google diary's bookings without a stylist" with "Book anyway". Do not book it.
5. **Booking to Google.** Make a test booking (Admin → Schedule → a phone booking is enough).
   Within seconds an event for it appears in HarbourHair with the right stylist and time, **in
   that stylist's Google colour**. Cancel it: the event disappears from Google.
6. **Leave to booking.** In HarbourHair add a Graphite event titled **`Ivan off test`** for a
   slot in the next few days, with a stylist's name or Google name in place of `Ivan` (§1 lists
   how names are read). Within about a minute it shows in that stylist's column in Admin →
   Schedule, the slot is blocked, and the stylist's Fresha calendar shows it as **Busy** on
   Fresha's own import schedule, after the busy feed refreshes. Delete the event: the slot
   reopens.
7. Check Admin → Operations shows no Google problem.
8. **Retire the old calendar — switch it off, do not delete it** (owner's preference). Signed in as
   harbourhairuk@gmail.com, on **"Harbour website bookings"** (never HarbourHair): Settings →
   Share with specific people → remove `harbour-website-calendar@…` (✕), then untick it under
   My calendars. Both can be undone. Done 2026-10-17: it had 0 events, the service account now
   gets 404 for it, and HarbourHair is unaffected.

**Fresha:** link each stylist's Fresha calendar import to their **own** Google calendar if
they use one, **never** to HarbourHair. Importing HarbourHair into Fresha would hand every
customer's name and phone number to Fresha; the busy time already reaches Fresha through each
stylist's busy feed. Nor may Fresha's Google sync, or any other app's, write **into**
HarbourHair: only staff write to it (§2.6).

---

## 4a. Changing the calendar

`GoogleCalendarSyncState.calendarId` records which calendar the website's own records belong to
(which bookings it wrote, and its watch channel). When `GOOGLE_CALENDAR_ID` names another
calendar, or none is recorded yet (the first run after the diary mirror shipped), the next run
(the push, a pull, the 30-minute run or Sync now) starts over once
(`services/google-calendar-guard.ts`):

- it forgets which bookings were written and the watch channel, then writes every booking in
  the window (7 days back onwards) to the new calendar;
- **Sync now** (or the 03:15 UTC run) then watches the new calendar;
- the old channel is forgotten **without being stopped**: it keeps watching the old calendar
  until it expires, within 7 days. A change there only makes the website read the configured
  calendar once more, which is harmless, and nothing at all once the old calendar is unshared;
- **events in the old calendar are never deleted** by the website: switch that calendar off by
  hand once the new one is verified (§4.8).

To change it: replace `GOOGLE_CALENDAR_ID` on Production, redeploy, reload Admin →
Integrations (the new id's first characters), press Sync now, verify (§4).

---

## 5. Rotating the webhook secret

Changing `GOOGLE_CALENDAR_WEBHOOK_SECRET` invalidates the token of the **live** notification
channel (the token is signed under the secret): Google's notifications are refused (401)
until the channel is replaced, and **Sync now replaces it at once**.

1. Replace the variable (`vercel env rm GOOGLE_CALENDAR_WEBHOOK_SECRET production`, then `add`)
   and redeploy.
2. Press **Admin → Integrations → Sync now** as soon as the deploy is live. It makes a new
   channel under the new secret and stops the old one; the rotation takes effect there.
   Between the redeploy and Sync now, notifications are refused and changes made in Google
   reach the website only through the 30-minute calendar-sync pull (staff hours only, §3).

Rotating the service-account key: create the new key (§2.3), replace
`GOOGLE_CALENDAR_SA_PRIVATE_KEY`, redeploy, press Sync now, then delete the old key in Google
Cloud.

---

## 6. Turning it off

1. Set `GOOGLE_CALENDAR_SYNC_ENABLED` to anything but `true` (or remove it) on Production and
   redeploy. Everything stops: no push, no pull, no channel renewal, no Google call. Google
   may keep sending notifications until the channel expires (about 7 days); each gets a
   **404** before any database access, so it costs no Neon wake.
   **Turning it back on** needs a redeploy with the variable set to `true`, then **Sync now**
   (it makes a new channel at once and catches up the whole window).
2. **Clear the busy time read from Google.** Turning the sync off stops reading Google, but
   the busy time already read from it stays. It keeps blocking those hours on `/book` (and the
   diary stays on Admin → Schedule, its walk-ins still taking chairs). It also stays in each
   stylist's busy feed, **so Fresha keeps those hours blocked too**, until each period has passed. To undo that at once, press **Admin →
   Integrations → Google Calendar → Clear Google busy time and diary copy**.
   - Administrators only. It asks to confirm, and the audit log records it as
     `INTEGRATION.GOOGLE_BUSY_CLEARED`, with the number of periods removed (`removed`) and of
     diary entries removed (`diaryRemoved`).
   - It deletes every busy period read from Google. Fresha and Treatwell busy time is untouched.
   - It also deletes the website's copy of the diary: Admin → Schedule stops showing it, and
     walk-ins stop taking chairs.
   - It refreshes the busy feeds, so Fresha frees the hours on its next import.
   - Bookings are not affected.

   The button also works while the sync is on. Then, though, the next check of Google (a
   change in Google, or the 30-minute run) reads the calendar's busy time and diary again.
   Even if it is never pressed, housekeeping (daily, 03:15 UTC) deletes each diary entry 30
   days after it ends, with the sync off too.
3. There is no "stop channel" button. If you want the channel stopped cleanly rather than
   left to run out, ask a developer to stop it while the variables are still set.
4. Events the website wrote stay in HarbourHair, with their customer details, and nothing
   deletes them any more once the sync is off. HarbourHair is the salon's own diary and cannot
   be deleted like "Harbour website bookings" could, so **when the sync is turned off for good,
   delete the website's events by hand** as each passes 12 months after its appointment (they
   are titled `Stylist · Customer · Service` and their description ends "Change this booking
   in Admin. Changes made here are undone."): otherwise the copies outlive the 12 months the
   privacy notice promises. Removing the service account's access alone does not remove them.

---

## 7. What staff see when something fails

- **Admin → Integrations → Google Calendar:**
  - on/off, the calendar id (first characters only) and the channel expiry;
  - the last check of Google and its last problem (`GOOGLE_PULL_FAILED`);
  - "Bookings Google would not take": a count of bookings whose Google copy is failing.
    That covers a write that failed or was refused (`GOOGLE_PUSH_FAILED`,
    `GOOGLE_PUSH_REFUSED`) and an event Google did not keep as written
    (`GOOGLE_EVENT_NOT_KEPT`). These are per booking: they appear nowhere else.
- **Admin → Operations** and the **daily "needs attention" email** (when notifications are
  on) show two job rows, each with one sentence while it is failing.
  - **Rows.** `google-calendar` is the 30-minute run. `google-calendar-daily` is
    housekeeping at 03:15 UTC and Sync now. A night's failure stays on the daily row,
    whatever the 30-minute runs do after it.
  - **Sentences**, most urgent first:
    - `GOOGLE_SYNC_FAILED`: a push or pull could not complete, or Google refused the
      website's access. The push then stops at the first booking instead of trying every one.
    - `GOOGLE_PULL_STALE` (30-minute row): no check of Google has succeeded for 24 hours.
    - `GOOGLE_CHANNEL_FAILED` (daily row): the notification channel could not be made.
    - `GOOGLE_CHANNEL_MISSING` (30-minute row): there is no live notification channel.
      Sync now makes one.
    - `GOOGLE_EVENTS_FAILED`: the run ended with bookings Google would not take (see the
      count on Integrations).
  - The health checks behind `GOOGLE_PULL_STALE` and `GOOGLE_CHANNEL_MISSING` run in the
    30-minute run only. They need `CALENDAR_SYNC_ENABLED=true` (§3) and staff hours.
- **Bookings are never affected.** A booking, cancellation or reschedule succeeds even when
  Google is down; its Google copy is retried by the calendar-sync cron.
- **Before the 7-day window.** A booking more than a week in the past is retried five times
  only. After that it stays counted under "Bookings Google would not take" until its copy is
  deleted at 12 months. A change to such a booking is not written to Google at all: the sync
  only follows bookings from a week back onwards. The exception is an erased customer, whose
  copy is retried until it lands.
- Common causes: the calendar is not shared with the service account (403/404), the private
  key lost its `\n` escapes, the Calendar API is not enabled, or the secret was rotated
  without pressing Sync now (§5). After fixing the setup, press **Sync now**: it rewrites the
  whole window, including bookings a stopped run never reached.

---

## 8. Privacy and erasure

- The Google copy holds the customer's name, phone number, booking details and notes: the
  privacy notice says so and that copies are kept up to **12 months after the appointment**.
  A copy the website deletes goes to Google Calendar's bin first. Google removes it from
  there after about 30 days; the notice says that too.
- Erasing a customer (Admin → Users, `docs/data-erasure.md`) re-renders their events with the
  anonymised name and without phone or notes; if Google is unreachable the calendar-sync cron
  retries.
- **The diary copy** (`GoogleDiaryEntry`) holds the titles staff type in HarbourHair, which may
  hold customers' names and phone numbers, with their times and colours. It is admin-only (Admin
  → Schedule; never a public page, the busy feed or an email) and each entry is deleted 30 days
  after it ends, by the pull and by housekeeping (also with the sync off). The privacy notice
  says so (`legal.privacy.retention.googleDiary`). Erasure cannot find a customer in it:
  see `docs/data-erasure.md`.

## 9. The Fresha mirror calendar (Fresha → Google, optional)

So staff can see Fresha's bookings and blocked time in Google Calendar while they get used to
the website, the Fresha watch (`/api/cron/fresha-watch`) copies each stylist's Fresha busy
times into a **separate** calendar within about a minute of the change. Titles are
"<stylist> · Fresha booking" or "<stylist> · Fresha blocked time" (Fresha's export never
carries a customer's details), in the stylist's Google colour. Spec:
`docs/superpowers/specs/2026-10-26-fresha-watch-and-google-mirror-design.md`.

1. Signed in as **harbourhairuk@gmail.com**, Google Calendar → Other calendars → **+** →
   Create new calendar, e.g. **"Fresha（自動同步）"**.
2. Its Settings and sharing → Share with specific people → the service account
   (`harbour-website-calendar@harbourhair-511821.iam.gserviceaccount.com`) with
   **Make changes to events** (變更活動). Staff who should see it get **See all event details**.
3. Settings → Integrate calendar → copy the **Calendar ID** (`…@group.calendar.google.com`).
4. Vercel → Production only: `GOOGLE_FRESHA_MIRROR_CALENDAR_ID` = that id, and
   `FRESHA_WATCH_ENABLED` = `true` (the watch itself). Redeploy (merge to `main`).
5. Check: the next Fresha change shows in the new calendar within a minute or two; Vercel logs
   show `/api/cron/fresha-watch` answering 200 with `"mirrored"` above 0 after a change.

- **Never use HarbourHair (`GOOGLE_CALENDAR_ID`) for this.** The website reads HarbourHair back:
  the copies would become GOOGLE busy time and go back to Fresha. The code refuses that id.
- **Read-only copies.** Change bookings in Fresha; a copy edited or deleted in Google is written
  back at the next change of that stylist's Fresha feed. Past copies are left as they were.
- **Stop copying Fresha bookings into HarbourHair by hand** once this runs: a hand-made copy in
  red (no stylist) takes a walk-in chair on top of the Fresha block (the diary chair rule).
- Turning it off: delete `GOOGLE_FRESHA_MIRROR_CALENDAR_ID` (the watch keeps importing) or set
  `FRESHA_WATCH_ENABLED` to anything but `true` (both stop; the half-hourly import goes on).
  The copies already made stay in the calendar until someone hides or deletes it.
