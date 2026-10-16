# Google diary colour mirror — design

Status: approved in conversation 2026-10-17 (owner: "ok"); this document records it.
Builds on: `2026-10-16-google-calendar-two-way-sync-design.md` (#72, live since 2026-10-16).
Runbook to update: `docs/google-calendar-setup.md`.

## 1. Problem

The salon runs its real appointment book in Google Calendar: the **"HarbourHair"** primary
calendar of harbourhairuk@gmail.com. Every customer is an event, coloured by stylist, with the
customer's name or phone number in the title. #72 synced a separate, empty calendar ("Harbour
website bookings") instead, so:

- Admin → Schedule shows none of the salon's real appointments;
- online booking (once open) would offer times that are already taken in the diary;
- staff would have to keep two calendars.

The owner wants Admin → Schedule to look like their Google Calendar — same titles, same colours —
and the website to respect it.

## 2. Decisions (owner, 2026-10-17)

| # | Decision |
|---|---|
| D1 | Read the **primary "HarbourHair" calendar** (`harbourhairuk@gmail.com`). |
| D2 | **Colour = stylist.** Lavender (Google colour 1) = Ivan, Sage (2) = Funky, Banana (5) = Lox. Shania has no colour. |
| D3 | **Tomato (11) = no stylist assigned** (walk-in "(W)", Treatwell "TW", …). It **takes one chair**: online booking must leave enough free stylists for it. |
| D4 | **Graphite (8) = leave.** A leave event, or an event of any other colour, whose title names a stylist (name or alias) blocks that stylist: "Ivan off", "FunkyOff(F)", "早走(L)", "遲返 (L)(F)", "天off" (天 = Shania). |
| D5 | Any other event whose title names no stylist (e.g. "卡機", "檢查消防", "見工 zayn", "GhD Con") is **shown only**: it blocks nothing. |
| D6 | Website bookings are written **into the primary calendar**, coloured by their stylist. "Harbour website bookings" is retired. |
| D7 | Admin → Schedule shows Google events with their **Google title and colour**; red ones in an extra "No stylist" column. Read-only in Admin; edit in Google. |
| D8 | Red events are **not** sent to Fresha (Fresha does not see them today either); stylist-coloured and named-leave events keep going to that stylist's Fresha feed (as #72). |

Deviation recorded: the conversation said "Anyone" bookings would be red. A website booking always
has a stylist (an "Anyone" request is assigned one when it is made), so it carries **that
stylist's colour**. A stylist with no colour set falls back to tomato.

## 3. Configuration

Pre-filled with D2–D4 by the rollout (§10); editable afterwards.

- **Admin → Stylists**, per stylist:
  - **Google colour** — one of Google's 11 event colours, or none. Unique among active
    stylists (the form refuses a colour another active stylist holds).
  - **Google names** — extra names the diary uses for this stylist, comma-separated
    (Funky: `F`; Lox: `L`; Shania: `天`). The stylist's own name always counts.
- **Admin → Integrations → Google Calendar**:
  - **No-stylist colour** (default Tomato, 11);
  - **Leave colour** (default Graphite, 8).

Data model:

- `Stylist.googleColorId String?` (Google colour id "1"–"11") and
  `Stylist.googleAliases String?` (comma-separated).
- `SiteSettings.googleUnassignedColorId String @default("11")`,
  `SiteSettings.googleLeaveColorId String @default("8")`.
- In Admin, a stylist's block colour is their Google colour when set (it replaces
  `calendarColor` on the board), so the board matches Google. The Google palette is added to
  `lib/calendar-colors.ts` with every class written out in full (Tailwind arbitrary values,
  e.g. `bg-[#7986cb]`), per that file's rule. Admin-only, as the rest of that palette; the
  public site stays monochrome.

Colours in the real diary, 30 days back to 90 ahead on 2026-10-17: 1 ×64, 2 ×56, 5 ×82,
8 ×90, 11 ×99, none ×6.

Google's event palette (id → name → hex): 1 Lavender #7986cb, 2 Sage #33b679, 3 Grape #8e24aa,
4 Flamingo #e67c73, 5 Banana #f6bf26, 6 Tangerine #f4511e, 7 Peacock #039be5, 8 Graphite
#616161, 9 Blueberry #3f51b5, 10 Basil #0b8043, 11 Tomato #d50000. An event with no `colorId`
takes the calendar's colour: shown in a neutral grey, classified by D4/D5.

## 4. Classifying a diary event (pure function)

`classifyDiaryEvent(event, config) → { kind, stylistIds }`, in order:

1. The website's own event (private property or `hh…` id, as #72) → skipped entirely.
2. `status: cancelled` → skipped.
3. `colorId` = a stylist's Google colour → **STYLIST** (that stylist).
4. `colorId` = the no-stylist colour → **UNASSIGNED**.
5. Otherwise (leave colour, other colours, no colour) → names in the title:
   - matched stylists → **LEAVE** (those stylists; "遲返 (L)(F)" names two);
   - none → **NOTE**.
6. `transparency` ("Show as available") is **ignored**: it neither changes the kind nor stops
   an event blocking. Verified 2026-10-17 against the real diary (397 events in the window):
   all 41 transparent events are Graphite leave ("天off", "lox off", "LoxOff", "Day off lox"),
   because Google makes all-day events "available" by default. #72's "available events never
   block" rule is dropped; the runbook says so.

**Name matching** (case-insensitive), per stylist over its name plus aliases:

- A Latin alias of one letter matches only in parentheses: `(F)`, `( F )`.
- A longer Latin name matches when not glued to other letters on the left and followed by the
  end, a non-letter, or `off` ("LoxOff", "Ivan off", "lox.", "Day off lox"; not "Loxley").
- A CJK alias matches as a substring ("天off", "天 driving lesson").

All-day events cover the salon-local day(s) (#72's `eventInterval`).

## 5. What blocks what

- **STYLIST** and **LEAVE** → `ExternalBusyBlock` rows (source `GOOGLE`) for their stylists,
  exactly as #72 writes today. Availability, the outbound Fresha feed and Admin clash checks
  need no change for them. This replaces #72's title-prefix rule, which made an unmatched title
  block every stylist.
- **NOTE** → nothing.
- **UNASSIGNED** → the chair rule (§6). Never exported to Fresha.

## 6. The chair rule (UNASSIGNED)

A booking for stylist X over `[s, e)` is allowed only when the red events overlapping it can
still be served by **other** stylists:

- Let `R` be the UNASSIGNED intervals overlapping `[s, e)`, clipped to it, and `k` the most of
  them that overlap at any one instant.
- Let `F` be the active stylists other than X who **work that day over the whole clipped span**
  of `R` (`Availability`, not off) and have **no appointment or busy block** overlapping it.
- Allowed when `k ≤ |F|`. This is deliberately conservative: a stylist free for only part of the
  span does not count.

Where it applies:

- `getAvailableSlots` / `getBookingDays` / the slot grid: a slot failing the rule is shown
  taken.
- `assertAppointmentSlotAvailable` (online bookings and "Anyone" assignment): refused with the
  existing slot-unavailable error. "Anyone" tries the next candidate.
- Admin-created and moved bookings: a **warning** with the existing "Book anyway" override,
  never a hard refusal.

The UNASSIGNED intervals come from `GoogleDiaryEntry` (§7), read in the same Serializable
transaction as the other clash data.

## 7. Storage, window and privacy

New table `GoogleDiaryEntry` — the diary as Admin shows it:

| Field | |
|---|---|
| `id` | cuid |
| `googleEventId` | unique |
| `kind` | `STYLIST` / `UNASSIGNED` / `LEAVE` / `NOTE` |
| `stylistIdsJson` | JSON array of stylist ids (empty for UNASSIGNED/NOTE) |
| `title` | the event's summary, trimmed, at most 200 characters |
| `colorId` | Google colour id or null |
| `start`, `end`, `allDay` | interval (all-day = salon-local days) |
| `htmlLink` | Google's link to the event |
| `lastSyncAt` | |

- **Window:** 30 days back to 90 days ahead. The pull (#72's `pullGoogleCalendar`) reads that
  window (it read 1 day back before), replaces the window's entries in the same transaction as
  the busy blocks, and deletes entries that ended more than 30 days ago. Only titles are kept:
  never descriptions, attendees or locations.
- **Privacy:** these titles hold customers' names and phone numbers typed by staff. They are
  admin-only (never in a public page, feed or email) and kept only while inside the window. The
  privacy notice (en/zh) says the website keeps a copy of the salon diary for that period so
  staff see it in one place and online booking does not clash with it.
- **"Clear Google busy time"** also deletes every `GoogleDiaryEntry`.

## 8. Website → Google (D6)

- `GOOGLE_CALENDAR_ID` becomes `harbourhairuk@gmail.com` (the primary calendar's id).
- Event colour: the stylist's `googleColorId`, else the no-stylist colour. This replaces
  `stylistColorId` (which assigned colours by sort order). `sameRenderedEvent` already compares
  `colorId`, so a recoloured website event is put back, as are other edits (#72).
- **Calendar change guard:** `GoogleCalendarSyncState.calendarId` records the calendar the rows
  belong to. When the configured id differs, the next run clears `GoogleCalendarEvent` rows and
  the channel, then re-pushes everything to the new calendar. It never deletes events in the old
  calendar (none exist today; the owner deletes "Harbour website bookings" by hand).
- The owner shares the primary calendar with the service account with **"Make changes and see
  all event details"** (變更和查看所有活動詳情). Staff keep full access; nothing else changes
  for them.

## 9. Admin → Schedule (D7)

- **Day view:** columns per stylist plus **"No stylist"** (when the day has any UNASSIGNED
  entry). STYLIST/LEAVE entries sit in their stylists' columns (a LEAVE naming two appears in
  both). NOTE entries sit in a strip above the grid (all-day ones too). All Google entries use
  the Google colour as fill, the title as text, a "Google" badge, and are read-only; a click
  opens a small panel (title, time, kind, "Open in Google Calendar").
- Website bookings keep their behaviour (drag with confirmation, dialog) and take the stylist's
  Google colour.
- **Week view:** the same entries, compact.
- The Google `ExternalBusyBlock`s are not drawn separately any more (the entries replace them);
  Fresha/Treatwell blocks keep #68's look.
- en/zh strings for every new label.

## 10. Rollout

1. Merge and deploy (the migration adds the fields and table; nothing changes until §10.3).
2. Owner: share "HarbourHair" with `harbour-website-calendar@harbourhair-511821.iam.gserviceaccount.com`
   as 變更和查看所有活動詳情.
3. Admin → Stylists: Ivan = Lavender, Funky = Sage + alias `F`, Lox = Banana + alias `L`,
   Shania = alias `天`. Integrations: no-stylist = Tomato, leave = Graphite (defaults).
4. Vercel Production: `GOOGLE_CALENDAR_ID=harbourhairuk@gmail.com`; redeploy; Admin →
   Integrations → **Sync now**.
5. Verify in Chrome: a known diary week appears in Admin with the same titles and colours; a
   red event takes a chair in the slot grid; a test booking appears in the diary in its
   stylist's colour and disappears when cancelled.
6. Owner deletes "Harbour website bookings".

## 11. Testing

- **Unit:** `classifyDiaryEvent` (each rule, the alias rules, real diary titles from §2 as
  fixtures, transparent and all-day events); the chair rule (k vs. free stylists, partial
  availability, "Anyone" fallback, admin warning path); palette classes written in full;
  calendar change guard; stylist colour uniqueness; push colour selection.
- **PostgreSQL** (`scripts/verify-booking-lifecycle.ts`, CI): the pull stores entries and
  blocks in one transaction; a red entry makes a slot unavailable through the real availability
  code; the busy feed exports a STYLIST block and never an UNASSIGNED one; the window deletes old
  entries.
- **Page tests:** Admin Stylists and Integrations forms (en/zh), the schedule's "No stylist"
  column and Google entry rendering.

## 12. Out of scope

Editing Google events from Admin; sending red events to Fresha; showing diary entries older than
30 days; per-service colours from Google; reading any calendar other than the primary.
