# Google Calendar two-way sync — design

**Status:** design approved in conversation 2026-10-16, awaiting written-spec review
**Origin:** owner request 2026-10-16: "connect Google Calendar to harbourhairuk@gmail.com"
**Supersedes:** phase 3 of `2026-09-29-booking-slot-hold-and-live-sync-design.md` (§4)
**Depends on:** `2026-10-16-late-arrival-auto-cancel-design.md` (its cancel/restore
are appointment changes this sync must mirror; build that first)

## 1. Problem

The salon wants the website's bookings in its own Google Calendar
(harbourhairuk@gmail.com) as they happen, and wants time it adds in Google to
stop the website selling that time. Today the only link is the per-stylist busy
feed, which Google refreshes every 12–24 hours and which shows "Busy" only.

## 2. Decisions (owner, 2026-10-16)

| # | Question | Decision |
|---|---|---|
| D1 | Feed subscription, detailed feed, or API? | **Real-time Google Calendar API.** |
| D2 | Direction | **Two-way.** |
| D3 | Calendars | **One shared calendar** for all stylists ("Harbour website bookings"). |
| D4 | Event content | **Name + service + phone + status.** Requests not yet confirmed are marked. |
| D5 | Google-only events | **Title starting with a stylist's name blocks that stylist; otherwise the whole salon.** "Show as: Available" events block nothing. |
| D6 | A website booking edited or deleted in Google | **The website wins:** the event is written back to the booking's real state. Bookings change only in Admin (deposits, customer emails, Fresha feed). |
| D7 | Fresha | Not written by the website. Fresha's own Google link, if the owner wants it, goes to **separate calendars** in the same Google account, never the shared one (Fresha would import the shared calendar's events as every linked stylist's blocked time). |

Rejected: OAuth as the Gmail account (consent screen, unverified-app warning,
tokens revoked by a password change); one calendar per stylist (owner chose one);
applying Google edits to bookings (bypasses clash checks, deposits and emails).

## 3. Connection

- **Service account** in the Google Cloud project that holds the Google sign-in
  client, with the Calendar API enabled. The owner creates the calendar
  "Harbour website bookings" in harbourhairuk@gmail.com and shares it with the
  service account's address ("Make changes to events").
- Auth: a signed JWT (RS256, `jose`, already a dependency) exchanged at
  `https://oauth2.googleapis.com/token` for an access token, scope
  `https://www.googleapis.com/auth/calendar.events`; cached in memory until a
  minute before expiry. REST calls with a timeout; no Google SDK dependency.
- Env (Production only; read inside functions, never at module level):
  `GOOGLE_CALENDAR_SYNC_ENABLED` (`"true"` = on), `GOOGLE_CALENDAR_ID`,
  `GOOGLE_CALENDAR_SA_EMAIL`, `GOOGLE_CALENDAR_SA_PRIVATE_KEY`,
  `GOOGLE_CALENDAR_WEBHOOK_SECRET`. **Previews never get them**: the preview
  database is a copy of production with real customers, and a preview must not
  write to the salon's calendar. Unset or incomplete config = sync off.

## 4. Data model

All three schemas, one migration each, preview DB by hand.

```prisma
/// The Google event mirroring one appointment (calendar sync).
model GoogleCalendarEvent {
  appointmentId String      @id
  appointment   Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  /// Deterministic: "hh" + hex(sha256(appointmentId))[0..40] — valid base32hex.
  eventId       String      @unique
  /// Hash of the event body last written; differs → the event needs writing.
  syncedHash    String?
  syncedAt      DateTime?
  /// True once the event was deleted because the booking closed.
  removed       Boolean     @default(false)
  attempts      Int         @default(0)
  lastError     String?
  updatedAt     DateTime    @updatedAt
}

/// Singleton: the push channel and the last inbound pull.
model GoogleCalendarSyncState {
  id                String    @id @default("singleton")
  channelId         String?
  resourceId        String?
  channelExpiresAt  DateTime?
  lastPullAt        DateTime?
  lastPullSuccessAt DateTime?
  lastPullError     String?
  /// Hash of the GOOGLE busy blocks last stored; equal → no DB write.
  busyHash          String?
}
```

Google-only events become `ExternalBusyBlock` rows with `source='GOOGLE'`,
keyed `(source, stylistId, externalUid)` like the iCal imports;
`summary` stays null (titles are free text, possibly customer names). Google is
NOT a `CalendarConnection` and NOT in `CALENDAR_PROVIDERS`: a connection row
would be refused by `evaluateSyncCoverage` (`PROVIDER_UNSUPPORTED`) and close
online booking. The admin board's label gains a "Google" branch.

## 5. Website → Google (outbound)

**Rendering** (`services/google-calendar-event.ts`, pure):
- Title: `{stylist} · {customer name} · {service}`; a PENDING request is prefixed
  `[Request]` / `[待確認]`. Language: `SiteSettings.salonNotificationLocale`.
- Description: phone, customer notes, status, deposit state, the admin link to
  the day, and "Change this booking in Admin — changes made here are undone."
- Start/end from `date` + duration; `colorId` per stylist (fixed order 1–11);
  `extendedProperties.private.harbourAppointmentId`; `transparency: opaque`.
- Erased (anonymised) customers render with the anonymised name.

**Which appointments:** start ≥ today − 7 days. PENDING and CONFIRMED → present;
COMPLETED → present (history); CANCELLED → deleted from Google.

**Real time:** every server action that changes an appointment's time or
status already calls `invalidateStylistIcalFeed()` (no arguments: the feed tag is
global) after its commit. That helper also schedules, through `after()`,
`pushGoogleCalendar()`: render the appointments updated in the last 45 minutes
(plus any never synced or failed) and write those whose hash differs. Mutations
that change only event text (reschedule request/withdraw/decline, erasure) call
`scheduleGoogleCalendarPush()` directly. Cron-side changes
(`invalidateStylistIcalFeedFromCron`: lapses, late cancellations) are picked up
by the same cron run (§7).

**Writes:** `PUT events/{eventId}`; 404 → `POST` with the id; 409 on insert →
`PUT` (a deleted event with that id is restored by `status: confirmed`). Delete =
`DELETE` (404/410 = done). Success stores hash and time; failure increments
`attempts`, stores a catalogued `lastError`, retried by the next cron run.
Google is never called inside a transaction.

## 6. Google → website (inbound)

**Push:** `events.watch` on the calendar → `POST /api/webhooks/google-calendar`.
Before any DB access the route checks the sync is enabled (404 if not) and that
`X-Goog-Channel-Token` equals `HMAC(secret, X-Goog-Channel-ID)` (401 if not).
`X-Goog-Resource-State: sync` → 200, nothing else. Otherwise it answers 200 and
runs `pullGoogleCalendar()` in `after()`, single-flight through a short Redis
lock (a burst of our own writes triggers a burst of pushes; one trailing re-run
covers changes during a pull).

**Pull:** `events.list` with `timeMin = now − 1 day`, `timeMax = now + 90 days`,
`singleEvents=true`, `showDeleted=true`, all pages.

- **Website events** (`harbourAppointmentId` present): compare with the
  rendered booking. Moved, edited or deleted while the booking is open → write
  the rendered version back (D6). Equal → nothing. A cancelled event whose
  booking is closed → nothing.
- **Echo guard:** booking availability reads every `ExternalBusyBlock` with
  no source filter, so a website event imported as a block would make every
  booking clash with itself. An event carrying `harbourAppointmentId` is never
  a block, whatever its state; a test pins this.
- **Google-only events** (confirmed, `transparency` ≠ `transparent`):
  - Stylist: the title starts with an active stylist's name, case-insensitive,
    followed by end, space, `:`, `-`, `·` or `：` (longest name first) → that
    stylist; no match → every active stylist.
  - All-day events cover salon-local midnight to midnight (DST-correct).
  - The set of blocks is hashed; equal to `busyHash` → no DB write. Otherwise one
    transaction replaces every `GOOGLE` block in the window (as the iCal sync
    does), stores the hash, and the affected stylists' busy feeds are
    invalidated (`…FromCron`: a route handler cannot `updateTag`).
- `lastPullAt` / `lastPullSuccessAt` / `lastPullError` record the outcome.

**Effect of a GOOGLE block:** booking availability, the admin board (labelled
"Google") and clash checks treat it like a Fresha block.

**Change from the chat design (needs the owner's OK at spec review):** the chat
design kept GOOGLE blocks out of the outbound busy feed, as FRESHA blocks are.
That leaves a gap: "Ivan: dentist" added in Google would stop the website
selling the time but not Fresha. This spec instead exports GOOGLE blocks in the
stylist's busy feed, so Fresha stops selling that time too. It is safe from echo
loops: Fresha never re-exports imported events (verified 2026-09-29), and the
website never imports its own feed. FRESHA blocks stay out of the outbound feed,
as today. If the owner prefers the chat design, drop this paragraph's export.

## 7. Schedules (no new cron)

- **calendar-sync cron** (`*/30`, staff hours, DB already awake): after the feed
  sync and late-arrival step, `pushGoogleCalendar()` for every dirty/failed
  appointment and a `pullGoogleCalendar()` safety net.
- **housekeeping** (daily 03:15 UTC): renew the watch channel within 48 hours
  of its expiry (new channel, then `channels.stop` the old one), a full outbound reconciliation of the
  window (re-renders everything, so customer name/phone edits land within a
  day), and deletion of events for appointments that left the window per §9.
- Admin → Integrations: Google Calendar status (enabled, calendar id, channel
  expiry, last pull, failed events) and a **Sync now** button (admin-only,
  audited) that replaces the channel at once (so a rotated webhook secret takes
  effect), pushes and pulls.

## 8. Failure and attention

- Every fixed `lastError` sentence is catalogued in `operations-messages.ts`.
- The daily ops alert and Admin → Operations list: events failing for over
  2 hours, a watch channel expired or missing while enabled, no successful pull
  for 24 hours.
- Online-booking readiness does NOT depend on Google (it is the salon's own
  diary, not a sales channel); a failing pull is an attention item.

## 9. Privacy

- The privacy notice (en + zh) adds Google (calendar hosting) as a processor of
  the customer's name, phone, booking and notes, kept in the salon's calendar.
- Erasure re-renders the customer's events with the anonymised name.
- Retention: booking records are kept up to 6 years (privacy notice), but the
  Google copy is a working diary. Housekeeping deletes Google events for
  appointments that ended more than **12 months** ago, and the notice says so
  ("Copies in the salon's Google Calendar: up to 12 months after the
  appointment"). Owner may change the period at spec review.

## 10. Testing

- Unit: event rendering (both languages, PENDING marker, anonymised customer);
  event id format; stylist-prefix matching (case, separators, Chinese colon,
  longest name, no match → all); all-day DST; hash equality → no write; the
  write state machine (404 → insert, 409 → put, delete 404/410); revert of a
  moved/deleted website event; webhook: disabled → 404 and bad token → 401
  without DB, `sync` → no pull; JWT assertion fields; config parsing (incomplete
  → off).
- Route/cron: Google steps run after the existing ones and never when gated.
- Integration (real PostgreSQL, Google faked at the fetch seam): GOOGLE blocks
  replace atomically and block a slot; the busy feed exports them.

## 11. Rollout

1. Merge (sync off: no env yet). Migration on production via the deploy; preview DB by hand.
2. Google Cloud: enable the Calendar API, create the service account and key.
3. harbourhairuk@gmail.com: create "Harbour website bookings", share it with the
   service account ("Make changes to events"), copy its calendar ID.
4. Vercel **Production** env (sensitive is fine: runtime only), redeploy.
5. Admin → Integrations → Sync now; check one booking appears, one Google test
   event blocks a slot, then delete the test event.
