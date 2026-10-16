# Google Calendar two-way sync: runbook

How the website shares the salon's appointment diary with Google Calendar, how to set it up
(Google Cloud, the calendar, Vercel), how to check it works, and what to do when it does not.

- **Design (decisions and reasons):** `docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md`.
- **Customer-facing text:** `/privacy` (Google Calendar under "Who we share it with" and "How long we keep it").
- **Ships OFF.** Nothing happens until all five variables in §3 are set on Vercel **Production**.

---

## 1. What it does

- **Website to Google (push).** Every booking that is not cancelled is written as one event
  on one shared calendar, "Harbour website bookings": titled `Stylist · Customer · Service`
  (a pending request is marked), with the phone number, notes, status, any open reschedule
  request, deposit state and a link to the day in Admin. A change
  reaches Google within seconds (after the response of the action that made it); the
  calendar-sync cron (every 30 minutes in staff hours) retries failures and catches
  cron-made changes (lapses, late cancellations); housekeeping (daily, 03:15 UTC) re-renders
  the whole window and deletes copies of appointments that ended more than **12 months** ago.
- **Google to website (pull).** Anyone at the salon can add an event to that calendar whose
  title starts with a stylist's name **exactly as it is in Admin → Stylists** (the whole name:
  for "Lox Chan", `Lox Chan: dentist`; case does not matter). It blocks that stylist's hours
  on `/book`, and is exported in that stylist's outbound busy feed, so Fresha stops selling
  the hour too. After the name only these are accepted: the end of the title, a space, `:`,
  `：`, `-` or `·` (`Ivan`, `Ivan dentist`, `Ivan: dentist`, `Ivan：午飯`, `Ivan - holiday`,
  `Ivan·off`).
  **Anything else blocks the WHOLE salon, every stylist**: `Ivan, off`, `Ivan's party`,
  `Ivana`, `Dentist (Ivan)` all name nobody. A title that names nobody, or no title, blocks
  every stylist (that is how to close the salon, e.g. `Stock take`).
  Tentative events still block; cancelled events and events marked "Show as: Available" do not.
- **The website's own events are never blocks**, and an edit or deletion of one in Google is
  reverted (the website is the authority for bookings). If Google keeps changing an event
  the website writes it back at most once every 10 minutes and shows "Google Calendar did
  not keep the event" in Operations.
- **Real time.** Google calls `POST /api/webhooks/google-calendar` for every change; the
  website answers at once and pulls afterwards, one pull at a time. If a notification is
  missed, the 30-minute calendar-sync run (staff hours, §3) pulls anyway.

Google is **not** a calendar connection in Admin → Integrations (no per-stylist links); that
page only shows its status and a "Sync now" button.

---

## 2. Google Cloud and the calendar (one-off)

1. **Google Cloud Console** → the project that already holds the Google sign-in client
   ("Continue with Google"). APIs & Services → Library → **Google Calendar API** → Enable.
2. APIs & Services → Credentials → Create credentials → **Service account**. Name it
   `harbour-website-calendar`; no project roles are needed. Copy its email
   (`…@….iam.gserviceaccount.com`): this is `GOOGLE_CALENDAR_SA_EMAIL`.
3. The service account → Keys → Add key → Create new key → **JSON**. The download holds the
   `private_key` (a PEM). **Never commit this file** or paste it into a chat, a ticket or
   the repo; delete the download once it is in Vercel (§3).
4. Sign in to Google Calendar as **harbourhairuk@gmail.com** (the salon's account):
   - Other calendars → Create new calendar → name it **Harbour website bookings**.
   - Its Settings and sharing → **Share with specific people** → add the service account's
     email with the permission **Make changes to events**.
   - Same page → Integrate calendar → copy the **Calendar ID**
     (`…@group.calendar.google.com`): this is `GOOGLE_CALENDAR_ID`.
5. Staff who want to add busy time need access to that calendar too (share it with them,
   "Make changes to events"). They add events there, not on their own calendars.

---

## 3. Vercel environment, PRODUCTION ONLY

| Variable | Value |
|---|---|
| `GOOGLE_CALENDAR_SYNC_ENABLED` | `true` (kill-switch: anything else, or unset, turns everything off) |
| `GOOGLE_CALENDAR_ID` | the Calendar ID from §2.4 |
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
- Sensitive is fine (these are read at runtime only, never by the build).
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
- **Migration:** the production deploy applies `20261016150000_google_calendar_sync` itself.
  Apply it to the **preview** database by hand after the merge (`pnpm db:vercel:deploy` with the
  preview env), or every PR's "Deploy Preview" fails (CLAUDE.md, "Preview deployments").
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
3. **Booking to Google.** Make a test booking (Admin → Schedule → a phone booking is enough).
   Within seconds an event for it appears on "Harbour website bookings" with the right
   stylist and time.
4. **Google to booking.** In that calendar add an event titled **`Ivan: test`** for a slot in
   the next few days, with the stylist's name **exactly as in Admin → Stylists** in place of
   `Ivan` (the whole name, followed by `:`; §1 lists what may follow it: anything else, e.g.
   `Ivan, test`, blocks the **whole salon**). Within about a minute that stylist's slot is
   greyed out for that time on `/book` (booking may still be closed in production: check
   Admin → Schedule, or `/book` on a day it is open), and the stylist's Fresha calendar
   shows it as **Busy** on Fresha's own import schedule, after the busy feed refreshes
   (Fresha imports the website's busy feed).
5. **Clean up.** Delete the `Ivan: test` event, then cancel the test booking. Both events
   disappear from Google; the slot reopens.
6. Check Admin → Operations shows no Google problem.

**Fresha:** link each stylist's Fresha calendar import to their **own** Google calendar if
they use one, **never** to the shared "Harbour website bookings" calendar. Importing the
shared calendar into Fresha would hand every customer's name and phone number to Fresha.

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
2. There is no "stop channel" button. If you want the channel stopped cleanly rather than
   left to run out, ask a developer to stop it while the variables are still set.
3. Events already in Google stay there, with their customer details, and nothing deletes them
   any more once the sync is off. **When the sync is turned off for good, delete the "Harbour
   website bookings" calendar** (signed in as the salon's account): otherwise the copies
   outlive the 12 months the privacy notice promises. Removing the service account's access
   alone does not remove them. Google busy blocks already read stay on the website until
   their time has passed.

---

## 7. What staff see when something fails

- **Admin → Integrations → Google Calendar:** on/off, calendar id (first characters only),
  channel expiry, last check of Google and its result, and "Bookings Google would not take"
  (rows failing to write).
- **Admin → Operations** and the **daily "needs attention" email** (when notifications are
  on): the job `google-calendar` lists, while it is failing: a booking that could not be
  written (`GOOGLE_PUSH_FAILED` / `GOOGLE_PUSH_REFUSED` / `GOOGLE_EVENTS_FAILED`), a pull that
  could not complete (`GOOGLE_PULL_FAILED`, `GOOGLE_SYNC_FAILED`), notifications that could
  not be set up (`GOOGLE_CHANNEL_FAILED`), and an event Google would not keep as written
  (`GOOGLE_EVENT_NOT_KEPT`).
- **Bookings are never affected.** A booking, cancellation or reschedule succeeds even when
  Google is down; its Google copy is retried by the calendar-sync cron. A booking more than a
  week in the past is retried five times only; after that it stays counted under "Bookings
  Google would not take" until it changes again or its copy is deleted at 12 months (an
  erased customer's copy is retried until it lands).
- Common causes: the calendar is not shared with the service account (403/404), the private
  key lost its `\n` escapes, the Calendar API is not enabled, or the secret was rotated
  without pressing Sync now (§5).

---

## 8. Privacy and erasure

- The Google copy holds the customer's name, phone number, booking details and notes: the
  privacy notice says so and that copies are kept up to **12 months after the appointment**.
- Erasing a customer (Admin → Users, `docs/data-erasure.md`) re-renders their events with the
  anonymised name and without phone or notes; if Google is unreachable the calendar-sync cron
  retries.
