# Google Diary Colour Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the salon's real Google diary (the primary "HarbourHair" calendar) into Admin → Schedule with its own titles and colours, let it block online booking (stylist colours and named leave block that stylist; red walk-ins take a chair), and write website bookings into that calendar in their stylist's colour.

**Architecture:** The existing pull (#72, `services/google-calendar-pull.ts`) lists 30 days back to 90 ahead, classifies every Google-only event with a pure `classifyDiaryEvent` (colour first, then names in the title), stores a `GoogleDiaryEntry` per event and GOOGLE `ExternalBusyBlock`s for STYLIST/LEAVE entries only, in one transaction. A pure chair rule reads UNASSIGNED entries inside the booking code's own reads (and Serializable transactions) and refuses online times that would leave a red event without a free stylist; admin create/move only warn. The push colours website events by the stylist's `googleColorId`, and a calendar change guard starts the push over when `GOOGLE_CALENDAR_ID` changes.

**Tech Stack:** Next.js 16 App Router (server actions, client components), React 19, Prisma 6 with three schemas (`prisma/dev` SQLite, `prisma/vercel` PostgreSQL 18 = the app's client, `prisma/prod` SQL Server), Tailwind v4, node:test + tsx (`--conditions=react-server`), en-GB + zh-HK messages.

**Spec:** `docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md` (as amended in 2adc460: transparency is ignored; no `blocks` column). Builds on `docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md` and its plan `docs/superpowers/plans/2026-10-16-google-calendar-two-way-sync.md`.

## Global Constraints

- Work only in this worktree (`.claude/worktrees/google-diary`, branch `feat/google-diary-mirror`).
- Google event colour ids are the strings `"1"`–`"11"`; palette (id → name → hex), verbatim: 1 Lavender #7986cb, 2 Sage #33b679, 3 Grape #8e24aa, 4 Flamingo #e67c73, 5 Banana #f6bf26, 6 Tangerine #f4511e, 7 Peacock #039be5, 8 Graphite #616161, 9 Blueberry #3f51b5, 10 Basil #0b8043, 11 Tomato #d50000. An event with no `colorId` is shown in a neutral grey.
- Defaults: no-stylist colour `"11"` (Tomato), leave colour `"8"` (Graphite). Real diary (rollout values, set by the owner in Admin, never in code or migrations): Ivan `"1"`, Funky `"2"` + alias `F`, Lox `"5"` + alias `L`, Shania no colour + alias `天`.
- Classification order (spec §4): website event → skipped; `status: cancelled` → skipped; a stylist's Google colour → STYLIST; the no-stylist colour → UNASSIGNED; otherwise names in the title → LEAVE, else NOTE. **`transparency` is ignored entirely** (it neither changes the kind nor stops blocking).
- Name matching (case-insensitive): a one-letter Latin alias only in parentheses `(F)`, `( F )`; a longer Latin name when not glued to Latin letters on the left and followed by the end, a non-letter, or `off`; a CJK alias as a substring.
- STYLIST and LEAVE → GOOGLE `ExternalBusyBlock` rows (exported in that stylist's Fresha busy feed, as #72). UNASSIGNED → never a busy block, never exported. NOTE → nothing.
- Window: 30 days back to 90 days ahead. Entries that ended more than 30 days ago are deleted. Only titles are kept (trimmed, at most 200 characters): never descriptions, attendees or locations.
- Diary titles hold customers' names and phone numbers: admin-only, never in a public page, feed or email.
- The chair rule (spec §6) refuses on customer paths only (slot grids, online booking, "Anyone", customer reschedule requests). Staff paths are never hard-refused by it: admin create/move get a warning with "Book anyway"; staff confirming a request or approving a reschedule do not apply it.
- Never call Google inside a database transaction. No new cron, no new public route that touches the database (CLAUDE.md "Neon compute budget"); kill-switches stay above the first DB call.
- Schema changes go in all three `prisma/*/schema.prisma` files, with one migration `20261017120000_google_diary_mirror` in each of the three `migrations` folders.
- Every UI string in `src/i18n/messages/en` and `zh` (`completeness.test.ts`); links through the locale-aware helpers. Google colours are admin-only and every class is written in full (`bg-[#7986cb]`), per `src/app/lib/calendar-colors.ts`; the public site stays monochrome.
- Tests under `src/app/[locale]/` never run (node --test reads `[locale]` as a glob): page tests live in `src/test/pages/`.
- Commit messages never contain a bracketed skip-ci marker and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
  ```

### Commands (every task)

- One file: `node --conditions=react-server --import tsx --test <file>`
- Whole suite: `pnpm test`
- Types: `pnpm exec tsc --noEmit` — pre-existing noise to ignore: 2 `LayoutProps` errors (only when `.next/types` is missing) and 4 errors in `colorMath.test.ts`. Nothing else may appear.
- Lint: `pnpm exec eslint <changed files>`
- Prisma client: `pnpm db:vercel:generate` after any schema change.
- **Migrations cannot be generated locally** (a hook blocks `prisma migrate`). Hand-write each `migration.sql` exactly as Prisma would, modelled on the three `20261016150000_google_calendar_sync` and `20261016120000_late_arrival_auto_cancel` folders. CI (`.github/workflows/deploy.yml`) replays the PostgreSQL migrations (`pnpm db:vercel:deploy`, PostgreSQL 18) and the SQLite ones and fails on any drift from the schema (`prisma migrate diff --exit-code`); the SQL Server file is not replayed in CI, so copy the style of its siblings exactly (TRY/TRAN frame, `NVARCHAR(1000)`, named `_df` default constraints).

## Review Focus

1. **"Show as available" leave.** All 41 transparent events in the real diary are Graphite leave ("天off", "lox off", "LoxOff", "Day off lox"), because Google makes all-day events available by default. Expected: they still block that stylist. Pinned by Task 2 ("transparency is ignored") and Task 3 ("a transparent all-day leave blocks Lox"), plus the PostgreSQL check in Task 9.
2. **A red walk-in when every other stylist is booked, off or rostered for part of it.** Expected: the online time shows taken and a submitted request is refused (`SLOT_UNAVAILABLE`, "Anyone" `NO_STYLIST_AT_TIME`), while staff can still confirm an existing request and book with "Book anyway". Pinned by Task 4 ("Funky rostered only until 15:30 does not count", "a submitted request is refused…; { chairRule: false } (staff) is not", "staff paths in actions/admin.ts never apply the chair rule") and Task 5 ("a Google walk-in left with no free stylist is a DIARY_CHAIR warning, never a refusal").
3. **A title that only looks like a name.** A single letter outside brackets ("TW L", "L-shaped mirror") or a name glued into a longer word ("Loxley", "Ivana party") must not block anyone. Pinned by Task 2 ("titles that name nobody are notes").
4. **The first run after deploy, or a changed `GOOGLE_CALENDAR_ID`.** The old `GoogleCalendarEvent` rows say "already written" about another calendar. Expected: rows and channel cleared once and every booking in the window written to the configured calendar; a racing second caller clears nothing. Pinned by Task 6 (guard tests and "the push runs the guard before choosing bookings").
5. **The sync switched off.** No pull runs, so the pull's own retention never runs either. Expected: diary entries are still deleted 30 days after they end (the privacy notice promises it) and "Clear Google busy time" removes the diary copy too. Pinned by Task 3 (housekeeping test and the clear test).

---

### Task 1: Schema and migrations

**Files:**
- Modify: `prisma/vercel/schema.prisma` (model `Stylist` lines 59-89, `GoogleCalendarSyncState` 262-273, `SiteSettings` 350-382; new model after `GoogleCalendarSyncState`)
- Modify: `prisma/dev/schema.prisma`, `prisma/prod/schema.prisma` (same models)
- Create: `prisma/vercel/migrations/20261017120000_google_diary_mirror/migration.sql`
- Create: `prisma/dev/migrations/20261017120000_google_diary_mirror/migration.sql`
- Create: `prisma/prod/migrations/20261017120000_google_diary_mirror/migration.sql`
- Test: `src/app/lib/google-diary-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Prisma client after `pnpm db:vercel:generate`):
  - `Stylist.googleColorId: string | null`, `Stylist.googleAliases: string | null`
  - `SiteSettings.googleUnassignedColorId: string` (default `"11"`), `SiteSettings.googleLeaveColorId: string` (default `"8"`)
  - `GoogleCalendarSyncState.calendarId: string | null`
  - `prisma.googleDiaryEntry` with fields `id, googleEventId (unique), kind, stylistIdsJson, title, colorId, start, end, allDay, htmlLink, lastSyncAt`; indexes `[kind, start]` and `[end]`.

- [ ] **Step 1: Write the failing test** `src/app/lib/google-diary-schema.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Google diary mirror (spec §3, §7): the fields and table in all three schemas,
// and one migration per provider.
const PROVIDERS = ['vercel', 'dev', 'prod'] as const;
const MIGRATION = '20261017120000_google_diary_mirror';
const block = (schema: string, model: string) => {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${model} missing`);
  return match[0];
};
const field = (name: string, type: string) => new RegExp(`\\n\\s+${name}\\s+${type.replace(/[?[\]]/g, '\\$&')}(\\s|$)`);

for (const provider of PROVIDERS) {
  const schema = () => readFileSync(`prisma/${provider}/schema.prisma`, 'utf8');

  test(`${provider}: Stylist has googleColorId and googleAliases`, () => {
    const model = block(schema(), 'Stylist');
    assert.match(model, field('googleColorId', 'String?'));
    assert.match(model, field('googleAliases', 'String?'));
  });

  test(`${provider}: SiteSettings has the diary colours with Tomato and Graphite defaults`, () => {
    const model = block(schema(), 'SiteSettings');
    assert.match(model, /\n\s+googleUnassignedColorId\s+String\s+@default\("11"\)/);
    assert.match(model, /\n\s+googleLeaveColorId\s+String\s+@default\("8"\)/);
  });

  test(`${provider}: GoogleCalendarSyncState records the calendar its rows belong to`, () => {
    assert.match(block(schema(), 'GoogleCalendarSyncState'), field('calendarId', 'String?'));
  });

  test(`${provider}: GoogleDiaryEntry as in spec §7, without a blocks column`, () => {
    const model = block(schema(), 'GoogleDiaryEntry');
    assert.match(model, /\n\s+id\s+String\s+@id @default\(cuid\(\)\)/);
    assert.match(model, /\n\s+googleEventId\s+String\s+@unique/);
    assert.match(model, field('kind', 'String'));
    assert.match(model, /\n\s+stylistIdsJson\s+String\s+@default\("\[\]"\)/);
    assert.match(model, field('title', 'String'));
    assert.match(model, field('colorId', 'String?'));
    assert.match(model, field('start', 'DateTime'));
    assert.match(model, field('end', 'DateTime'));
    assert.match(model, /\n\s+allDay\s+Boolean\s+@default\(false\)/);
    assert.match(model, field('htmlLink', 'String?'));
    assert.match(model, /\n\s+lastSyncAt\s+DateTime\s+@default\(now\(\)\)/);
    assert.doesNotMatch(model, /\n\s+blocks\s/);
    assert.match(model, /@@index\(\[kind, start\]\)/);
    assert.match(model, /@@index\(\[end\]\)/);
  });

  test(`${provider}: the migration adds every field, the table and its indexes`, () => {
    const file = `prisma/${provider}/migrations/${MIGRATION}/migration.sql`;
    assert.ok(existsSync(file), file);
    const sql = readFileSync(file, 'utf8');
    for (const name of ['googleColorId', 'googleAliases', 'googleUnassignedColorId', 'googleLeaveColorId', 'calendarId']) assert.match(sql, new RegExp(name), name);
    assert.match(sql, /CREATE TABLE \S*GoogleDiaryEntry/);
    for (const name of ['GoogleDiaryEntry_googleEventId_key', 'GoogleDiaryEntry_kind_start_idx', 'GoogleDiaryEntry_end_idx']) assert.match(sql, new RegExp(name), name);
    assert.match(sql, /DEFAULT '11'/);
    assert.match(sql, /DEFAULT '8'/);
  });
}

test('prod (SQL Server) wraps the migration in the TRY/TRAN frame its siblings use', () => {
  const sql = readFileSync(`prisma/prod/migrations/${MIGRATION}/migration.sql`, 'utf8');
  assert.match(sql, /^BEGIN TRY\s+BEGIN TRAN;/);
  assert.match(sql, /COMMIT TRAN;\s+END TRY\s+BEGIN CATCH/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=react-server --import tsx --test src/app/lib/google-diary-schema.test.ts`
Expected: FAIL (`googleColorId` not found in `Stylist`, migration file missing).

- [ ] **Step 3: Edit the three schemas** (identical text in all three; SQL Server needs no `@db` annotation here: every string fits `NVARCHAR(1000)`)

In `model Stylist`, after `calendarColor`:

```prisma
  /// Google Calendar event colour id ("1"–"11") the salon diary uses for this stylist (Google diary mirror); admin-only, never public
  googleColorId       String?
  /// Other names the diary uses for this stylist, comma-separated (e.g. "F"); the stylist's own name always counts
  googleAliases       String?
```

In `model SiteSettings`, after `lateAutoCancelSince`:

```prisma
  /// Google diary colours (Admin → Integrations): events in the no-stylist colour take a chair; the leave colour is reserved for leave
  googleUnassignedColorId    String @default("11")
  googleLeaveColorId         String @default("8")
```

In `model GoogleCalendarSyncState`, after `busyHash`:

```prisma
  /// The calendar the GoogleCalendarEvent rows belong to; a different configured id makes the next run start over (calendar change guard)
  calendarId        String?
```

New model after `GoogleCalendarSyncState`:

```prisma
/// One event of the salon's Google diary, classified (Google diary mirror). Titles may hold
/// customers' names and phone numbers typed by staff: admin-only, kept until 30 days after the event.
model GoogleDiaryEntry {
  id             String   @id @default(cuid())
  googleEventId  String   @unique
  /// STYLIST | UNASSIGNED | LEAVE | NOTE
  kind           String
  /// JSON array of stylist ids (empty for UNASSIGNED and NOTE)
  stylistIdsJson String   @default("[]")
  /// The event's summary, trimmed, at most 200 characters
  title          String
  colorId        String?
  start          DateTime
  end            DateTime
  allDay         Boolean  @default(false)
  htmlLink       String?
  lastSyncAt     DateTime @default(now())

  @@index([kind, start])
  @@index([end])
}
```

- [ ] **Step 4: Hand-write the three migrations**

`prisma/vercel/migrations/20261017120000_google_diary_mirror/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "GoogleCalendarSyncState" ADD COLUMN     "calendarId" TEXT;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "googleLeaveColorId" TEXT NOT NULL DEFAULT '8',
ADD COLUMN     "googleUnassignedColorId" TEXT NOT NULL DEFAULT '11';

-- AlterTable
ALTER TABLE "Stylist" ADD COLUMN     "googleAliases" TEXT,
ADD COLUMN     "googleColorId" TEXT;

-- CreateTable
CREATE TABLE "GoogleDiaryEntry" (
    "id" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stylistIdsJson" TEXT NOT NULL DEFAULT '[]',
    "title" TEXT NOT NULL,
    "colorId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "htmlLink" TEXT,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleDiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDiaryEntry_googleEventId_key" ON "GoogleDiaryEntry"("googleEventId");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_kind_start_idx" ON "GoogleDiaryEntry"("kind", "start");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_end_idx" ON "GoogleDiaryEntry"("end");
```

`prisma/dev/migrations/20261017120000_google_diary_mirror/migration.sql` (SQLite: constant defaults allow `ADD COLUMN ... NOT NULL DEFAULT`, as `20260721090000_treatwell_api_ready` does):

```sql
-- AlterTable
ALTER TABLE "GoogleCalendarSyncState" ADD COLUMN "calendarId" TEXT;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "googleLeaveColorId" TEXT NOT NULL DEFAULT '8';
ALTER TABLE "SiteSettings" ADD COLUMN "googleUnassignedColorId" TEXT NOT NULL DEFAULT '11';

-- AlterTable
ALTER TABLE "Stylist" ADD COLUMN "googleAliases" TEXT;
ALTER TABLE "Stylist" ADD COLUMN "googleColorId" TEXT;

-- CreateTable
CREATE TABLE "GoogleDiaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stylistIdsJson" TEXT NOT NULL DEFAULT '[]',
    "title" TEXT NOT NULL,
    "colorId" TEXT,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "htmlLink" TEXT,
    "lastSyncAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDiaryEntry_googleEventId_key" ON "GoogleDiaryEntry"("googleEventId");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_kind_start_idx" ON "GoogleDiaryEntry"("kind", "start");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_end_idx" ON "GoogleDiaryEntry"("end");
```

`prisma/prod/migrations/20261017120000_google_diary_mirror/migration.sql`:

```sql
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[GoogleCalendarSyncState] ADD [calendarId] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[SiteSettings] ADD [googleLeaveColorId] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_googleLeaveColorId_df] DEFAULT '8',
[googleUnassignedColorId] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_googleUnassignedColorId_df] DEFAULT '11';

-- AlterTable
ALTER TABLE [dbo].[Stylist] ADD [googleAliases] NVARCHAR(1000),
[googleColorId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[GoogleDiaryEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [googleEventId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [stylistIdsJson] NVARCHAR(1000) NOT NULL CONSTRAINT [GoogleDiaryEntry_stylistIdsJson_df] DEFAULT '[]',
    [title] NVARCHAR(1000) NOT NULL,
    [colorId] NVARCHAR(1000),
    [start] DATETIME2 NOT NULL,
    [end] DATETIME2 NOT NULL,
    [allDay] BIT NOT NULL CONSTRAINT [GoogleDiaryEntry_allDay_df] DEFAULT 0,
    [htmlLink] NVARCHAR(1000),
    [lastSyncAt] DATETIME2 NOT NULL CONSTRAINT [GoogleDiaryEntry_lastSyncAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [GoogleDiaryEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [GoogleDiaryEntry_googleEventId_key] UNIQUE NONCLUSTERED ([googleEventId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GoogleDiaryEntry_kind_start_idx] ON [dbo].[GoogleDiaryEntry]([kind], [start]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GoogleDiaryEntry_end_idx] ON [dbo].[GoogleDiaryEntry]([end]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
```

- [ ] **Step 5: Regenerate the client and run the tests**

Run: `pnpm db:vercel:generate && node --conditions=react-server --import tsx --test src/app/lib/google-diary-schema.test.ts src/app/lib/google-calendar-schema.test.ts src/app/lib/late-arrival-schema.test.ts`
Expected: PASS. Then `pnpm exec tsc --noEmit`: only the known pre-existing errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/vercel/schema.prisma prisma/dev/schema.prisma prisma/prod/schema.prisma \
  prisma/vercel/migrations/20261017120000_google_diary_mirror prisma/dev/migrations/20261017120000_google_diary_mirror \
  prisma/prod/migrations/20261017120000_google_diary_mirror src/app/lib/google-diary-schema.test.ts
git commit -F - <<'EOF'
feat(gdiary): schema for the Google diary mirror

Stylist Google colour and names, the two salon diary colours, the calendar
the Google rows belong to, and the GoogleDiaryEntry table, in all three
schemas with one migration each.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 2: Google palette and pure diary classification

**Files:**
- Modify: `src/app/lib/calendar-colors.ts` (append after line 66)
- Modify: `src/app/lib/calendar-colors.test.ts` (append)
- Create: `src/app/lib/google-aliases.ts`, `src/app/lib/google-aliases.test.ts`
- Create: `src/app/services/google-diary-classify.ts`, `src/app/services/google-diary-classify.test.ts`
- Modify: `src/app/services/google-busy-mapping.ts:34` (export `eventInterval`; nothing else changes in this task)
- Modify: `src/app/services/google-calendar-gateway.ts:33-51` (`htmlLink` in `GoogleEvent` and `eventSchema`)
- Modify: `src/app/services/google-calendar-gateway.test.ts` (one assertion)

**Interfaces:**
- Consumes: `GoogleEvent` (`google-calendar-gateway.ts`), `isWebsiteEvent`, `googleEventIdFor` (`google-calendar-event.ts`), `SALON_TIMEZONE` via `eventInterval`.
- Produces:
  ```ts
  // src/app/lib/calendar-colors.ts
  export const GOOGLE_EVENT_COLORS: { readonly '1': GoogleSwatch; …; readonly '11': GoogleSwatch };
  //   GoogleSwatch = CalendarSwatch & { key: 'lavender'|'sage'|'grape'|'flamingo'|'banana'|'tangerine'|'peacock'|'graphite'|'blueberry'|'basil'|'tomato'; hex: string }
  export type GoogleColorId = keyof typeof GOOGLE_EVENT_COLORS;
  export const GOOGLE_COLOR_IDS: GoogleColorId[];            // '1'..'11' in order
  export const DEFAULT_UNASSIGNED_COLOR_ID: GoogleColorId;  // '11'
  export const DEFAULT_LEAVE_COLOR_ID: GoogleColorId;       // '8'
  export const GOOGLE_NO_COLOR: CalendarSwatch;             // neutral grey for no colorId
  export function isGoogleColorId(value: unknown): value is GoogleColorId;
  export function googleEventSwatch(colorId: string | null | undefined): CalendarSwatch;
  export function stylistSwatch(stylist: { calendarColor: string | null; googleColorId?: string | null }): CalendarSwatch;

  // src/app/lib/google-aliases.ts
  export function parseGoogleAliases(text: string | null | undefined): string[];

  // src/app/services/google-diary-classify.ts
  export const GOOGLE_DIARY_RETENTION_DAYS = 30;   // the window looks back this far; entries older are deleted
  export const GOOGLE_DIARY_LOOKAHEAD_DAYS = 90;
  export const DIARY_TITLE_MAX = 200;
  export const DIARY_KINDS: readonly ['STYLIST', 'UNASSIGNED', 'LEAVE', 'NOTE'];
  export type DiaryKind = (typeof DIARY_KINDS)[number];
  export type DiaryStylist = { id: string; name: string; googleColorId: string | null; googleAliases: string | null };
  export type DiaryConfig = { stylists: readonly DiaryStylist[]; unassignedColorId: string; leaveColorId: string };
  export type DiaryClassification = { kind: DiaryKind; stylistIds: string[] };
  export type DiaryEntry = { googleEventId: string; kind: DiaryKind; stylistIds: string[]; title: string; colorId: string | null; start: Date; end: Date; allDay: boolean; htmlLink: string | null };
  export function stylistsNamedIn(title: string, stylists: readonly DiaryStylist[]): string[];
  export function classifyDiaryEvent(event: GoogleEvent, config: DiaryConfig): DiaryClassification | null;
  export function diaryEntriesFrom(events: readonly GoogleEvent[], config: DiaryConfig): DiaryEntry[];
  export function diaryHash(entries: readonly DiaryEntry[]): string;

  // src/app/services/google-busy-mapping.ts
  export function eventInterval(event: GoogleEvent): { start: Date; end: Date } | null;   // now exported

  // src/app/services/google-calendar-gateway.ts
  export type GoogleEvent = { …existing…; htmlLink?: string };
  ```

- [ ] **Step 1: Write the failing palette tests** — append to `src/app/lib/calendar-colors.test.ts` (extend the import list with `DEFAULT_LEAVE_COLOR_ID, DEFAULT_UNASSIGNED_COLOR_ID, GOOGLE_COLOR_IDS, GOOGLE_EVENT_COLORS, GOOGLE_NO_COLOR, googleEventSwatch, isGoogleColorId, stylistSwatch`)

```ts
// Google's own event palette (Google diary mirror, spec §3), verbatim.
const GOOGLE_HEX: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
  '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};
const ZINC_950 = '#09090b';
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('Google palette: the eleven ids in order, Google’s hex, every class a full literal', () => {
  assert.deepEqual(GOOGLE_COLOR_IDS, Object.keys(GOOGLE_HEX));
  for (const id of GOOGLE_COLOR_IDS) {
    const swatch = GOOGLE_EVENT_COLORS[id];
    assert.equal(swatch.hex, GOOGLE_HEX[id], id);
    for (const cls of [swatch.fill, swatch.swatch, swatch.stripe]) assert.equal(cls, `bg-[${GOOGLE_HEX[id]}]`, id);
    assert.ok(swatch.label.length > 0 && swatch.key.length > 0, id);
  }
  assert.deepEqual(GOOGLE_COLOR_IDS.map((id) => GOOGLE_EVENT_COLORS[id].key),
    ['lavender', 'sage', 'grape', 'flamingo', 'banana', 'tangerine', 'peacock', 'graphite', 'blueberry', 'basil', 'tomato']);
});

test('Google palette: text is whichever of white and zinc-950 reads better, and clears WCAG AA', () => {
  for (const id of GOOGLE_COLOR_IDS) {
    const { hex, text } = GOOGLE_EVENT_COLORS[id];
    const white = contrast(hex, '#ffffff');
    const dark = contrast(hex, ZINC_950);
    assert.equal(text, white >= dark ? 'text-white' : 'text-zinc-950', id);
    assert.ok(Math.max(white, dark) >= 4.5, `${id} contrast`);
  }
});

test('Google colour ids, the no-colour grey and the stylist swatch', () => {
  assert.equal(DEFAULT_UNASSIGNED_COLOR_ID, '11');
  assert.equal(DEFAULT_LEAVE_COLOR_ID, '8');
  for (const good of ['1', '8', '11']) assert.equal(isGoogleColorId(good), true, good);
  for (const bad of ['0', '12', '', ' 1', '01', null, undefined, 1, 'toString', '__proto__']) assert.equal(isGoogleColorId(bad), false, String(bad));
  assert.equal(googleEventSwatch('11').fill, 'bg-[#d50000]');
  assert.deepEqual(googleEventSwatch(null), GOOGLE_NO_COLOR);
  assert.deepEqual(googleEventSwatch('99'), GOOGLE_NO_COLOR);
  // The board matches Google: a stylist's Google colour wins over their calendar colour.
  assert.equal(stylistSwatch({ calendarColor: 'teal', googleColorId: '5' }).fill, 'bg-[#f6bf26]');
  assert.equal(stylistSwatch({ calendarColor: 'teal', googleColorId: null }).fill, 'bg-teal-600');
  assert.equal(stylistSwatch({ calendarColor: null }).fill, DEFAULT_CALENDAR_COLOR.fill);
});
```

- [ ] **Step 2: Write the failing alias and classification tests**

`src/app/lib/google-aliases.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleAliases } from './google-aliases';

test('aliases: comma lists in English and Chinese punctuation, trimmed, de-duplicated ignoring case', () => {
  assert.deepEqual(parseGoogleAliases(' F , f,,Funky '), ['F', 'Funky']);
  assert.deepEqual(parseGoogleAliases('天，阿天、 T '), ['天', '阿天', 'T']);
  assert.deepEqual(parseGoogleAliases(null), []);
  assert.deepEqual(parseGoogleAliases(undefined), []);
  assert.deepEqual(parseGoogleAliases('  ,  '), []);
});
```

`src/app/services/google-diary-classify.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GoogleEvent } from './google-calendar-gateway';
import { googleEventIdFor } from './google-calendar-event';
import {
  classifyDiaryEvent, diaryEntriesFrom, diaryHash, stylistsNamedIn, type DiaryConfig, type DiaryStylist,
} from './google-diary-classify';

// The real roster and diary (spec §2, §3; colour ids confirmed against the API 2026-10-17).
const IVAN: DiaryStylist = { id: 'ivan', name: 'Ivan', googleColorId: '1', googleAliases: null };
const FUNKY: DiaryStylist = { id: 'funky', name: 'Funky', googleColorId: '2', googleAliases: 'F' };
const LOX: DiaryStylist = { id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' };
const SHANIA: DiaryStylist = { id: 'shania', name: 'Shania', googleColorId: null, googleAliases: '天' };
const CONFIG: DiaryConfig = { stylists: [IVAN, FUNKY, LOX, SHANIA], unassignedColorId: '11', leaveColorId: '8' };

function ev(summary: string | undefined, extra: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt1', status: 'confirmed', summary,
    start: { dateTime: '2026-10-20T10:00:00+01:00' }, end: { dateTime: '2026-10-20T11:00:00+01:00' },
    ...extra,
  };
}
const kindOf = (summary: string, extra?: Partial<GoogleEvent>) => classifyDiaryEvent(ev(summary, extra), CONFIG);

test('a stylist colour is that stylist, whatever the title says (rule 3)', () => {
  assert.deepEqual(kindOf('Cut - Erin(W)', { colorId: '1' }), { kind: 'STYLIST', stylistIds: ['ivan'] });
  assert.deepEqual(kindOf('07700 900123 Amy', { colorId: '2' }), { kind: 'STYLIST', stylistIds: ['funky'] });
  assert.deepEqual(kindOf('Ivan off', { colorId: '5' }), { kind: 'STYLIST', stylistIds: ['lox'] });
});

test('the no-stylist colour is UNASSIGNED (rule 4): walk-ins and Treatwell', () => {
  for (const title of ['Cut - Erin(W)', 'TW L', 'Ivan off']) {
    assert.deepEqual(kindOf(title, { colorId: '11' }), { kind: 'UNASSIGNED', stylistIds: [] }, title);
  }
});

test('real leave titles block the stylists they name (rule 5)', () => {
  const cases: [string, string[]][] = [
    ['FunkyOff(F)', ['funky']], ['早走(L)', ['lox']], ['遲返 (L)(F)', ['funky', 'lox']], ['天off', ['shania']],
    ['LoxOff', ['lox']], ['lox off', ['lox']], ['Day off lox', ['lox']], ['Ivan off', ['ivan']], ['lox.', ['lox']],
    ['天 driving lesson', ['shania']], ['早走（L）', ['lox']], ['( F ) late', ['funky']], ["Ivan's dentist", ['ivan']],
  ];
  for (const [title, ids] of cases) assert.deepEqual(kindOf(title, { colorId: '8' }), { kind: 'LEAVE', stylistIds: ids }, title);
});

test('titles that name nobody are notes and block nothing (D5): one letter outside brackets, names glued into words', () => {
  for (const title of ['卡機', '檢查消防', '見工 zayn', 'GhD Con', 'TW L', 'Loxley', 'Ivana party', 'L-shaped mirror', 'F', '']) {
    assert.deepEqual(kindOf(title, { colorId: '8' }), { kind: 'NOTE', stylistIds: [] }, JSON.stringify(title));
  }
  assert.deepEqual(classifyDiaryEvent(ev(undefined, { colorId: '8' }), CONFIG), { kind: 'NOTE', stylistIds: [] });
});

test('any other colour, or none, is read by names exactly like the leave colour', () => {
  assert.deepEqual(kindOf('Ivan off', { colorId: '3' }), { kind: 'LEAVE', stylistIds: ['ivan'] });
  assert.deepEqual(kindOf('Ivan off'), { kind: 'LEAVE', stylistIds: ['ivan'] });
  assert.deepEqual(kindOf('卡機'), { kind: 'NOTE', stylistIds: [] });
});

test('transparency is ignored: "Show as available" leave still blocks (rule 6, amended)', () => {
  assert.deepEqual(
    kindOf('天off', { colorId: '8', transparency: 'transparent', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }),
    { kind: 'LEAVE', stylistIds: ['shania'] },
  );
  assert.deepEqual(kindOf('LoxOff', { colorId: '8', transparency: 'transparent' }), { kind: 'LEAVE', stylistIds: ['lox'] });
  assert.deepEqual(kindOf('Walk-in', { colorId: '11', transparency: 'transparent' }), { kind: 'UNASSIGNED', stylistIds: [] });
  assert.deepEqual(kindOf('Amy', { colorId: '1', transparency: 'transparent' }), { kind: 'STYLIST', stylistIds: ['ivan'] });
});

test('website events and cancelled events are skipped entirely (rules 1–2); tentative ones are not', () => {
  assert.equal(kindOf('Ivan · Amy · Cut', { colorId: '1', extendedProperties: { private: { harbourAppointmentId: 'a1' } } }), null);
  assert.equal(kindOf('Ivan · Amy · Cut', { id: googleEventIdFor('a1') }), null);
  assert.equal(kindOf('Ivan off', { status: 'cancelled' }), null);
  assert.deepEqual(kindOf('Ivan off', { status: 'tentative' }), { kind: 'LEAVE', stylistIds: ['ivan'] });
});

test('two active stylists holding one colour (refused by the form, possible after a reactivation) are both blocked', () => {
  const twins: DiaryConfig = { ...CONFIG, stylists: [IVAN, { ...LOX, googleColorId: '1' }] };
  assert.deepEqual(classifyDiaryEvent(ev('x', { colorId: '1' }), twins), { kind: 'STYLIST', stylistIds: ['ivan', 'lox'] });
});

test('names with regex characters are literal; multi-word names match as a phrase', () => {
  const dotted: DiaryStylist = { id: 'ab', name: 'A.B', googleColorId: null, googleAliases: null };
  assert.deepEqual(stylistsNamedIn('AxB off', [dotted]), []);
  assert.deepEqual(stylistsNamedIn('A.B off', [dotted]), ['ab']);
  const synthetic: DiaryStylist = { id: 's', name: 'Synthetic Stylist', googleColorId: null, googleAliases: null };
  assert.deepEqual(stylistsNamedIn('Synthetic Stylist: dentist', [synthetic]), ['s']);
});

test('entries: intervals, all-day salon days across the clock change, titles cut to 200 characters, Google links only', () => {
  const [allDay, timed] = diaryEntriesFrom([
    ev('天off', { id: 'e1', colorId: '8', transparency: 'transparent', start: { date: '2026-10-25' }, end: { date: '2026-10-26' }, htmlLink: 'https://www.google.com/calendar/event?eid=YWJjMTIz' }),
    ev(`  ${'長'.repeat(250)}  `, { id: 'e2', colorId: '11', htmlLink: 'javascript:alert(1)' }),
  ], CONFIG);
  assert.deepEqual([allDay.googleEventId, allDay.kind, allDay.stylistIds, allDay.allDay, allDay.colorId], ['e1', 'LEAVE', ['shania'], true, '8']);
  assert.equal(allDay.start.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(allDay.end.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(allDay.htmlLink, 'https://www.google.com/calendar/event?eid=YWJjMTIz');
  assert.equal(timed.title, '長'.repeat(200));
  assert.deepEqual([timed.kind, timed.allDay, timed.htmlLink], ['UNASSIGNED', false, null]);
  assert.equal(diaryEntriesFrom([ev('x', { htmlLink: 'https://evil.example/calendar/event?eid=1' })], CONFIG)[0].htmlLink, null);
});

test('entries skip website, cancelled and malformed events; a repeated id is stored once; an unknown colour is null', () => {
  const entries = diaryEntriesFrom([
    ev('Ivan off', { id: 'a' }),
    ev('Ivan off again', { id: 'a' }),
    ev('website', { id: googleEventIdFor('x') }),
    ev('gone', { id: 'b', status: 'cancelled' }),
    ev('bad', { id: 'c', start: { dateTime: 'nonsense' } }),
    ev('odd colour', { id: 'd', colorId: '42' }),
  ], CONFIG);
  assert.deepEqual(entries.map((entry) => [entry.googleEventId, entry.title, entry.colorId]), [['a', 'Ivan off', null], ['d', 'odd colour', null]]);
});

test('the diary hash ignores order and changes with any shown field', () => {
  const entries = diaryEntriesFrom([ev('Ivan off', { id: 'a' }), ev('卡機', { id: 'b' })], CONFIG);
  assert.equal(diaryHash(entries), diaryHash([...entries].reverse()));
  assert.match(diaryHash(entries), /^[0-9a-f]{64}$/);
  assert.notEqual(diaryHash(entries), diaryHash([{ ...entries[0], title: 'Ivan off (dentist)' }, entries[1]]));
  assert.notEqual(diaryHash(entries), diaryHash([{ ...entries[0], colorId: '8' }, entries[1]]));
  assert.notEqual(diaryHash(entries), diaryHash([{ ...entries[0], end: new Date(entries[0].end.getTime() + 60_000) }, entries[1]]));
  assert.notEqual(diaryHash(entries), diaryHash(entries.slice(1)));
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/lib/calendar-colors.test.ts src/app/lib/google-aliases.test.ts src/app/services/google-diary-classify.test.ts`
Expected: FAIL (missing exports / modules).

- [ ] **Step 4: Implement the palette** — append to `src/app/lib/calendar-colors.ts`

```ts
type GoogleSwatch = CalendarSwatch & {
  key: 'lavender' | 'sage' | 'grape' | 'flamingo' | 'banana' | 'tangerine' | 'peacock' | 'graphite' | 'blueberry' | 'basil' | 'tomato';
  hex: string;
};

/**
 * Google Calendar's eleven event colours (Google diary mirror, spec §3), so the
 * admin board shows the salon diary exactly as Google does. Admin-only, like
 * everything in this file. Arbitrary-value classes are written out in full,
 * one literal per colour, for the Tailwind reason at the top of this file.
 * `text` is whichever of white and zinc-950 reads better on the fill (both
 * clear WCAG AA); calendar-colors.test.ts recomputes it from `hex`.
 */
export const GOOGLE_EVENT_COLORS = {
  '1': { key: 'lavender', label: 'Lavender', hex: '#7986cb', fill: 'bg-[#7986cb]', text: 'text-zinc-950', stripe: 'bg-[#7986cb]', swatch: 'bg-[#7986cb]' },
  '2': { key: 'sage', label: 'Sage', hex: '#33b679', fill: 'bg-[#33b679]', text: 'text-zinc-950', stripe: 'bg-[#33b679]', swatch: 'bg-[#33b679]' },
  '3': { key: 'grape', label: 'Grape', hex: '#8e24aa', fill: 'bg-[#8e24aa]', text: 'text-white', stripe: 'bg-[#8e24aa]', swatch: 'bg-[#8e24aa]' },
  '4': { key: 'flamingo', label: 'Flamingo', hex: '#e67c73', fill: 'bg-[#e67c73]', text: 'text-zinc-950', stripe: 'bg-[#e67c73]', swatch: 'bg-[#e67c73]' },
  '5': { key: 'banana', label: 'Banana', hex: '#f6bf26', fill: 'bg-[#f6bf26]', text: 'text-zinc-950', stripe: 'bg-[#f6bf26]', swatch: 'bg-[#f6bf26]' },
  '6': { key: 'tangerine', label: 'Tangerine', hex: '#f4511e', fill: 'bg-[#f4511e]', text: 'text-zinc-950', stripe: 'bg-[#f4511e]', swatch: 'bg-[#f4511e]' },
  '7': { key: 'peacock', label: 'Peacock', hex: '#039be5', fill: 'bg-[#039be5]', text: 'text-zinc-950', stripe: 'bg-[#039be5]', swatch: 'bg-[#039be5]' },
  '8': { key: 'graphite', label: 'Graphite', hex: '#616161', fill: 'bg-[#616161]', text: 'text-white', stripe: 'bg-[#616161]', swatch: 'bg-[#616161]' },
  '9': { key: 'blueberry', label: 'Blueberry', hex: '#3f51b5', fill: 'bg-[#3f51b5]', text: 'text-white', stripe: 'bg-[#3f51b5]', swatch: 'bg-[#3f51b5]' },
  '10': { key: 'basil', label: 'Basil', hex: '#0b8043', fill: 'bg-[#0b8043]', text: 'text-white', stripe: 'bg-[#0b8043]', swatch: 'bg-[#0b8043]' },
  '11': { key: 'tomato', label: 'Tomato', hex: '#d50000', fill: 'bg-[#d50000]', text: 'text-white', stripe: 'bg-[#d50000]', swatch: 'bg-[#d50000]' },
} as const satisfies Record<string, GoogleSwatch>;

export type GoogleColorId = keyof typeof GOOGLE_EVENT_COLORS;

export const GOOGLE_COLOR_IDS = Object.keys(GOOGLE_EVENT_COLORS) as GoogleColorId[];

/** Spec §3 defaults: Tomato for bookings without a stylist, Graphite for leave. */
export const DEFAULT_UNASSIGNED_COLOR_ID: GoogleColorId = '11';
export const DEFAULT_LEAVE_COLOR_ID: GoogleColorId = '8';

/** An event with no colorId takes the calendar's own colour: a neutral grey here. */
export const GOOGLE_NO_COLOR: CalendarSwatch = {
  label: 'Calendar colour', fill: 'bg-zinc-300', text: 'text-zinc-950', stripe: 'bg-zinc-300', swatch: 'bg-zinc-300',
};

export function isGoogleColorId(value: unknown): value is GoogleColorId {
  return typeof value === 'string' && Object.hasOwn(GOOGLE_EVENT_COLORS, value);
}

export function googleEventSwatch(colorId: string | null | undefined): CalendarSwatch {
  return isGoogleColorId(colorId) ? GOOGLE_EVENT_COLORS[colorId] : GOOGLE_NO_COLOR;
}

/** A stylist's blocks on the board: their Google colour when set, so the board matches Google; else their calendar colour. */
export function stylistSwatch(stylist: { calendarColor: string | null; googleColorId?: string | null }): CalendarSwatch {
  return isGoogleColorId(stylist.googleColorId) ? GOOGLE_EVENT_COLORS[stylist.googleColorId] : resolveCalendarColor(stylist.calendarColor);
}
```

- [ ] **Step 5: Implement aliases, the exported interval, `htmlLink`, and the classifier**

`src/app/lib/google-aliases.ts`:

```ts
/**
 * A stylist's extra diary names (Admin → Stylists → Google names): split on
 * English or Chinese commas and 、, trimmed, empty ones dropped, repeats
 * (ignoring case) dropped. Pure; shared by the form and the classifier.
 */
export function parseGoogleAliases(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const part of text.split(/[,，、]/)) {
    const alias = part.trim();
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return aliases;
}
```

`src/app/services/google-busy-mapping.ts`: change line 34 `function eventInterval(` to `export function eventInterval(`. Nothing else in this task.

`src/app/services/google-calendar-gateway.ts`: add `htmlLink?: string;` to `GoogleEvent` (after `colorId?: string;`) and `htmlLink: z.string().optional(),` to `eventSchema` (after `colorId`). In `google-calendar-gateway.test.ts`, in the existing `listEvents` test that lists two pages, add `htmlLink: 'https://www.google.com/calendar/event?eid=x'` to one listed item and assert it survives the listing.

`src/app/services/google-diary-classify.ts`:

```ts
// Pure classification of the salon's Google diary
// (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §4).
// No database, no Google call. Transparency ("Show as available") is ignored:
// Google makes all-day events "available" by default, and every such event in
// the real diary is leave (spec §4 rule 6, amended 2026-10-17).

import { createHash } from 'node:crypto';
import { isGoogleColorId } from '@/app/lib/calendar-colors';
import { parseGoogleAliases } from '@/app/lib/google-aliases';
import type { GoogleEvent } from './google-calendar-gateway';
import { isWebsiteEvent } from './google-calendar-event';
import { eventInterval } from './google-busy-mapping';

/** The diary window looks back this far; entries that ended earlier are deleted (privacy notice). */
export const GOOGLE_DIARY_RETENTION_DAYS = 30;
export const GOOGLE_DIARY_LOOKAHEAD_DAYS = 90;
export const DIARY_TITLE_MAX = 200;

export const DIARY_KINDS = ['STYLIST', 'UNASSIGNED', 'LEAVE', 'NOTE'] as const;
export type DiaryKind = (typeof DIARY_KINDS)[number];

export type DiaryStylist = { id: string; name: string; googleColorId: string | null; googleAliases: string | null };
/** Active stylists only (an inactive one never blocks), and the two salon colours. */
export type DiaryConfig = { stylists: readonly DiaryStylist[]; unassignedColorId: string; leaveColorId: string };
export type DiaryClassification = { kind: DiaryKind; stylistIds: string[] };
export type DiaryEntry = {
  googleEventId: string; kind: DiaryKind; stylistIds: string[]; title: string; colorId: string | null;
  start: Date; end: Date; allDay: boolean; htmlLink: string | null;
};

const HAN = /\p{Script=Han}/u;
const ONE_LATIN_LETTER = /^\p{Script=Latin}$/u;
/** Google's own event links only: anything else is never rendered as a link in Admin. */
const GOOGLE_EVENT_LINK = /^https:\/\/www\.google\.com\/calendar\/event\?[\w=&%.-]+$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Spec §4 "Name matching", case-insensitive:
 *  - a CJK name matches as a substring ("天off");
 *  - a one-letter Latin alias only in brackets ("早走(L)", "( F )");
 *  - a longer Latin name when no Latin letter is glued to its left and it is
 *    followed by the end, a non-letter, or "off" ("LoxOff", "lox.", "Day off lox"; not "Loxley").
 */
function nameMatcher(name: string): RegExp {
  const escaped = escapeRegExp(name);
  if (HAN.test(name)) return new RegExp(escaped, 'iu');
  if (ONE_LATIN_LETTER.test(name)) return new RegExp(`\\(\\s*${escaped}\\s*\\)`, 'iu');
  return new RegExp(`(?<!\\p{Script=Latin})${escaped}(?=$|[^\\p{Script=Latin}]|off)`, 'iu');
}

/** Every stylist the title names (own name or any alias), in the config's order. NFKC turns full-width "（Ｌ）" into "(L)". */
export function stylistsNamedIn(title: string, stylists: readonly DiaryStylist[]): string[] {
  const text = title.normalize('NFKC');
  const ids: string[] = [];
  for (const stylist of stylists) {
    const names = [stylist.name, ...parseGoogleAliases(stylist.googleAliases)]
      .map((name) => name.normalize('NFKC').trim())
      .filter((name) => name.length > 0);
    if (names.some((name) => nameMatcher(name).test(text))) ids.push(stylist.id);
  }
  return ids;
}

/** Spec §4, in order. null: not part of the diary (the website's own event, or cancelled). */
export function classifyDiaryEvent(event: GoogleEvent, config: DiaryConfig): DiaryClassification | null {
  if (isWebsiteEvent(event)) return null;
  if (event.status === 'cancelled') return null;
  if (event.colorId) {
    const owners = config.stylists.filter((stylist) => stylist.googleColorId === event.colorId).map((stylist) => stylist.id);
    if (owners.length > 0) return { kind: 'STYLIST', stylistIds: owners };
    if (event.colorId === config.unassignedColorId) return { kind: 'UNASSIGNED', stylistIds: [] };
  }
  // The leave colour, any other colour and no colour alike: the title decides.
  const named = stylistsNamedIn(event.summary ?? '', config.stylists);
  return named.length > 0 ? { kind: 'LEAVE', stylistIds: named } : { kind: 'NOTE', stylistIds: [] };
}

function diaryTitle(summary: string | undefined): string {
  // By code point, so a cut never splits a surrogate pair.
  return Array.from((summary ?? '').replace(/\s+/g, ' ').trim()).slice(0, DIARY_TITLE_MAX).join('');
}

function safeLink(link: string | undefined): string | null {
  return link && link.length <= 500 && GOOGLE_EVENT_LINK.test(link) ? link : null;
}

/** The diary as stored (spec §7): classified events with a valid interval, one per Google id. Only the title is kept. */
export function diaryEntriesFrom(events: readonly GoogleEvent[], config: DiaryConfig): DiaryEntry[] {
  const seen = new Set<string>();
  const entries: DiaryEntry[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    const classification = classifyDiaryEvent(event, config);
    if (!classification) continue;
    const interval = eventInterval(event);
    if (!interval) continue;
    seen.add(event.id);
    entries.push({
      googleEventId: event.id,
      kind: classification.kind,
      stylistIds: classification.stylistIds,
      title: diaryTitle(event.summary),
      colorId: isGoogleColorId(event.colorId) ? event.colorId : null,
      start: interval.start,
      end: interval.end,
      allDay: !event.start?.dateTime && Boolean(event.start?.date),
      htmlLink: safeLink(event.htmlLink),
    });
  }
  return entries;
}

/** Equal for the same entries in any order: the pull rewrites the diary only when it changed. */
export function diaryHash(entries: readonly DiaryEntry[]): string {
  const rows = entries
    .map((entry) => JSON.stringify([
      entry.googleEventId, entry.kind, [...entry.stylistIds].sort(), entry.title, entry.colorId,
      entry.start.toISOString(), entry.end.toISOString(), entry.allDay, entry.htmlLink,
    ]))
    .sort();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
```

- [ ] **Step 6: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/lib/calendar-colors.test.ts src/app/lib/google-aliases.test.ts src/app/services/google-diary-classify.test.ts src/app/services/google-busy-mapping.test.ts src/app/services/google-calendar-gateway.test.ts src/app/brand-monochrome.test.ts`
Expected: PASS. Then `pnpm exec tsc --noEmit` and `pnpm exec eslint src/app/lib/calendar-colors.ts src/app/lib/google-aliases.ts src/app/services/google-diary-classify.ts src/app/services/google-busy-mapping.ts src/app/services/google-calendar-gateway.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/app/lib/calendar-colors.ts src/app/lib/calendar-colors.test.ts src/app/lib/google-aliases.ts src/app/lib/google-aliases.test.ts \
  src/app/services/google-diary-classify.ts src/app/services/google-diary-classify.test.ts src/app/services/google-busy-mapping.ts \
  src/app/services/google-calendar-gateway.ts src/app/services/google-calendar-gateway.test.ts
git commit -F - <<'EOF'
feat(gdiary): Google palette and pure diary classification

Google's eleven event colours for the admin board (full literal classes,
readable text), stylist aliases, and classifyDiaryEvent: website and
cancelled events skipped, stylist colour, no-stylist colour, then names in
the title (one letter only in brackets, CJK as a substring). Transparency is
ignored. Real diary titles are the fixtures.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 3: The pull stores the diary; busy time from STYLIST and LEAVE only; retention

**Files:**
- Create: `src/app/services/google-diary-config.ts`, `src/app/services/google-diary-config.test.ts`
- Modify: `src/app/services/google-busy-mapping.ts:12-78` (replace the title-prefix `googleBusyBlocks`)
- Rewrite: `src/app/services/google-busy-mapping.test.ts` (title-prefix tests go; interval, uid and hash tests stay, rewritten over entries)
- Modify: `src/app/services/google-calendar-pull.ts:15-109, 220-257`
- Modify: `src/app/services/google-calendar-pull.test.ts` (fake db, `rendered()` untouched until Task 6, new tests, line 408 test rewritten)
- Modify: `src/app/actions/admin-google-calendar.ts:50-85` (`clearGoogleBusyTime` also deletes the diary) and `src/app/actions/admin-google-calendar.test.ts`
- Modify: `src/app/services/housekeeping-service.ts:17, 50-52` and `src/app/services/housekeeping-service.test.ts`
- Modify: `src/i18n/messages/en/legal.ts:79`, `src/i18n/messages/zh/legal.ts:73` (new `retention.googleDiary`), `src/app/[locale]/privacy/page.tsx:18` (`RETENTION` list), `src/test/pages/privacy-page.test.ts`
- Modify: `src/i18n/messages/en/adminOps.ts:193-198`, `src/i18n/messages/zh/adminOps.ts` (clear-button help mentions the diary copy)

**Interfaces:**
- Consumes (Task 2): `diaryEntriesFrom`, `diaryHash`, `DiaryEntry`, `DiaryKind`, `DiaryConfig`, `GOOGLE_DIARY_RETENTION_DAYS`, `GOOGLE_DIARY_LOOKAHEAD_DAYS`, `isGoogleColorId`, `DEFAULT_UNASSIGNED_COLOR_ID`, `DEFAULT_LEAVE_COLOR_ID`.
- Produces:
  ```ts
  // src/app/services/google-diary-config.ts
  export async function loadDiaryConfig(db?: Pick<PrismaClient, 'stylist' | 'siteSettings'>): Promise<DiaryConfig>;
  // src/app/services/google-busy-mapping.ts
  export function googleBusyBlocks(entries: readonly DiaryEntry[]): GoogleBusyBlock[];   // STYLIST + LEAVE only
  // src/app/services/google-calendar-pull.ts
  export type GooglePullResult = { reverted: number; blocks: number; entries: number; changed: boolean; diaryChanged: boolean; skipped?: 'disabled'; failed?: true };
  //   changed: the GOOGLE busy blocks changed (busy feeds dropped); diaryChanged: the diary entries changed
  // housekeeping result gains `deletedDiaryEntries: number`
  ```

- [ ] **Step 1: Write the failing tests**

`src/app/services/google-diary-config.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const { loadDiaryConfig } = loadServerModule<typeof import('./google-diary-config')>('src/app/services/google-diary-config.ts', {
  '@/app/lib/prisma': new Proxy({}, { get() { throw new Error('default client used'); } }),
});

function db(settings: Record<string, unknown> | null) {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    client: {
      stylist: { findMany: async (args: Record<string, unknown>) => { asked.push(args); return [{ id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' }]; } },
      siteSettings: { findUnique: async () => settings },
    },
  };
}

test('the diary config: active stylists with their Google colour and names, and the live salon colours', async () => {
  const f = db({ googleUnassignedColorId: '4', googleLeaveColorId: '9' });
  assert.deepEqual(await loadDiaryConfig(f.client as never), {
    stylists: [{ id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' }], unassignedColorId: '4', leaveColorId: '9',
  });
  assert.deepEqual((f.asked[0] as { where: unknown }).where, { isActive: true });
});

test('no settings row, or a value that is not a Google colour id: Tomato and Graphite', async () => {
  for (const settings of [null, { googleUnassignedColorId: '', googleLeaveColorId: '12' }]) {
    const config = await loadDiaryConfig(db(settings).client as never);
    assert.deepEqual([config.unassignedColorId, config.leaveColorId], ['11', '8']);
  }
});
```

`src/app/services/google-busy-mapping.test.ts` — replace the whole file:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { GoogleEvent } from './google-calendar-gateway';
import { eventInterval, googleBusyBlocks, googleBusyHash } from './google-busy-mapping';
import type { DiaryEntry } from './google-diary-classify';

function entry(kind: DiaryEntry['kind'], stylistIds: string[], id = 'evt1'): DiaryEntry {
  return {
    googleEventId: id, kind, stylistIds, title: 't', colorId: null, allDay: false, htmlLink: null,
    start: new Date('2026-10-20T09:00:00Z'), end: new Date('2026-10-20T10:00:00Z'),
  };
}
function ev(extra: Partial<GoogleEvent>): GoogleEvent {
  return { id: 'e', status: 'confirmed', start: { dateTime: '2026-10-20T10:00:00+01:00' }, end: { dateTime: '2026-10-20T11:00:00+01:00' }, ...extra };
}

test('only STYLIST and LEAVE entries are busy time; UNASSIGNED and NOTE never are (spec §5)', () => {
  const blocks = googleBusyBlocks([entry('STYLIST', ['ivan'], 'a'), entry('LEAVE', ['lox', 'funky'], 'b'), entry('UNASSIGNED', [], 'c'), entry('NOTE', [], 'd')]);
  assert.deepEqual(blocks.map((block) => block.stylistId), ['ivan', 'lox', 'funky']);
});

test('externalUid is sha256(eventId::stylistId); a repeated stylist id gives one block', () => {
  const [block, ...rest] = googleBusyBlocks([entry('LEAVE', ['ivan', 'ivan'])]);
  assert.equal(rest.length, 0);
  assert.equal(block.externalUid, createHash('sha256').update('evt1::ivan').digest('hex'));
  assert.equal(block.start.toISOString(), '2026-10-20T09:00:00.000Z');
});

test('an all-day event on the BST to GMT change day spans 25 hours; no end covers one day; bad times are null', () => {
  const day = eventInterval(ev({ start: { date: '2026-10-25' }, end: { date: '2026-10-26' } }))!;
  assert.equal(day.start.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal((day.end.getTime() - day.start.getTime()) / 3_600_000, 25);
  const single = eventInterval(ev({ start: { date: '2026-10-24' }, end: undefined }))!;
  assert.equal(single.end.toISOString(), '2026-10-24T23:00:00.000Z');
  for (const bad of [{ start: undefined }, { end: { dateTime: '2026-10-20T10:00:00+01:00' } }, { start: { dateTime: 'nonsense' } }, { start: { date: '2026-13-45' }, end: undefined }]) {
    assert.equal(eventInterval(ev(bad as Partial<GoogleEvent>)), null, JSON.stringify(bad));
  }
});

test('the busy hash ignores order and changes with content', () => {
  const a = googleBusyBlocks([entry('LEAVE', ['ivan'], 'a'), entry('STYLIST', ['lox'], 'b')]);
  assert.equal(googleBusyHash(a), googleBusyHash([...a].reverse()));
  assert.notEqual(googleBusyHash(a), googleBusyHash(a.slice(1)));
  assert.equal(googleBusyHash([]), googleBusyHash([]));
});
```

`src/app/services/google-calendar-pull.test.ts` — harness changes, then new tests:

1. `STYLISTS` gains Google fields and `stylist.findMany` returns them:
   ```ts
   const STYLISTS = [
     { id: 's1', name: 'Ivan', isActive: true, googleColorId: '1', googleAliases: null },
     { id: 's2', name: 'Lox', isActive: true, googleColorId: '5', googleAliases: 'L' },
     { id: 's3', name: 'Chan', isActive: false, googleColorId: null, googleAliases: null },
   ];
   // in fakeDb, stylist.findMany:
   return list.map(({ id, name, googleColorId, googleAliases }) => ({ id, name, googleColorId, googleAliases }));
   ```
2. `matches()` learns `lte` (`if (op === 'lte') return a <= b;`).
3. `fakeDb` gains a diary table (options `diary?: Diary[]`, `failDiaryCreate?: boolean`), included in `$transaction`'s save/restore and in the returned object as `get diary()`:
   ```ts
   type Diary = { id: string; googleEventId: string; kind: string; stylistIdsJson: string; title: string; colorId: string | null; start: Date; end: Date; allDay: boolean; htmlLink: string | null; lastSyncAt: Date };
   let diary: Diary[] = (options.diary ?? []).map((row) => ({ ...row }));
   let diarySeq = 0;
   // in db:
   googleDiaryEntry: {
     async findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }) {
       return diary.filter((row) => matches(row, args.where)).map((row) => Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key as keyof Diary]])));
     },
     async deleteMany(args: { where: Record<string, unknown> }) {
       const before = diary.length;
       diary = diary.filter((row) => !matches(row, args.where));
       return { count: before - diary.length };
     },
     async createMany(args: { data: Omit<Diary, 'id'>[] }) {
       if (options.failDiaryCreate) throw new Error('database unavailable');
       for (const row of args.data) {
         if (diary.some((d) => d.googleEventId === row.googleEventId)) throw new Error('Unique constraint failed on (googleEventId)');
         diary.push({ id: `d${++diarySeq}`, ...row });
       }
       return { count: args.data.length };
     },
   },
   // $transaction: saved = { blocks, state, diary: diary.map((row) => ({ ...row })) }; restore diary on error.
   ```
4. Every `deepEqual` on a pull result gains `entries` and `diaryChanged` (website-only listings: `entries: 0, diaryChanged: false`; the disabled result: `{ reverted: 0, blocks: 0, entries: 0, changed: false, diaryChanged: false, skipped: 'disabled' }`).
5. Every `googleBusyBlocks(listing, ACTIVE)` in the file becomes `googleBusyBlocks(diaryEntriesFrom(listing, CONFIG_DIARY))` with `const CONFIG_DIARY = { stylists: ACTIVE.map(({ id, name, googleColorId, googleAliases }) => ({ id, name, googleColorId, googleAliases })), unassignedColorId: '11', leaveColorId: '8' };` (import `diaryEntriesFrom` from `./google-diary-classify`).
6. Replace the test at line 408 ("an event naming no stylist blocks every active stylist…") with:
   ```ts
   test('an event naming no stylist is a note and blocks nothing; a cancelled one is not stored at all', async () => {
     const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
     const google = fakeGoogle([
       foreign('training', 'Salon training', 60, 180),
       foreign('called-off', 'Lox: dentist', 60, 90, { status: 'cancelled' }),
     ]);
     const { pull } = load();
     const result = await run(pull, store.db, google.gateway);
     assert.deepEqual([result.blocks, result.entries, result.changed, result.diaryChanged], [0, 1, false, true]);
     assert.deepEqual(store.blocks, []);
     assert.deepEqual(store.diary.map((row) => [row.googleEventId, row.kind]), [['training', 'NOTE']]);
   });
   ```
7. New tests (add after the rewritten one):
   ```ts
   test('the diary is stored with its kinds; only STYLIST and LEAVE entries become busy blocks', async () => {
     const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
     const google = fakeGoogle([
       foreign('amy', 'Amy 07700 900123', 60, 120, { colorId: '1', htmlLink: 'https://www.google.com/calendar/event?eid=YW15' }),
       foreign('walkin', 'Cut - Erin(W)', 60, 120, { colorId: '11' }),
       foreign('late', '遲返 (L)', 0, 60, { colorId: '8' }),
       foreign('note', '卡機', 30, 60, { colorId: '8' }),
     ]);
     const { pull, invalidations } = load();
     const result = await run(pull, store.db, google.gateway);
     assert.deepEqual(result, { reverted: 0, blocks: 2, entries: 4, changed: true, diaryChanged: true });
     assert.deepEqual(store.blocks.map((row) => row.stylistId).sort(), ['s1', 's2']);
     assert.deepEqual(store.diary.map((row) => [row.googleEventId, row.kind, JSON.parse(row.stylistIdsJson), row.title, row.colorId]).sort(), [
       ['amy', 'STYLIST', ['s1'], 'Amy 07700 900123', '1'],
       ['late', 'LEAVE', ['s2'], '遲返 (L)', '8'],
       ['note', 'NOTE', [], '卡機', '8'],
       ['walkin', 'UNASSIGNED', [], 'Cut - Erin(W)', '11'],
     ]);
     assert.equal(store.diary.find((row) => row.googleEventId === 'amy')!.htmlLink, 'https://www.google.com/calendar/event?eid=YW15');
     assert.equal(store.log.transactions, 1, 'busy time and diary in one transaction');
     assert.equal(invalidations.count, 1);
   });

   test('a transparent all-day leave blocks Lox (transparency is ignored)', async () => {
     const tomorrow = new Date(NOW.getTime() + DAY * 60_000).toISOString().slice(0, 10);
     const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
     const google = fakeGoogle([{ id: 'loxoff', status: 'confirmed', summary: 'LoxOff', colorId: '8', transparency: 'transparent', start: { date: tomorrow } }]);
     const { pull } = load();
     assert.equal((await run(pull, store.db, google.gateway)).blocks, 1);
     assert.deepEqual(store.blocks.map((row) => row.stylistId), ['s2']);
     assert.equal(store.diary[0].allDay, true);
   });

   test('a renamed walk-in rewrites the diary but not the busy time, and the busy feeds stay cached', async () => {
     const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
     const google = fakeGoogle([foreign('walkin', 'Walk-in', 60, 120, { colorId: '11' })]);
     const { pull, invalidations } = load();
     await run(pull, store.db, google.gateway);
     google.listing = [foreign('walkin', 'Walk-in Mrs Chan', 60, 120, { colorId: '11' })];
     const second = await run(pull, store.db, google.gateway, at(1));
     assert.deepEqual([second.changed, second.diaryChanged], [false, true]);
     assert.equal(store.diary[0].title, 'Walk-in Mrs Chan');
     assert.equal(invalidations.count, 0, 'no busy block changed');
     // Unchanged third pull: no transaction at all.
     const transactions = store.log.transactions;
     assert.deepEqual(await run(pull, store.db, google.gateway, at(2)), { reverted: 0, blocks: 0, entries: 1, changed: false, diaryChanged: false });
     assert.equal(store.log.transactions, transactions);
   });

   test('the listing starts 30 days back; entries that ended before that are deleted', async () => {
     const old = { id: 'old', googleEventId: 'old', kind: 'NOTE', stylistIdsJson: '[]', title: 'old', colorId: null, start: at(-32 * DAY), end: at(-31 * DAY), allDay: false, htmlLink: null, lastSyncAt: at(-31 * DAY) };
     const recent = { ...old, id: 'recent', googleEventId: 'recent', start: at(-29 * DAY), end: at(-29 * DAY + 60) };
     const store = fakeDb([], { state: { busyHash: EMPTY_HASH }, diary: [old, recent] });
     const google = fakeGoogle([foreign('recent', 'old', -29 * DAY, -29 * DAY + 60)]);
     const { pull } = load();
     await run(pull, store.db, google.gateway);
     assert.equal(google.lists[0].timeMin.getTime(), at(-30 * DAY).getTime());
     assert.equal(google.lists[0].timeMax.getTime(), at(90 * DAY).getTime());
     assert.deepEqual(store.diary.map((row) => row.googleEventId), ['recent']);
   });

   test('a failure writing the diary rolls the busy time back with it', async () => {
     const store = fakeDb([], { state: { busyHash: EMPTY_HASH }, failDiaryCreate: true });
     const google = fakeGoogle([foreign('evt1', 'Ivan off', 60, 120)]);
     const { pull } = load();
     const result = await run(pull, store.db, google.gateway);
     assert.equal(result.failed, true);
     assert.deepEqual([store.blocks, store.diary], [[], []]);
     assert.equal(store.state!.lastPullError, OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED);
   });
   ```
   Any other existing pull test whose expectations relied on the 1-day listing window or on title-prefix semantics ("Ivan: dentist" still blocks Ivan: it is LEAVE now) is updated to the new result shape only; behaviour assertions stay. Any other test that builds a `GooglePullResult` (for example in `google-calendar-job.test.ts`; `pnpm exec tsc --noEmit` lists them) gains `entries: 0, diaryChanged: false`.

`src/app/actions/admin-google-calendar.test.ts` — in the existing `clearGoogleBusyTime` test(s), add `googleDiaryEntry: { deleteMany: async () => { log.push('diary'); return { count: 4 }; } }` to the fake transaction client and assert `log` includes `'diary'` before the audit, and the audit metadata is `{ removed: <blocks>, diaryRemoved: 4 }`.

`src/app/services/housekeeping-service.test.ts` — add `const diary: Row[] = [];` and `googleDiaryEntry: table(diary)` to `fixture()` (return `diary` too), then:

```ts
test('retention deletes diary entries 30 days after they end, also while the Google sync is off', async () => {
  const f = fixture();
  const day = 86_400_000;
  f.diary.push({ id: 'old', end: new Date(now.getTime() - 31 * day) }, { id: 'kept', end: new Date(now.getTime() - 29 * day) }, { id: 'future', end: new Date(now.getTime() + day) });
  const result = await runHousekeeping({ db: f.db, now });
  assert.equal(result.deletedDiaryEntries, 1);
  assert.deepEqual(f.diary.map((row) => row.id), ['kept', 'future']);
});
```

`src/test/pages/privacy-page.test.ts` — import `GOOGLE_DIARY_RETENTION_DAYS` from `../../app/services/google-diary-classify` and add:

```ts
// Google diary mirror: the website keeps a staff-only copy of the diary's titles for 30 days.
test('the notice says the website keeps a copy of the salon diary, for whom and how long', async () => {
  const en = (await privacyPage('en-GB')).text;
  assert.ok(en.includes('so our staff see it in one place and online booking does not clash with it'));
  assert.ok(en.includes(`deleted ${GOOGLE_DIARY_RETENTION_DAYS} days after the entry ends`));
  const zh = (await privacyPage('zh-HK')).text;
  assert.ok(zh.includes(`於記錄結束後 ${GOOGLE_DIARY_RETENTION_DAYS} 日刪除`));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/google-diary-config.test.ts src/app/services/google-busy-mapping.test.ts src/app/services/google-calendar-pull.test.ts src/app/actions/admin-google-calendar.test.ts src/app/services/housekeeping-service.test.ts src/test/pages/privacy-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/app/services/google-diary-config.ts`:

```ts
import 'server-only';

// How the salon diary is read (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §3):
// active stylists' Google colours and names, and the two salon colours, from the
// live rows (never the day-cached site settings).

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_LEAVE_COLOR_ID, DEFAULT_UNASSIGNED_COLOR_ID, isGoogleColorId } from '@/app/lib/calendar-colors';
import type { DiaryConfig } from './google-diary-classify';

type ConfigDb = Pick<PrismaClient, 'stylist' | 'siteSettings'>;

export async function loadDiaryConfig(db?: ConfigDb): Promise<DiaryConfig> {
  const client = db ?? (await import('@/app/lib/prisma')).default;
  const [stylists, settings] = await Promise.all([
    client.stylist.findMany({
      where: { isActive: true },
      select: { id: true, name: true, googleColorId: true, googleAliases: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    client.siteSettings.findUnique({ where: { id: 'singleton' }, select: { googleUnassignedColorId: true, googleLeaveColorId: true } }),
  ]);
  return {
    stylists,
    unassignedColorId: isGoogleColorId(settings?.googleUnassignedColorId) ? settings.googleUnassignedColorId : DEFAULT_UNASSIGNED_COLOR_ID,
    leaveColorId: isGoogleColorId(settings?.googleLeaveColorId) ? settings.googleLeaveColorId : DEFAULT_LEAVE_COLOR_ID,
  };
}
```

`src/app/services/google-busy-mapping.ts` — the file keeps `GoogleBusyBlock`, `DAY_RE`, `nextDay`, `salonMidnight`, `eventInterval` (exported) and `googleBusyHash`; delete `escapeRegExp` and the old `googleBusyBlocks`; drop the `isWebsiteEvent` import; update the header comment ("Busy blocks for the stylists the diary names (spec §5 of the diary mirror design)"); add:

```ts
import type { DiaryEntry } from './google-diary-classify';

/**
 * STYLIST and LEAVE entries block their stylists, exactly as #72 stored them
 * (one row per event and stylist). UNASSIGNED entries are the chair rule's
 * (diary-chair-rule.ts) and NOTE entries block nothing: neither is ever a busy
 * block, so neither reaches a Fresha busy feed.
 */
export function googleBusyBlocks(entries: readonly DiaryEntry[]): GoogleBusyBlock[] {
  const blocks: GoogleBusyBlock[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'STYLIST' && entry.kind !== 'LEAVE') continue;
    for (const stylistId of new Set(entry.stylistIds)) {
      blocks.push({
        externalUid: createHash('sha256').update(`${entry.googleEventId}::${stylistId}`).digest('hex'),
        stylistId, start: entry.start, end: entry.end,
      });
    }
  }
  return blocks;
}
```

`src/app/services/google-calendar-pull.ts`:

- Header comment: add "and the salon diary (GoogleDiaryEntry, docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §5–§7)".
- Imports: add `import type { Prisma } from '@prisma/client';` (merge with the existing `PrismaClient` import), `import { diaryEntriesFrom, diaryHash, GOOGLE_DIARY_LOOKAHEAD_DAYS, GOOGLE_DIARY_RETENTION_DAYS, type DiaryEntry, type DiaryKind } from './google-diary-classify';`, `import { loadDiaryConfig } from './google-diary-config';`.
- Constants:
  ```ts
  /** Inbound window (diary mirror spec §7): Google is listed from 30 days back to 90 days ahead. */
  const LOOKBACK_MS = GOOGLE_DIARY_RETENTION_DAYS * DAY_MS;
  const LOOKAHEAD_MS = GOOGLE_DIARY_LOOKAHEAD_DAYS * DAY_MS;
  /** GOOGLE busy blocks keep #72's one-day look-back: busy time that long gone changes nothing bookable. */
  const BUSY_LOOKBACK_MS = DAY_MS;
  ```
- `GooglePullResult` as in Interfaces.
- Replace `storeBusyBlocks` with `storeDiary`:
  ```ts
  const diarySelect = {
    googleEventId: true, kind: true, stylistIdsJson: true, title: true, colorId: true, start: true, end: true, allDay: true, htmlLink: true,
  } satisfies Prisma.GoogleDiaryEntrySelect;
  type StoredDiaryRow = Prisma.GoogleDiaryEntryGetPayload<{ select: typeof diarySelect }>;

  function storedStylistIds(json: string): string[] {
    try {
      const value: unknown = JSON.parse(json);
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  function fromRow({ stylistIdsJson, kind, ...row }: StoredDiaryRow): DiaryEntry {
    return { ...row, kind: kind as DiaryKind, stylistIds: storedStylistIds(stylistIdsJson) };
  }

  /**
   * Stores the diary and the busy time it implies. Entries that ended before
   * the window are deleted first (privacy notice: 30 days). Then, when either
   * changed, ONE transaction replaces the window's GOOGLE busy blocks (as #72)
   * and/or the window's diary entries, so readers never see half a diary.
   * Compared at this pull's `now`: busy blocks that have not ended against the
   * stored ones that have not ended (as #72), the window's entries against the
   * stored window. The busy feeds are dropped only when busy blocks changed: a
   * renamed walk-in or a new note changes nothing Fresha imports.
   */
  async function storeDiary(
    db: PrismaClient, entries: DiaryEntry[], blocks: GoogleBusyBlock[], range: { timeMin: Date; timeMax: Date }, now: Date,
  ): Promise<{ busyChanged: boolean; diaryChanged: boolean }> {
    await db.googleDiaryEntry.deleteMany({ where: { end: { lte: range.timeMin } } });
    const [storedBlocks, storedEntries] = await Promise.all([
      db.externalBusyBlock.findMany({
        where: { source: 'GOOGLE', end: { gt: now } },
        select: { externalUid: true, stylistId: true, start: true, end: true },
      }),
      db.googleDiaryEntry.findMany({ where: { end: { gt: range.timeMin }, start: { lt: range.timeMax } }, select: diarySelect }),
    ]);
    const hash = googleBusyHash(notEnded(blocks, now));
    const busyChanged = googleBusyHash(storedBlocks) !== hash;
    const diaryChanged = diaryHash(storedEntries.map(fromRow)) !== diaryHash(entries);
    if (!busyChanged && !diaryChanged) return { busyChanged, diaryChanged };
    await db.$transaction(async (tx) => {
      if (busyChanged) {
        await tx.externalBusyBlock.deleteMany({
          where: { source: 'GOOGLE', end: { gt: new Date(now.getTime() - BUSY_LOOKBACK_MS) }, start: { lt: range.timeMax } },
        });
        for (let offset = 0; offset < blocks.length; offset += BATCH_SIZE) {
          const batch = blocks.slice(offset, offset + BATCH_SIZE);
          // An event stored before the window and moved into it keeps its key: drop the old row first.
          await tx.externalBusyBlock.deleteMany({ where: { source: 'GOOGLE', externalUid: { in: batch.map((block) => block.externalUid) } } });
          await tx.externalBusyBlock.createMany({
            data: batch.map((block) => ({
              source: 'GOOGLE', stylistId: block.stylistId, externalUid: block.externalUid,
              start: block.start, end: block.end, summary: null, lastSyncAt: now,
            })),
          });
        }
        await tx.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, busyHash: hash }, update: { busyHash: hash } });
      }
      if (diaryChanged) {
        await tx.googleDiaryEntry.deleteMany({ where: { end: { gt: range.timeMin }, start: { lt: range.timeMax } } });
        for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
          const batch = entries.slice(offset, offset + BATCH_SIZE);
          // An entry stored outside the window and moved into it keeps its id: drop the old row first.
          await tx.googleDiaryEntry.deleteMany({ where: { googleEventId: { in: batch.map((entry) => entry.googleEventId) } } });
          await tx.googleDiaryEntry.createMany({
            data: batch.map((entry) => ({
              googleEventId: entry.googleEventId, kind: entry.kind, stylistIdsJson: JSON.stringify(entry.stylistIds),
              title: entry.title, colorId: entry.colorId, start: entry.start, end: entry.end,
              allDay: entry.allDay, htmlLink: entry.htmlLink, lastSyncAt: now,
            })),
          });
        }
      }
    }, { timeout: 15_000, maxWait: 5_000 });
    if (busyChanged) {
      // The stylists' outbound feeds export GOOGLE blocks. A route handler cannot
      // updateTag; the feed's one-day safety net heals a failed drop.
      try {
        invalidateStylistIcalFeedFromCron();
      } catch (error) {
        console.error('Dropping the busy-feed cache after a Google Calendar pull failed:', describeFault(error));
      }
    }
    return { busyChanged, diaryChanged };
  }
  ```
- In `pullGoogleCalendar`: the disabled return and the initial `result` gain `entries: 0, diaryChanged: false`; replace the busy part of the `try` with:
  ```ts
  const range = { timeMin: new Date(now.getTime() - LOOKBACK_MS), timeMax: new Date(now.getTime() + LOOKAHEAD_MS) };
  const events = await gateway.listEvents(range);
  // Busy time and the diary first: they are what keep the website from selling a
  // taken chair, and the write-backs after them are the slow part. Website events
  // are never part of the diary (classifyDiaryEvent's echo guard).
  const entries = diaryEntriesFrom(events, await loadDiaryConfig(db));
  const busyFrom = now.getTime() - BUSY_LOOKBACK_MS;
  const blocks = distinct(googleBusyBlocks(entries.filter((entry) => entry.end.getTime() > busyFrom)));
  const stored = await storeDiary(db, entries, blocks, range, now);
  result.changed = stored.busyChanged;
  result.diaryChanged = stored.diaryChanged;
  result.blocks = blocks.length;
  result.entries = entries.length;
  result.reverted = await revertWebsiteEvents(db, gateway, events, range, now, withinBudget);
  ```
  (`revertWebsiteEvents` is unchanged: its `open` filter still limits write-backs to the push window.)

`src/app/actions/admin-google-calendar.ts` `clearGoogleBusyTime`: inside the transaction add `const diary = await tx.googleDiaryEntry.deleteMany({});` after the busy delete, audit metadata `{ removed: count, diaryRemoved: diary.count }`, and update its doc comment ("…deletes every GOOGLE block and the copy of the diary (`GoogleDiaryEntry`)…").

`src/app/services/housekeeping-service.ts`: result gains `deletedDiaryEntries: 0`; after the busy-block step:

```ts
// The salon diary copy (privacy notice: deleted 30 days after the entry ends),
// also while the Google sync is off and no pull runs.
const oldDiary = { end: { lt: new Date(now.getTime() - GOOGLE_DIARY_RETENTION_DAYS * DAY_MS) } };
const diary = await db.googleDiaryEntry.findMany({ where: oldDiary, select: { id: true }, orderBy: [{ end: 'asc' }, { id: 'asc' }], take: BATCH_SIZE });
if (diary.length) result.deletedDiaryEntries = (await db.googleDiaryEntry.deleteMany({ where: { ...oldDiary, id: { in: diary.map((row) => row.id) } } })).count;
```

(import `GOOGLE_DIARY_RETENTION_DAYS` from `./google-diary-classify`).

Messages:
- `src/i18n/messages/en/legal.ts` `privacy.retention`, after `googleCalendar`:
  `googleDiary: '<b>The salon diary shown to our staff on this website:</b> a copy of the titles and times of the entries in the salon’s Google Calendar, in which our staff may write your name or phone number. We keep it so our staff see it in one place and online booking does not clash with it. Only our staff can see it, and each entry is deleted 30 days after the entry ends.',`
- `src/i18n/messages/zh/legal.ts` same place:
  `googleDiary: '<b>本網站為員工顯示的本店記事簿：</b>本店 Google 日曆內各項記錄的標題及時間的副本，員工可能在其中寫上你的姓名或電話號碼。我們保留這份副本，讓員工可在同一處查看，並避免網上預約與記事簿衝突。只有本店員工可以查看，每項記錄於記錄結束後 30 日刪除。',`
- `src/app/[locale]/privacy/page.tsx:18`: `RETENTION` becomes `['account', 'bookings', 'payments', 'security', 'reviews', 'emails', 'googleCalendar', 'googleDiary', 'rateLimits', 'links', 'marketing']`.
- `adminOps.integrations.google.clear` (en): `helpOn` and `helpOff` end with " It also removes the copy of the diary shown on Admin → Schedule."; `confirm` becomes 'Remove every busy period read from Google Calendar, and the copy of the diary shown on Admin → Schedule? Those hours become bookable on the website again, and Fresha sees them free after its next import. Bookings are not affected.'. zh: append "亦會刪除後台預約時間表上顯示的記事簿副本。" to both helps, and the same addition in `confirm`.

- [ ] **Step 4: Run the tests**

Run the Step 2 command, then `pnpm test` (the whole suite: other tests reading pull results or the privacy notice must still pass), `pnpm exec tsc --noEmit`, `pnpm exec eslint` on the changed files.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/google-diary-config.ts src/app/services/google-diary-config.test.ts src/app/services/google-busy-mapping.ts \
  src/app/services/google-busy-mapping.test.ts src/app/services/google-calendar-pull.ts src/app/services/google-calendar-pull.test.ts \
  src/app/actions/admin-google-calendar.ts src/app/actions/admin-google-calendar.test.ts src/app/services/housekeeping-service.ts \
  src/app/services/housekeeping-service.test.ts src/i18n/messages/en/legal.ts src/i18n/messages/zh/legal.ts \
  'src/app/[locale]/privacy/page.tsx' src/test/pages/privacy-page.test.ts src/i18n/messages/en/adminOps.ts src/i18n/messages/zh/adminOps.ts
git commit -F - <<'EOF'
feat(gdiary): pull stores the salon diary; busy time from stylist and leave entries only

The pull lists 30 days back to 90 ahead, stores each classified event as a
GoogleDiaryEntry and GOOGLE busy blocks for STYLIST and LEAVE entries only,
in one transaction; #72's title-prefix rule (an unmatched title blocked
every stylist) is gone. Entries are deleted 30 days after they end, by the
pull and by housekeeping (also with the sync off); Clear Google busy time
removes them too. The privacy notice says so in both languages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 4: The chair rule on every customer path

**Files:**
- Create: `src/app/services/diary-chair-rule.ts`, `src/app/services/diary-chair-rule.test.ts`
- Create: `src/app/services/diary-chair-load.ts`
- Modify: `src/app/services/booking-days.ts:26-58` (optional `chairAllows` hook) and `src/app/services/booking-days.test.ts`
- Modify: `src/app/services/booking-service.ts` — `assertAppointmentSlotAvailable` (lines 54-100), `getAvailableSlots` (140-185), `getAvailableSlotsUnion` (203-265), `getBookingDays` (273-322), `chooseFreeStylist` (503-534), `createBookingForFirstAvailable` (568), `precheckBookingRequest` (611-612)
- Modify: `src/app/actions/admin.ts:578, 687, 720, 847` (staff paths opt out)
- Create: `src/app/services/booking-diary-chair.test.ts`
- Modify (fake stubs only): every test whose fake database reaches these functions — at least `src/test/booking-fixture.ts:188`, `src/test/deposit-fixture.ts`, `src/app/services/booking-synced-clash.test.ts`, `booking-days-loader.test.ts` (the "fourteen days cost exactly three queries" test becomes four: `googleDiaryEntry` added to the sorted list), `booking-rota-and-patch-test.test.ts`, `booking-persistence.test.ts`, `booking-horizon.test.ts`, `booking-closed-hours.test.ts`, `booking-anyone-unavailable.test.ts`, `src/app/actions/booking-concurrency.test.ts`, and any other `pnpm test` failure reading `Cannot read properties of undefined (reading 'findMany')`: add `googleDiaryEntry: { findMany: async () => [] }` to that fake.

**Interfaces:**
- Consumes: `WorkingHours` (`booking-days.ts`), `BookedInterval` (`scheduling.ts`), `loadExternalBusy`/`toBookedInterval` (`external-busy.ts`), `resolveSalonDateTime`/`salonDateKey`/`salonDayWindow` (`salon-time.ts`), `prisma.googleDiaryEntry` (Task 1).
- Produces:
  ```ts
  // src/app/services/diary-chair-rule.ts (pure)
  export type ChairInterval = { start: Date; end: Date };
  export type ChairContext = {
    unassigned: readonly ChairInterval[];
    hoursByStylist: ReadonlyMap<string, readonly WorkingHours[]>;     // every ACTIVE stylist's working rows (isOff false)
    busyByStylist: ReadonlyMap<string, readonly BookedInterval[]>;    // appointments + busy blocks
  };
  export type ChairCheck = { allowed: true } | { allowed: false; needed: number; free: number; start: Date; end: Date };
  export function maxConcurrent(intervals: readonly ChairInterval[]): number;
  export function checkDiaryChair(ctx: ChairContext | null, stylistId: string, start: Date, durationMin: number): ChairCheck;
  export function diaryChairAllows(ctx: ChairContext | null, stylistId: string, start: Date, durationMin: number): boolean;
  // src/app/services/diary-chair-load.ts
  export async function loadChairContext(db: PrismaClient | Prisma.TransactionClient, window: { start: Date; end: Date }, options?: { excludeAppointmentId?: string }): Promise<ChairContext | null>;
  // src/app/services/booking-days.ts — buildBookingDays input gains:
  chairAllows?: (stylistId: string, start: Date, duration: number) => boolean;
  // src/app/services/booking-service.ts
  export async function assertAppointmentSlotAvailable(tx, appointment, date, loadedBlocking?: BookedInterval[], options?: { chairRule?: boolean }): Promise<void>;  // chairRule defaults to true
  ```

- [ ] **Step 1: Write the failing pure tests** `src/app/services/diary-chair-rule.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSalonDateTime } from './salon-time';
import type { WorkingHours } from './booking-days';
import type { BookedInterval } from './scheduling';
import { checkDiaryChair, diaryChairAllows, maxConcurrent, type ChairContext } from './diary-chair-rule';

// 2026-10-06 is a Tuesday (dayOfWeek 2) in British Summer Time.
const DAY = '2026-10-06';
const at = (time: string) => resolveSalonDateTime(DAY, time).utc;
const red = (from: string, to: string) => ({ start: at(from), end: at(to) });
const hours = (startTime = '10:00', endTime = '19:00'): WorkingHours[] => [{ dayOfWeek: 2, startTime, endTime }];
const booked = (time: string, minutes = 60): BookedInterval => ({ start: at(time), durationMin: minutes });
function ctx(input: { unassigned: { start: Date; end: Date }[]; hours?: Record<string, WorkingHours[]>; busy?: Record<string, BookedInterval[]> }): ChairContext {
  return {
    unassigned: input.unassigned,
    hoursByStylist: new Map(Object.entries(input.hours ?? { lox: hours(), funky: hours() })),
    busyByStylist: new Map(Object.entries(input.busy ?? {})),
  };
}

test('no walk-in in the diary: always allowed', () => {
  assert.equal(diaryChairAllows(null, 'lox', at('15:00'), 60), true);
  assert.equal(diaryChairAllows(ctx({ unassigned: [] }), 'lox', at('15:00'), 60), true);
});

test('one walk-in and another stylist free for all of it: allowed', () => {
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')] }), 'lox', at('15:00'), 60), true);
});

test('the only other stylist is booked over the walk-in: refused, with the numbers and the span', () => {
  const check = checkDiaryChair(ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:30')] } }), 'lox', at('15:00'), 60);
  assert.deepEqual(check, { allowed: false, needed: 1, free: 0, start: at('15:00'), end: at('16:00') });
});

test('conservative: a stylist rostered for only part of the walk-in does not count', () => {
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], hours: { lox: hours(), funky: hours('10:00', '15:30') } }), 'lox', at('15:00'), 60), false);
});

test('a stylist off that day or with no hours does not count, and the booked stylist never counts', () => {
  const offTuesday: WorkingHours[] = [{ dayOfWeek: 3, startTime: '10:00', endTime: '19:00' }];
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], hours: { lox: hours(), funky: offTuesday } }), 'lox', at('15:00'), 60), false);
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], hours: { lox: hours() } }), 'lox', at('15:00'), 60), false);
});

test('two walk-ins at once need two other free stylists', () => {
  const two = [red('15:00', '16:00'), red('15:30', '16:30')];
  assert.equal(diaryChairAllows(ctx({ unassigned: two }), 'lox', at('15:00'), 60), false);
  assert.equal(diaryChairAllows(ctx({ unassigned: two, hours: { lox: hours(), funky: hours(), ivan: hours() } }), 'lox', at('15:00'), 60), true);
});

test('back-to-back walk-ins need one chair, not two', () => {
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '15:30'), red('15:30', '16:00')] }), 'lox', at('15:00'), 60), true);
});

test('only the part of a walk-in inside the booking counts; a booking that only touches it is unaffected', () => {
  // 14:00–15:30 meets the 15:00–16:00 walk-in for 15:00–15:30; Funky is busy only from 15:30.
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:30')] } }), 'lox', at('14:00'), 90), true);
  assert.equal(diaryChairAllows(ctx({ unassigned: [red('15:00', '16:00')], busy: { funky: [booked('15:00')] } }), 'lox', at('14:00'), 60), true);
});

test('maxConcurrent counts the most walk-ins at one instant (half-open intervals)', () => {
  assert.equal(maxConcurrent([]), 0);
  assert.equal(maxConcurrent([red('10:00', '11:00'), red('10:30', '11:30'), red('11:00', '12:00')]), 2);
  assert.equal(maxConcurrent([red('10:00', '11:00'), red('11:00', '12:00')]), 1);
});
```

- [ ] **Step 2: Write the failing service tests** `src/app/services/booking-diary-chair.test.ts`

```ts
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadServerModule } from '../../test/load-server-module';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { resolveSalonDateTime } from './salon-time';

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

// A red walk-in (UNASSIGNED) 15:00–16:00 on Tuesday 2026-10-06 (spec §6).
const DAY = '2026-10-06';
const at = (time: string) => resolveSalonDateTime(DAY, time).utc;
type Where = Record<string, unknown>;
const idsOf = (value: unknown) => (typeof value === 'string' ? [value] : (value as { in: string[] }).in);

function fixture(input: { funkyBusyAt?: string; funkyUntil?: string; ivan?: boolean } = {}) {
  const hours = [
    { stylistId: 'lox', dayOfWeek: 2, startTime: '10:00', endTime: '19:00' },
    { stylistId: 'funky', dayOfWeek: 2, startTime: '10:00', endTime: input.funkyUntil ?? '19:00' },
    ...(input.ivan ? [{ stylistId: 'ivan', dayOfWeek: 2, startTime: '10:00', endTime: '19:00' }] : []),
  ];
  const appointments = input.funkyBusyAt
    ? [{ id: 'f1', stylistId: 'funky', date: at(input.funkyBusyAt), durationAtBooking: 60, service: { duration: 60 } }]
    : [];
  const walkIn = { start: at('15:00'), end: at('16:00') };
  const db = {
    availability: {
      findMany: async ({ where }: { where: Where }) => hours.filter((row) => !where.stylistId || row.stylistId === where.stylistId),
      findFirst: async ({ where }: { where: Where }) => hours.find((row) => row.stylistId === where.stylistId && row.dayOfWeek === where.dayOfWeek) ?? null,
    },
    appointment: {
      findMany: async ({ where }: { where: Where }) => appointments.filter((row) => idsOf(where.stylistId).includes(row.stylistId)),
      count: async () => 0,
    },
    externalBusyBlock: { findMany: async () => [] },
    googleDiaryEntry: {
      findMany: async ({ where }: { where: { kind: string; start: { lt: Date }; end: { gt: Date } } }) =>
        [walkIn].filter((row) => where.kind === 'UNASSIGNED' && row.start < where.start.lt && row.end > where.end.gt),
    },
  };
  const service = loadServerModule<typeof import('./booking-service')>('src/app/services/booking-service.ts', {
    '@/app/lib/prisma': db,
    '@/app/lib/booking-maintenance': { assertOnlineBookingReady: async () => ({}) },
    './notification-outbox-service': {},
    './pricing/quote-service': { quoteForNewBooking: async () => ({ service: { id: 'svc', duration: 60, treatwellExternalId: null }, quote: { amountPence: 3000 } }) },
  });
  return { service, db };
}
const slot = (days: { slots: { time: string; available: boolean }[] }[], time: string) => days[0].slots.find((s) => s.time === time)?.available;

test('Lox’s times meeting the walk-in are taken when nobody else could serve it (Funky booked)', async () => {
  const { service } = fixture({ funkyBusyAt: '15:00' });
  const days = await service.getBookingDays('lox', [DAY], 60);
  for (const time of ['14:30', '15:00', '15:30']) assert.equal(slot(days, time), false, time);
  for (const time of ['14:00', '16:00']) assert.equal(slot(days, time), true, time);
  assert.ok(!(await service.getAvailableSlots('lox', DAY, 60)).some((s) => s.time === '15:00'));
});

test('with Funky free, Lox keeps 15:00: Funky serves the walk-in', async () => {
  const { service } = fixture();
  assert.equal(slot(await service.getBookingDays('lox', [DAY], 60), '15:00'), true);
  assert.ok((await service.getAvailableSlots('lox', DAY, 60)).some((s) => s.time === '15:00'));
});

test('Funky rostered only until 15:30 does not count: the walk-in must be covered whole', async () => {
  assert.equal(slot(await fixture({ funkyUntil: '15:30' }).service.getBookingDays('lox', [DAY], 60), '15:00'), false);
});

test('"Anyone" stays open while one stylist can take the booking and another the walk-in, and closes when not', async () => {
  assert.equal(slot(await fixture().service.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '15:00'), true);
  assert.equal(slot(await fixture({ funkyBusyAt: '15:00' }).service.getBookingDays(ANY_STYLIST_ID, [DAY], 60), '15:00'), false);
  assert.ok(!(await fixture({ funkyBusyAt: '15:00' }).service.getAvailableSlotsUnion(DAY, 60)).some((s) => s.time === '15:00'));
});

test('a submitted request is refused with the slot-unavailable error; { chairRule: false } (staff) is not', async () => {
  const { service, db } = fixture({ funkyBusyAt: '15:00' });
  const appointment = { id: '', stylistId: 'lox', durationAtBooking: 60, service: { duration: 60 } };
  await assert.rejects(service.assertAppointmentSlotAvailable(db as never, appointment, at('15:00')), (error: { code?: string }) => error.code === 'SLOT_UNAVAILABLE');
  await service.assertAppointmentSlotAvailable(db as never, appointment, at('15:00'), undefined, { chairRule: false });
});

test('"Anyone": NO_STYLIST_AT_TIME when no candidate leaves a chair; a free stylist outside the candidates still serves the walk-in', async () => {
  const request = { userId: 'u1', serviceId: 'svc', date: at('15:00'), candidateStylistIds: ['lox', 'funky'] };
  await assert.rejects(fixture({ funkyBusyAt: '15:00' }).service.precheckBookingRequest(request), (error: { code?: string }) => error.code === 'NO_STYLIST_AT_TIME');
  // Ivan does not offer this service (not a candidate) but is free at 15:00.
  await fixture({ funkyBusyAt: '15:00', ivan: true }).service.precheckBookingRequest(request);
});

test('staff paths in actions/admin.ts never apply the chair rule (confirming a request, approving a move)', () => {
  const source = readFileSync('src/app/actions/admin.ts', 'utf8');
  const calls = source.match(/assertAppointmentSlotAvailable\(/g) ?? [];
  const exempt = source.match(/assertAppointmentSlotAvailable\([^;]*\{ chairRule: false \}\)/g) ?? [];
  assert.equal(calls.length, 4);
  assert.equal(exempt.length, calls.length);
});
```

Add to `src/app/services/booking-days.test.ts`:

```ts
test('a time the chair rule refuses for a stylist is shown taken for that stylist only', () => {
  // Use the file's existing helpers for hours and dates; two stylists rostered the same day.
  const date = '2026-10-06';
  const hours = { dayOfWeek: 2, startTime: '10:00', endTime: '19:00' };
  const input = {
    dates: [date], duration: 60, now: new Date('2026-10-01T09:00:00Z'), busyByStylist: new Map(),
    bookable: () => true,
    chairAllows: (stylistId: string, start: Date) => !(stylistId === 'lox' && start.getTime() === resolveSalonDateTime(date, '15:00').utc.getTime()),
  };
  const [lox] = buildBookingDays({ ...input, hoursByStylist: new Map([['lox', [hours]]]) });
  assert.equal(lox.slots.find((slot) => slot.time === '15:00')?.available, false);
  const [anyone] = buildBookingDays({ ...input, hoursByStylist: new Map([['lox', [hours]], ['funky', [hours]]]) });
  assert.equal(anyone.slots.find((slot) => slot.time === '15:00')?.available, true);
});
```

(import `resolveSalonDateTime` from `./salon-time` if the file does not already.)

- [ ] **Step 3: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/diary-chair-rule.test.ts src/app/services/booking-diary-chair.test.ts src/app/services/booking-days.test.ts`
Expected: FAIL (module not found; slots still available).

- [ ] **Step 4: Implement the pure rule** `src/app/services/diary-chair-rule.ts`

```ts
// The chair rule (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §6).
// Pure: no database. A booking for stylist X over [s, e) is allowed only when the
// red (UNASSIGNED) diary events overlapping it can still be served by OTHER
// stylists: k = the most of them, clipped to [s, e), at any one instant; F = the
// active stylists other than X who work that day over the whole clipped span and
// have no appointment or busy block overlapping it. Allowed when k <= |F|.
// Deliberately conservative: a stylist free for only part of the span does not count.

import type { WorkingHours } from './booking-days';
import type { BookedInterval } from './scheduling';
import { resolveSalonDateTime, salonDateKey } from './salon-time';

export type ChairInterval = { start: Date; end: Date };
export type ChairContext = {
  /** UNASSIGNED diary entries overlapping the window read. */
  unassigned: readonly ChairInterval[];
  /** Every active stylist's working rows (isOff false), by stylist id. */
  hoursByStylist: ReadonlyMap<string, readonly WorkingHours[]>;
  /** Every active stylist's appointments and busy blocks, by stylist id. */
  busyByStylist: ReadonlyMap<string, readonly BookedInterval[]>;
};
export type ChairCheck = { allowed: true } | { allowed: false; needed: number; free: number; start: Date; end: Date };

/** The most intervals overlapping at any instant. Half-open: one ending as another starts is not an overlap. */
export function maxConcurrent(intervals: readonly ChairInterval[]): number {
  const points = intervals.flatMap((interval) => [[interval.start.getTime(), 1], [interval.end.getTime(), -1]] as const);
  // At the same instant an end (-1) sorts before a start (+1).
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let most = 0;
  for (const [, step] of points) {
    current += step;
    most = Math.max(most, current);
  }
  return most;
}

export function checkDiaryChair(ctx: ChairContext | null, stylistId: string, start: Date, durationMin: number): ChairCheck {
  if (!ctx || ctx.unassigned.length === 0) return { allowed: true };
  const startMs = start.getTime();
  const endMs = startMs + durationMin * 60_000;
  const clipped = ctx.unassigned
    .filter((interval) => interval.start.getTime() < endMs && startMs < interval.end.getTime())
    .map((interval) => ({ start: new Date(Math.max(interval.start.getTime(), startMs)), end: new Date(Math.min(interval.end.getTime(), endMs)) }));
  if (clipped.length === 0) return { allowed: true };
  const needed = maxConcurrent(clipped);
  const span = {
    start: new Date(Math.min(...clipped.map((interval) => interval.start.getTime()))),
    end: new Date(Math.max(...clipped.map((interval) => interval.end.getTime()))),
  };
  // The booking sits inside one salon day (it fits its stylist's hours), so the span does too.
  const dateStr = salonDateKey(start);
  const { dayOfWeek } = resolveSalonDateTime(dateStr, '12:00');
  let free = 0;
  for (const [otherId, rows] of ctx.hoursByStylist) {
    if (otherId === stylistId) continue;
    const hours = rows.find((row) => row.dayOfWeek === dayOfWeek);
    if (!hours) continue;
    const opens = resolveSalonDateTime(dateStr, hours.startTime).utc.getTime();
    const closes = resolveSalonDateTime(dateStr, hours.endTime).utc.getTime();
    if (opens > span.start.getTime() || closes < span.end.getTime()) continue;
    const busy = ctx.busyByStylist.get(otherId) ?? [];
    const taken = busy.some((interval) => {
      const busyStart = interval.start.getTime();
      return busyStart < span.end.getTime() && span.start.getTime() < busyStart + interval.durationMin * 60_000;
    });
    if (!taken) free += 1;
  }
  return needed <= free ? { allowed: true } : { allowed: false, needed, free, start: span.start, end: span.end };
}

export function diaryChairAllows(ctx: ChairContext | null, stylistId: string, start: Date, durationMin: number): boolean {
  return checkDiaryChair(ctx, stylistId, start, durationMin).allowed;
}
```

- [ ] **Step 5: Implement the loader** `src/app/services/diary-chair-load.ts`

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { WorkingHours } from './booking-days';
import type { ChairContext } from './diary-chair-rule';
import { loadExternalBusy, toBookedInterval } from './external-busy';
import type { BookedInterval } from './scheduling';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * What the chair rule needs over `window`, read with `db`: the caller's
 * Serializable transaction when it has one, so the rule and the write see one
 * snapshot (spec §6). One query when the window holds no red (UNASSIGNED)
 * diary entry, the usual case: null, the rule has nothing to say. Otherwise
 * every active stylist's working rows, appointments and busy blocks.
 * `excludeAppointmentId`: the booking being moved never counts as busy.
 */
export async function loadChairContext(
  db: Db, window: { start: Date; end: Date }, options: { excludeAppointmentId?: string } = {},
): Promise<ChairContext | null> {
  const unassigned = await db.googleDiaryEntry.findMany({
    where: { kind: 'UNASSIGNED', start: { lt: window.end }, end: { gt: window.start } },
    select: { start: true, end: true },
  });
  if (unassigned.length === 0) return null;
  const rows = await db.availability.findMany({
    where: { isOff: false, stylist: { isActive: true } },
    select: { stylistId: true, dayOfWeek: true, startTime: true, endTime: true },
  });
  const stylistIds = [...new Set(rows.map((row) => row.stylistId))];
  const [appointments, external] = stylistIds.length === 0
    ? [[], []]
    : await Promise.all([
      db.appointment.findMany({
        where: {
          stylistId: { in: stylistIds }, date: { gte: window.start, lte: window.end }, status: { not: 'CANCELLED' },
          ...(options.excludeAppointmentId ? { id: { not: options.excludeAppointmentId } } : {}),
        },
        select: { stylistId: true, date: true, durationAtBooking: true, service: { select: { duration: true } } },
      }),
      loadExternalBusy(db, stylistIds, window),
    ]);
  const hoursByStylist = new Map<string, WorkingHours[]>();
  for (const row of rows) {
    const list = hoursByStylist.get(row.stylistId);
    if (list) list.push(row);
    else hoursByStylist.set(row.stylistId, [row]);
  }
  const busyByStylist = new Map<string, BookedInterval[]>();
  const add = (id: string, interval: BookedInterval) => {
    const list = busyByStylist.get(id);
    if (list) list.push(interval);
    else busyByStylist.set(id, [interval]);
  };
  // Frozen booking duration wins over the live service duration (as getAvailableSlots).
  for (const appointment of appointments) add(appointment.stylistId, { start: appointment.date, durationMin: appointment.durationAtBooking ?? appointment.service.duration });
  for (const block of external) add(block.stylistId, toBookedInterval(block));
  return { unassigned, hoursByStylist, busyByStylist };
}
```

- [ ] **Step 6: Wire it in**

`src/app/services/booking-days.ts`: add to the `buildBookingDays` input type, after `requestable`:

```ts
  /**
   * The diary chair rule (diary-chair-rule.ts): whether `stylistId` may take
   * this start without leaving a red diary event unserved. A start it refuses
   * is shown taken for that stylist; "Anyone" stays open through another.
   */
  chairAllows?: (stylistId: string, start: Date, duration: number) => boolean;
```

and in the slot loop: `const open = slot.available && (input.chairAllows?.(stylistId, start, input.duration) ?? true) && (input.requestable?.(start) ?? true);`

`src/app/services/booking-service.ts` (imports: `import { loadChairContext } from './diary-chair-load';`, `import { diaryChairAllows } from './diary-chair-rule';`):

- `assertAppointmentSlotAvailable` gains `options: { chairRule?: boolean } = {}` as a fifth parameter and, after the existing `if (hasConflict(...)) throw new SlotUnavailableError();`:
  ```ts
  // The diary chair rule (spec §6): customer paths only. Staff confirming a
  // request or approving a move pass { chairRule: false }; admin create/move
  // warn instead (admin-move-clashes.ts).
  if (options.chairRule !== false) {
    const chair = await loadChairContext(tx, salonDayWindow(date), { excludeAppointmentId: appointment.id || undefined });
    if (!diaryChairAllows(chair, appointment.stylistId, date, duration)) throw new SlotUnavailableError();
  }
  ```
- `getAvailableSlots`: add `loadChairContext(prisma, window)` as a third member of its `Promise.all` (`const [existingAppointments, externalBlocks, chair] = …`) and end with:
  ```ts
  return buildStylistSlots(availability, busy, dateStr, serviceDuration, now)
    .filter((slot) => {
      const start = resolveSalonDateTime(dateStr, slot.time).utc;
      return isRequestableOnline(start, serviceDuration, now) && diaryChairAllows(chair, stylistId, start, serviceDuration);
    });
  ```
- `getAvailableSlotsUnion`: `const [appointments, externalBlocks, chair] = await Promise.all([…, loadChairContext(prisma, window)]);` and in the loop:
  ```ts
  for (const slot of slots) {
    const start = resolveSalonDateTime(dateStr, slot.time).utc;
    if (slot.available && diaryChairAllows(chair, availability.stylistId, start, serviceDuration) && isRequestableOnline(start, serviceDuration, now)) times.add(slot.time);
  }
  ```
- `getBookingDays`: `const [appointments, externalBlocks, chair] = stylistIds.length === 0 ? [[], [], null] : await Promise.all([…, loadChairContext(prisma, window)]);` and pass `chairAllows: (id, start, duration) => diaryChairAllows(chair, id, start, duration),` to `buildBookingDays`. Update the doc comment ("Three batched reads…" → "Four batched reads, plus three when the range holds a red diary entry (the chair rule)…").
- `chooseFreeStylist`: after the external blocks are merged:
  ```ts
  // The diary chair rule, in this transaction: only candidates that leave every red
  // diary event a free stylist. "Anyone" then takes the first of them that is free.
  const chair = await loadChairContext(db, { start: dayStart, end: dayEnd });
  const allowed = candidateStylistIds.filter((id) => diaryChairAllows(chair, id, date, durationMinutes));
  const stylistId = firstFreeStylist(allowed, date, durationMinutes, bookedByStylist);
  ```
- The two callers of `chooseFreeStylist` (`createBookingForFirstAvailable` line 568, `precheckBookingRequest` line 612) pass `{ chairRule: false }` as the fifth argument to their following `assertAppointmentSlotAvailable(…, blocking, { chairRule: false })`, with the comment `// chooseFreeStylist applied the chair rule in this transaction.`
- `createBooking` (line 464), `precheckBookingRequest` single-stylist branch (line 617) and `actions/booking.ts:899` (`requestReschedule`, a customer path) keep the default (rule on).

`src/app/actions/admin.ts` — the four staff calls become `assertAppointmentSlotAvailable(tx, current, current.date, undefined, { chairRule: false })` (lines 578, 687, 720) and `assertAppointmentSlotAvailable(tx, current, requested, undefined, { chairRule: false })` (line 847), each with the comment `// Staff decide; the diary chair rule only refuses customers (spec §6).`

Add the `googleDiaryEntry: { findMany: async () => [] }` stub to every fake listed under Files.

- [ ] **Step 7: Run the tests**

Run: `node --conditions=react-server --import tsx --test src/app/services/diary-chair-rule.test.ts src/app/services/booking-diary-chair.test.ts src/app/services/booking-days.test.ts src/app/services/booking-days-loader.test.ts src/app/services/booking-synced-clash.test.ts`, then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec eslint` on the changed files.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -u   # the modified tracked files: booking-days, booking-service, admin.ts and the test fakes
git add src/app/services/diary-chair-rule.ts src/app/services/diary-chair-rule.test.ts src/app/services/diary-chair-load.ts \
  src/app/services/booking-diary-chair.test.ts
git status --short   # only this task's files: no stray logs, nothing untracked left behind
git commit -F - <<'EOF'
feat(gdiary): the chair rule keeps a stylist free for each walk-in in online booking

A red (UNASSIGNED) diary event takes one chair: the slot grids, booking days,
online requests, "Anyone" assignment and customer reschedule requests refuse a
time that would leave such an event without a free stylist who works the
whole of it. Read in the booking's own Serializable transaction. Staff
confirming a request or approving a move are never refused by it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 5: Admin create and move warn about the chair

**Files:**
- Modify: `src/app/services/admin-move-clashes.ts:25-29` (new clash kind), `:53-125` (check)
- Modify: `src/app/services/admin-move-clashes.test.ts` (fake gains `googleDiaryEntry`, `availability.findMany`, string and `in` matching; two tests)
- Modify: `src/app/lib/describe-clash.ts:15-36`
- Create: `src/app/lib/describe-clash.test.ts`
- Modify: `src/i18n/messages/en/adminSchedule.ts` and `zh/adminSchedule.ts` (`clash.diaryChair`)
- Modify (fake stubs): `src/app/actions/admin-schedule.test.ts`, `admin-booking-entry.test.ts`, `admin-consultation-credit.test.ts` and any other fake reaching `describeAdminMoveClashes` (add `googleDiaryEntry: { findMany: async () => [] }`)

**Interfaces:**
- Consumes (Task 4): `loadChairContext`, `checkDiaryChair`.
- Produces: `MoveClash` gains `| { kind: 'DIARY_CHAIR'; needed: number; free: number; start: Date; end: Date }`; `describeClash` handles it. `AppointmentDialog`, `ScheduleDayGrid` and `ScheduleWeekGrid` already render every clash through `describeClash`, so the existing "Book anyway" / "Move anyway" flow carries it unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/app/services/admin-move-clashes.test.ts`: extend `matches` (before the final `return true`):

```ts
    if (expected && typeof expected === 'object' && 'in' in (expected as Row)) {
      return ((expected as Row).in as unknown[]).includes(actual);
    }
    if (typeof expected === 'string') return actual === expected;
```

extend `fakeDb` options with `roster?: Row[]; diary?: { start: Date; end: Date }[]` and the db with:

```ts
      availability: {
        findFirst: /* unchanged */,
        findMany: async () => options.roster ?? [],
      },
      googleDiaryEntry: { findMany: async () => options.diary ?? [] },
```

then add:

```ts
const AT_11_00 = new Date(AT_10_00.getTime() + 60 * 60_000);
const ROSTER = [
  { stylistId: 'stylist-1', dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
  { stylistId: 'stylist-2', dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
];

test('a Google walk-in left with no free stylist is a DIARY_CHAIR warning, never a refusal', async () => {
  const { db } = fakeDb({
    roster: ROSTER,
    appointments: [{ id: 'busy-2', stylistId: 'stylist-2', date: AT_10_00, durationAtBooking: 60, status: 'CONFIRMED', user: { name: 'Mei L.' }, service: { duration: 60 } }],
    diary: [{ start: AT_10_00, end: AT_11_00 }],
  });
  const clashes = await describeAdminMoveClashes(db as never, baseInput);
  assert.deepEqual(kinds(clashes), ['DIARY_CHAIR']);
  const [chair] = clashes;
  assert.ok(chair.kind === 'DIARY_CHAIR');
  assert.deepEqual([chair.needed, chair.free, chair.start.toISOString(), chair.end.toISOString()], [1, 0, AT_10_00.toISOString(), AT_11_00.toISOString()]);
});

test('moving stylist-2’s own booking to stylist-1 frees stylist-2 for the walk-in: no warning', async () => {
  const { db } = fakeDb({
    roster: ROSTER,
    appointments: [{ id: 'busy-2', stylistId: 'stylist-2', date: AT_10_00, durationAtBooking: 60, status: 'CONFIRMED', user: { name: 'Mei L.' }, service: { duration: 60 } }],
    diary: [{ start: AT_10_00, end: AT_11_00 }],
  });
  assert.deepEqual(await describeAdminMoveClashes(db as never, { ...baseInput, appointmentId: 'busy-2' }), []);
});
```

`src/app/lib/describe-clash.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { translator } from '../../i18n/messages';
import { describeClash } from './describe-clash';

const start = new Date('2026-10-23T14:00:00Z'); // 15:00 in London (BST)
const end = new Date('2026-10-23T15:00:00Z');

test('the chair warning names the Google diary, the numbers and the London time, in both languages', () => {
  const clash = { kind: 'DIARY_CHAIR' as const, needed: 2, free: 1, start, end };
  assert.equal(describeClash(clash, translator('en-GB', 'adminSchedule')),
    'Leaves too few stylists for the Google diary’s bookings without a stylist at 15:00–16:00 (2 needed, 1 free)');
  assert.equal(describeClash(clash, translator('zh-HK', 'adminSchedule')),
    '15:00–16:00 Google 日曆中未指定髮型師的預約將沒有足夠空閒髮型師（需要 2 位，空閒 1 位）');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/admin-move-clashes.test.ts src/app/lib/describe-clash.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`admin-move-clashes.ts`: add the union member above; import `loadChairContext` and `checkDiaryChair`; before the patch-test block:

```ts
  // The diary chair rule (spec §6), as a warning: staff may book anyway.
  const chair = checkDiaryChair(
    await loadChairContext(db, window, { excludeAppointmentId: target.appointmentId || undefined }),
    target.stylistId, target.start, target.durationMin,
  );
  if (!chair.allowed) clashes.push({ kind: 'DIARY_CHAIR', needed: chair.needed, free: chair.free, start: chair.start, end: chair.end });
```

`describe-clash.ts`, new case:

```ts
    case 'DIARY_CHAIR':
      return t('clash.diaryChair', {
        range: `${formatSalonClock(t.locale, new Date(clash.start))}–${formatSalonClock(t.locale, new Date(clash.end))}`,
        needed: clash.needed,
        free: clash.free,
      });
```

Messages (`clash` block):
- en: `diaryChair: 'Leaves too few stylists for the Google diary’s bookings without a stylist at {range} ({needed} needed, {free} free)',`
- zh: `diaryChair: '{range} Google 日曆中未指定髮型師的預約將沒有足夠空閒髮型師（需要 {needed} 位，空閒 {free} 位）',`

Add the `googleDiaryEntry` stub to the admin action tests' fakes.

- [ ] **Step 4: Run the tests**

Run the Step 2 command, then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec eslint` on the changed files.
Expected: PASS (if `formatSalonClock` renders differently from `15:00`, assert against `formatSalonClock` output rather than changing the message).

- [ ] **Step 5: Commit**

```bash
git add -u   # admin-move-clashes, describe-clash, the messages and the admin action test fakes
git add src/app/lib/describe-clash.test.ts
git status --short
git commit -F - <<'EOF'
feat(gdiary): admin bookings warn when a walk-in would be left without a stylist

Admin create and move report a DIARY_CHAIR clash (needed and free stylists,
the walk-in's time) through the existing clash list, so "Book anyway" and
"Move anyway" still decide. A booking being moved frees its own stylist.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 6: Website events in the stylist's Google colour; calendar change guard

**Files:**
- Modify: `src/app/services/google-calendar-event.ts:17, 121-125` (replace `stylistColorId` with `googleColorFor`) and `google-calendar-event.test.ts:121-128`
- Modify: `src/app/services/google-calendar-push.ts:67-78, 135-161, 204-215`
- Modify: `src/app/services/google-calendar-push.test.ts` (fixtures, colour tests, guard stub)
- Create: `src/app/services/google-calendar-guard.ts`, `src/app/services/google-calendar-guard.test.ts`
- Modify: `src/app/services/google-calendar-pull.ts` (guard call; `config` kept) and `google-calendar-pull.test.ts` (`rendered()` context, `Appt.stylist`, guard stub)

**Interfaces:**
- Consumes: `isGoogleColorId`, `DEFAULT_UNASSIGNED_COLOR_ID` (Task 2); `GoogleCalendarSyncState.calendarId` (Task 1).
- Produces:
  ```ts
  // google-calendar-event.ts
  export function googleColorFor(stylist: { googleColorId: string | null }, unassignedColorId: string): string;
  // google-calendar-push.ts
  export type RenderContext = { locale: Locale; unassignedColorId: string; serviceFields: Map<string, ContentFields> };
  //   appointmentSelect.stylist selects { id, name, googleColorId }
  // google-calendar-guard.ts
  export async function guardGoogleCalendarChange(db: GuardDb, calendarId: string): Promise<'same' | 'switched'>;
  ```

- [ ] **Step 1: Write the failing tests**

`google-calendar-event.test.ts`: replace the `stylistColorId` test (and its import) with:

```ts
test('a website event takes its stylist’s Google colour, else the no-stylist colour (spec §8)', () => {
  assert.equal(googleColorFor({ googleColorId: '1' }, '11'), '1');
  assert.equal(googleColorFor({ googleColorId: null }, '11'), '11');
  assert.equal(googleColorFor({ googleColorId: '12' }, '11'), '11', 'not a Google colour id');
  assert.equal(googleColorFor({ googleColorId: '' }, '4'), '4');
});
```

`src/app/services/google-calendar-guard.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

const { guardGoogleCalendarChange } = loadServerModule<typeof import('./google-calendar-guard')>('src/app/services/google-calendar-guard.ts', {});
const PRIMARY = 'harbourhairuk@gmail.com';

type State = { calendarId: string | null; channelId: string | null; resourceId: string | null; channelExpiresAt: Date | null; busyHash: string | null };
function fakeDb(state: State | null, rows = 3) {
  const log: string[] = [];
  const store = { state: state ? { ...state } : null, rows };
  const client = {
    googleCalendarSyncState: {
      findUnique: async () => { log.push('read'); return store.state ? { calendarId: store.state.calendarId } : null; },
      updateMany: async ({ where, data }: { where: { OR: ({ calendarId: null } | { calendarId: { not: string } })[] }; data: Partial<State> }) => {
        const current = store.state?.calendarId ?? null;
        const differs = where.OR.some((branch) => branch.calendarId === null ? current === null : current !== null && current !== (branch.calendarId as { not: string }).not);
        if (!store.state || !differs) return { count: 0 };
        Object.assign(store.state, data);
        log.push('reset');
        return { count: 1 };
      },
      upsert: async ({ create }: { create: Partial<State> }) => { store.state = { channelId: null, resourceId: null, channelExpiresAt: null, busyHash: null, calendarId: null, ...create }; log.push('create'); },
    },
    googleCalendarEvent: { deleteMany: async () => { log.push('delete-rows'); const count = store.rows; store.rows = 0; return { count }; } },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => { log.push('tx'); return fn(client); },
  };
  return { client, log, store };
}
const channel = { channelId: 'ch', resourceId: 'res', channelExpiresAt: new Date('2026-10-20T00:00:00Z'), busyHash: 'h' };

test('the same calendar: one read, nothing else', async () => {
  const f = fakeDb({ calendarId: PRIMARY, ...channel });
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'same');
  assert.deepEqual(f.log, ['read']);
  assert.equal(f.store.rows, 3);
});

test('another calendar configured: the event rows and the channel are cleared, the new id recorded', async () => {
  const f = fakeDb({ calendarId: 'old@group.calendar.google.com', ...channel });
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'switched');
  assert.deepEqual(f.log, ['read', 'tx', 'reset', 'delete-rows']);
  assert.deepEqual(f.store.state, { calendarId: PRIMARY, channelId: null, resourceId: null, channelExpiresAt: null, busyHash: 'h' });
  assert.equal(f.store.rows, 0);
});

test('no calendar recorded yet (the first run after this shipped) counts as a change', async () => {
  const f = fakeDb({ calendarId: null, ...channel });
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'switched');
  assert.equal(f.store.rows, 0);
});

test('no state row at all: it is created with the id; rows are cleared', async () => {
  const f = fakeDb(null);
  assert.equal(await guardGoogleCalendarChange(f.client as never, PRIMARY), 'switched');
  assert.equal(f.store.state?.calendarId, PRIMARY);
  assert.equal(f.store.rows, 0);
});

test('a racing caller already switched: the second clears nothing', async () => {
  const f = fakeDb({ calendarId: 'old@group.calendar.google.com', ...channel });
  // Both read "old" before either wrote.
  const first = guardGoogleCalendarChange(f.client as never, PRIMARY);
  const second = guardGoogleCalendarChange(f.client as never, PRIMARY);
  assert.deepEqual((await Promise.all([first, second])).sort(), ['same', 'switched']);
  assert.equal(f.log.filter((entry) => entry === 'delete-rows').length, 1);
});
```

`google-calendar-push.test.ts`:
- `Appt.stylist` type becomes `{ id: string; name: string; googleColorId: string | null }`; default fixture `stylist: { id: 's1', name: 'Ivan', googleColorId: '1' }`, the Lox fixture at line 248 `{ id: 's2', name: 'Lox', googleColorId: null }`.
- `settings` in `fakeDb` gains `googleUnassignedColorId: '11'`; delete the `stylist.findMany` fake (no longer read).
- `load()` gains a guard stub and returns the calls:
  ```ts
  const guardCalls: string[] = [];
  // in the dependencies:
  './google-calendar-guard': { guardGoogleCalendarChange: async (_db: unknown, calendarId: string) => { guardCalls.push(calendarId); return 'same'; } },
  ```
- Line 209: `assert.equal(event.colorId, '1', 'Ivan’s Google colour');`; line 258: `assert.equal(second.colorId, '11', 'Lox has no Google colour: the no-stylist colour');`.
- New test (hoist `guardCalls` to module scope so `load()`, `run()` and the test share it; every other test leaves entries in it, so the test empties it first):
  ```ts
  test('the push runs the calendar change guard before choosing bookings; switched off, it never does', async () => {
    guardCalls.length = 0;
    const { db } = fakeDb([appt('a1')]);
    const google = fakeGateway();
    await run(db, google.gateway);
    assert.deepEqual(guardCalls, [CONFIG.calendarId]);
    guardCalls.length = 0;
    await load(null).pushGoogleCalendar({ db: untouchable as never, gateway: google.gateway as never, now: NOW });
    assert.deepEqual(guardCalls, []);
  });
  ```

`google-calendar-pull.test.ts`:
- `Appt.stylist` gains `googleColorId: string | null` (default `{ id: 's1', name: 'Ivan', googleColorId: '1' }`).
- `rendered()` context: `{ locale: 'en-GB', unassignedColorId: '11', serviceFields: new Map() }`.
- `load()` stubs `'./google-calendar-guard'` the same way, recording calls in a module-scope `guardCalls`, and a new test:
  ```ts
  test('the pull runs the calendar change guard first; switched off, it never does', async () => {
    guardCalls.length = 0;
    const store = fakeDb([], { state: { busyHash: EMPTY_HASH } });
    const google = fakeGoogle([]);
    await run(load().pull, store.db, google.gateway);
    assert.deepEqual(guardCalls, [CONFIG.calendarId]);
    guardCalls.length = 0;
    await run(load(null).pull, untouchable, google.gateway);
    assert.deepEqual(guardCalls, []);
  });
  ```
- New test: `a website event recoloured in Google is put back in its stylist’s colour` — listing `{ ...rendered(booking).event, colorId: '11' }` for a booking whose row holds `rendered(booking).hash` synced 1 day ago; expect one `put` whose `event.colorId === '1'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/services/google-calendar-event.test.ts src/app/services/google-calendar-guard.test.ts src/app/services/google-calendar-push.test.ts src/app/services/google-calendar-pull.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`google-calendar-event.ts`: delete `COLOR_COUNT` and `stylistColorId`; add (import `isGoogleColorId` from `@/app/lib/calendar-colors`):

```ts
/**
 * A website event's colour (diary mirror spec §8): its stylist's Google colour,
 * so it reads like the salon's own entries; else the no-stylist colour. An
 * "Anyone" request already has a stylist, so it takes theirs.
 */
export function googleColorFor(stylist: { googleColorId: string | null }, unassignedColorId: string): string {
  return isGoogleColorId(stylist.googleColorId) ? stylist.googleColorId : unassignedColorId;
}
```

`google-calendar-push.ts`:
- `appointmentSelect.stylist`: `{ select: { id: true, name: true, googleColorId: true } }`.
- `RenderContext` as in Interfaces.
- `loadRenderContext`: select `{ salonNotificationLocale: true, googleUnassignedColorId: true }`; drop the stylist query; return `{ locale, unassignedColorId: isGoogleColorId(settings?.googleUnassignedColorId) ? settings.googleUnassignedColorId : DEFAULT_UNASSIGNED_COLOR_ID, serviceFields }`.
- `renderAppointment`: `colorId: googleColorFor(appointment.stylist, context.unassignedColorId)`.
- `pushGoogleCalendar`: `const config = googleCalendarConfig(); if (!config) return { ...result, skipped: 'disabled' };`, and right after `const db = …`: `await guardGoogleCalendarChange(db, config.calendarId);`.
- Header comment: replace "colours by sorted stylist id" wording if present; mention the guard.

`src/app/services/google-calendar-guard.ts`:

```ts
import 'server-only';

// Calendar change guard (docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md §8).

import type { PrismaClient } from '@prisma/client';

const STATE_ID = 'singleton';
type GuardDb = Pick<PrismaClient, 'googleCalendarSyncState' | 'googleCalendarEvent' | '$transaction'>;

/**
 * The GoogleCalendarEvent rows describe events in ONE calendar: the one
 * recorded in GoogleCalendarSyncState.calendarId. When the configured calendar
 * differs, or none was recorded yet (the first run after this shipped), the
 * rows prove nothing about the configured calendar, so they are deleted with
 * the watch channel: the next push writes every booking in the window there,
 * and the next daily run (or Sync now) watches it. Events in the old calendar
 * are never deleted (the owner removes that calendar by hand). Conditional,
 * so of two racing callers only one clears.
 */
export async function guardGoogleCalendarChange(db: GuardDb, calendarId: string): Promise<'same' | 'switched'> {
  const state = await db.googleCalendarSyncState.findUnique({ where: { id: STATE_ID }, select: { calendarId: true } });
  if (state?.calendarId === calendarId) return 'same';
  const reset = { calendarId, channelId: null, resourceId: null, channelExpiresAt: null };
  const outcome = await db.$transaction(async (tx) => {
    if (state) {
      const { count } = await tx.googleCalendarSyncState.updateMany({
        where: { id: STATE_ID, OR: [{ calendarId: null }, { calendarId: { not: calendarId } }] },
        data: reset,
      });
      if (count === 0) return 'same' as const;
    } else {
      await tx.googleCalendarSyncState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, ...reset }, update: reset });
    }
    await tx.googleCalendarEvent.deleteMany({});
    return 'switched' as const;
  });
  if (outcome === 'switched') console.info('Google Calendar: the configured calendar changed; every booking is written there afresh.');
  return outcome;
}
```

`google-calendar-pull.ts`: `const config = googleCalendarConfig(); if (!config) return { …disabled… };` and, first thing inside the `try`, `await guardGoogleCalendarChange(db, config.calendarId);`.

- [ ] **Step 4: Run the tests**

Run the Step 2 command, then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec eslint` on the changed files.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/google-calendar-event.ts src/app/services/google-calendar-event.test.ts src/app/services/google-calendar-push.ts \
  src/app/services/google-calendar-push.test.ts src/app/services/google-calendar-guard.ts src/app/services/google-calendar-guard.test.ts \
  src/app/services/google-calendar-pull.ts src/app/services/google-calendar-pull.test.ts
git commit -F - <<'EOF'
feat(gdiary): website events in the stylist's Google colour; calendar change guard

A website event takes its stylist's Google colour, else the no-stylist
colour (replaces colours by sorted id); a recoloured one is put back. When
GOOGLE_CALENDAR_ID differs from the calendar the rows were written to (or
none was recorded), the next push or pull clears the rows and the channel
once and writes every booking to the configured calendar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 7: Admin configuration — Google colour and names per stylist; diary colours in Integrations

**Files:**
- Create: `src/components/admin/GoogleColorPicker.tsx`, `src/components/admin/GoogleColorPicker.test.ts`
- Modify: `src/components/admin/StylistForm.tsx:23-32, 44, 146-153` (new props and a "Google diary" section)
- Create: `src/components/admin/StylistFormGoogle.test.ts`
- Modify: `src/app/[locale]/admin/stylists/[id]/edit/page.tsx:27-30, 55-69` (select and pass the two fields)
- Modify: `src/app/actions/admin-stylists.ts:23-58, 93-185` (fields, normalisation, uniqueness)
- Create: `src/app/actions/admin-stylists-google.test.ts`
- Modify: `src/app/actions/admin-google-calendar.ts` (new `saveGoogleDiaryColours`) and `admin-google-calendar.test.ts`
- Modify: `src/components/admin/GoogleCalendarStatus.tsx` (a "Diary colours" form), `src/app/[locale]/admin/integrations/page.tsx:18, 26, 64-65, 81`, `src/test/pages/admin-integrations-google-page.test.ts`
- Modify messages: `src/i18n/messages/{en,zh}/adminContent.ts` (`stylists.form.*`, `stylists.errors.*`), `src/i18n/messages/{en,zh}/adminOps.ts` (`integrations.google.colours.*`, `integrations.google.status.colours*`), `src/i18n/messages/{en,zh}/adminSchedule.ts` (`googleColors.*`)

**Interfaces:**
- Consumes: `GOOGLE_EVENT_COLORS`, `GOOGLE_COLOR_IDS`, `isGoogleColorId`, `DEFAULT_*` (Task 2), `parseGoogleAliases` (Task 2), `loadDiaryConfig` (Task 3).
- Produces:
  ```ts
  // src/components/admin/GoogleColorPicker.tsx ('use client')
  export function GoogleColorPicker(props: { name: string; label: string; help?: string; initial?: string | null; allowNone: boolean }): JSX.Element;
  // src/app/actions/admin-google-calendar.ts
  export async function saveGoogleDiaryColours(formData: FormData): Promise<void>;   // redirects ?gcal=coloursSaved|coloursSame|coloursTaken|coloursInvalid
  // StylistForm props gain googleColorId?: string | null; googleAliases?: string | null
  // GoogleCalendarStatus props: { status: GoogleCalendarStatus; colours: DiaryConfig }
  // messages: adminSchedule.googleColors.{none,lavender,…,tomato}
  ```

- [ ] **Step 1: Write the failing tests**

`src/components/admin/GoogleColorPicker.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function picker(locale: Locale = 'en-GB') {
  return loadServerModule<typeof import('./GoogleColorPicker')>('src/components/admin/GoogleColorPicker.tsx', {
    react: { useState: (value: unknown) => [value, () => undefined] },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
  });
}

test('eleven Google colours by their Google names, plus "none" when allowed; the hidden input posts the id', () => {
  const nodes = elements(picker().GoogleColorPicker({ name: 'googleColorId', label: 'Google colour', initial: '5', allowNone: true }));
  assert.deepEqual(nodes.filter((node) => node.type === 'button').map((node) => node.props.title),
    ['No Google colour', 'Lavender', 'Sage', 'Grape', 'Flamingo', 'Banana', 'Tangerine', 'Peacock', 'Graphite', 'Blueberry', 'Basil', 'Tomato']);
  assert.equal(nodes.find((node) => node.type === 'input')!.props.value, '5');
  const banana = nodes.find((node) => node.props.title === 'Banana')!;
  assert.equal(banana.props['aria-pressed'], true);
  assert.match(String(banana.props.className), /bg-\[#f6bf26\]/);
  const strict = elements(picker().GoogleColorPicker({ name: 'x', label: 'x', initial: '11', allowNone: false }));
  assert.equal(strict.filter((node) => node.type === 'button').length, 11);
});

test('Chinese colour names', () => {
  const nodes = elements(picker('zh-HK').GoogleColorPicker({ name: 'x', label: 'x', initial: null, allowNone: true }));
  const titles = nodes.filter((node) => node.type === 'button').map((node) => node.props.title);
  assert.deepEqual([titles[0], titles[1], titles[11]], ['沒有 Google 顏色', '薰衣草紫', '番茄紅']);
});
```

`src/components/admin/StylistFormGoogle.test.ts` (load `StylistForm.tsx` with `react: { useActionState: () => [{ status: 'idle' }, () => undefined, false], useEffect: () => undefined }`, `'@/i18n/client'`, `'@/i18n/link'`, `'@/i18n/draft-store': { clearDraft: () => undefined, usePreservedForm: () => ({ current: null }) }`, `'./BilingualContentEditor': { BilingualContentEditor: () => null }`, `'./CalendarColorPicker': { CalendarColorPicker: () => null }`, `'./GoogleColorPicker': { GoogleColorPicker: () => null }`, `'@/i18n/rich': { rich: (text: string) => text }`, with the same `elements`/`text` helpers as `SiteSettingsForm.test.ts`):

```ts
test('the stylist form offers a Google colour (none allowed) and Google names, in English and Chinese', () => {
  for (const [locale, words] of [
    ['en-GB', { colour: 'Google colour', names: 'Google names' }],
    ['zh-HK', { colour: 'Google 顏色', names: 'Google 名稱' }],
  ] as const) {
    const nodes = elements(loadForm(locale).StylistForm({
      mode: 'edit', action: async () => ({ status: 'idle' }), saved: false,
      stylist: { id: 'lox', name: 'Lox', slug: 'lox', imageUrl: null, yearsExperience: null },
      googleColorId: '5', googleAliases: 'L',
    }));
    const picker = nodes.find((node) => node.props.name === 'googleColorId')!;
    assert.deepEqual([picker.props.label, picker.props.initial, picker.props.allowNone], [words.colour, '5', true], locale);
    const names = nodes.find((node) => node.props.name === 'googleAliases')!;
    assert.deepEqual([names.props.defaultValue, names.props.maxLength], ['L', 200], locale);
    assert.ok(nodes.some((node) => text(node) === words.names), locale);
  }
});
```

`src/app/actions/admin-stylists-google.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

type Holder = { id: string; name: string; isActive: boolean; googleColorId: string | null };
function load(holders: Holder[] = [], settings: { googleUnassignedColorId: string; googleLeaveColorId: string } | null = { googleUnassignedColorId: '11', googleLeaveColorId: '8' }) {
  const updates: Record<string, unknown>[] = [];
  const actions = loadServerModule<typeof import('./admin-stylists')>('src/app/actions/admin-stylists.ts', {
    '@/app/lib/prisma': {
      stylist: {
        findUnique: async () => ({ id: 'lox', slug: 'lox' }),
        findFirst: async ({ where }: { where: { isActive: boolean; googleColorId: string; id?: { not: string } } }) => {
          const holder = holders.find((s) => s.isActive === where.isActive && s.googleColorId === where.googleColorId && s.id !== where.id?.not);
          return holder ? { name: holder.name } : null;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { id: 'lox' }; },
      },
      siteSettings: { findUnique: async () => settings },
    },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN' }) },
    '@/app/stylists/slug': { slugify: () => 'lox' },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator('en-GB', namespace), localizedPath: async (path: string) => path },
    'next/cache': { revalidatePath: () => undefined },
    'next/navigation': {},
  });
  const save = (fields: Record<string, string>) => {
    const form = new FormData();
    form.set('id', 'lox'); form.set('name', 'Lox');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return actions.updateStylist({ status: 'idle' }, form);
  };
  return { save, updates };
}

test('a Google colour and names are saved, the names normalised', async () => {
  const f = load();
  assert.deepEqual(await f.save({ googleColorId: '5', googleAliases: ' L , l, Lox ' }), { status: 'success' });
  assert.deepEqual([f.updates[0].googleColorId, f.updates[0].googleAliases], ['5', 'L, Lox']);
});

test('no colour and no names save as null', async () => {
  const f = load();
  await f.save({ googleColorId: '', googleAliases: '  ' });
  assert.deepEqual([f.updates[0].googleColorId, f.updates[0].googleAliases], [null, null]);
});

test('another active stylist’s colour is refused, naming them; a retired holder or the stylist’s own colour is fine', async () => {
  const taken = await load([{ id: 'ivan', name: 'Ivan', isActive: true, googleColorId: '1' }]).save({ googleColorId: '1' });
  assert.equal(taken.status, 'error');
  assert.match((taken as { message: string }).message, /Ivan already uses this Google colour/);
  assert.equal((await load([{ id: 'ivan', name: 'Ivan', isActive: false, googleColorId: '1' }]).save({ googleColorId: '1' })).status, 'success');
  assert.equal((await load([{ id: 'lox', name: 'Lox', isActive: true, googleColorId: '5' }]).save({ googleColorId: '5' })).status, 'success');
});

test('the no-stylist and leave colours are reserved; an unknown id is refused; nothing is written', async () => {
  for (const [colour, words] of [['11', /set aside/], ['8', /set aside/], ['12', /Unknown Google colour/]] as const) {
    const f = load();
    const result = await f.save({ googleColorId: colour });
    assert.equal(result.status, 'error', colour);
    assert.match((result as { message: string }).message, words, colour);
    assert.equal(f.updates.length, 0, colour);
  }
});
```

`src/app/actions/admin-google-calendar.test.ts` — a second harness `loadColours({ role?, holder? })` built like `load()` with `'@/app/lib/prisma': { default: { stylist: { findFirst: async () => holder ?? null }, $transaction: async (fn) => fn(tx) } }` where `tx.siteSettings.upsert` records its `update`, and `'@/app/lib/audit'` records audits. Tests:
- non-admin → rejects `/Unauthorized/`, nothing recorded;
- `{ googleUnassignedColorId: '12', googleLeaveColorId: '8' }` → redirect `/zh-hk/admin/integrations?gcal=coloursInvalid`, no write;
- `'8'` and `'8'` → `?gcal=coloursSame`;
- holder `{ name: 'Ivan' }` → `?gcal=coloursTaken`;
- `'4'` and `'8'` → upsert `update` equals `{ googleUnassignedColorId: '4', googleLeaveColorId: '8' }`, one audit `INTEGRATION.GOOGLE_DIARY_COLOURS` with metadata `{ unassigned: '4', leave: '8' }`, redirect `?gcal=coloursSaved`.

`src/test/pages/admin-integrations-google-page.test.ts` — add the stub `'@/app/services/google-diary-config': { loadDiaryConfig: async () => ({ stylists: [], unassignedColorId: '11', leaveColorId: '8' }) }` and extend `expected` with: en `coloursSaved: 'Diary colours saved.'`, `coloursSame: 'must be different'`, `coloursTaken: 'already uses that colour'`, `coloursInvalid: 'Unknown colour'`; zh `coloursSaved: '已儲存記事簿顏色'`, `coloursSame: '必須不同'`, `coloursTaken: '已使用該顏色'`, `coloursInvalid: '未知的顏色'`; the role check becomes `['error', 'clearError', 'coloursSame', 'coloursTaken', 'coloursInvalid'].includes(code) ? 'alert' : 'status'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/components/admin/GoogleColorPicker.test.ts src/components/admin/StylistFormGoogle.test.ts src/app/actions/admin-stylists-google.test.ts src/app/actions/admin-google-calendar.test.ts src/test/pages/admin-integrations-google-page.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`GoogleColorPicker.tsx` — same structure as `CalendarColorPicker.tsx` (fieldset, legend, hidden input posting the id or `''`, a `✕` "none" button only when `allowNone`, then one button per `GOOGLE_COLOR_IDS` with `title`/`sr-only` name `t.dynamic(\`googleColors.${swatch.key}\`, undefined, swatch.label)`, `aria-pressed`, `className` with `swatch.swatch` written from the palette object — never interpolated class names). Initial state: `initial ?? (allowNone ? '' : DEFAULT_UNASSIGNED_COLOR_ID)`. Doc comment: posts a Google colour id; admin-only; the server refuses a colour another active stylist holds.

`StylistForm.tsx` — props `googleColorId?: string | null; googleAliases?: string | null`; a new section after "Schedule board":

```tsx
      <section className="bg-white rounded-lg border border-zinc-200 p-6 space-y-4">
        <h2 className="text-sm uppercase tracking-wider font-bold text-zinc-700">{t('stylists.form.googleDiary')}</h2>
        <GoogleColorPicker name="googleColorId" label={t('stylists.form.googleColour')} initial={googleColorId ?? null} help={t('stylists.form.googleColourHelp')} allowNone />
        <div>
          <label htmlFor="stylist-google-names" className={labelClass}>{t('stylists.form.googleNames')}</label>
          <input id="stylist-google-names" type="text" name="googleAliases" maxLength={200} defaultValue={googleAliases ?? ''} className={fieldClass} />
          <p className="text-xs text-zinc-500 mt-1">{t('stylists.form.googleNamesHelp')}</p>
        </div>
      </section>
```

Edit page: select `{ treatwellExternalId: true, calendarColor: true, googleColorId: true, googleAliases: true }` and pass `googleColorId={integration?.googleColorId ?? null}` `googleAliases={integration?.googleAliases ?? null}`.

`admin-stylists.ts` — schema fields:

```ts
const googleColorField = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || isGoogleColorId(v), 'GOOGLE_COLOUR')
  .transform((v) => (v ? v : null));
const googleAliasesField = z
  .string()
  .max(200, 'GOOGLE_NAMES')
  .optional()
  .transform((v) => {
    const aliases = parseGoogleAliases(v);
    return aliases.length > 0 ? aliases.join(', ') : null;
  });
// in stylistSchema: googleColorId: googleColorField, googleAliases: googleAliasesField,
```

and the check, called in `createStylist` (with `null`) and `updateStylist` (with `id`) after the slug checks, returning its error state when not null:

```ts
/**
 * A Google colour belongs to one active stylist (spec §3), and never to the
 * no-stylist or leave colour: an event in it would be read as that stylist's.
 */
async function googleColourProblem(colorId: string | null, stylistId: string | null): Promise<StylistActionState | null> {
  if (!colorId) return null;
  const holder = await prisma.stylist.findFirst({
    where: { isActive: true, googleColorId: colorId, ...(stylistId ? { id: { not: stylistId } } : {}) },
    select: { name: true },
  });
  if (holder) return errorState('GOOGLE_COLOUR_TAKEN', { stylist: holder.name });
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'singleton' }, select: { googleUnassignedColorId: true, googleLeaveColorId: true } });
  const reserved = [settings?.googleUnassignedColorId ?? DEFAULT_UNASSIGNED_COLOR_ID, settings?.googleLeaveColorId ?? DEFAULT_LEAVE_COLOR_ID];
  return reserved.includes(colorId) ? errorState('GOOGLE_COLOUR_RESERVED') : null;
}
```

Both `create` and `update` data gain `googleColorId: parsed.data.googleColorId, googleAliases: parsed.data.googleAliases`. (The existing `admin-stylist-integrations.test.ts` posts no Google fields: no extra query runs, so its fake needs no change.)

`admin-google-calendar.ts`:

```ts
/**
 * Admin → Integrations → Google Calendar → "Diary colours" (spec §3): the
 * no-stylist and leave colours. They must differ and no active stylist may
 * hold either. Read live by the pull and the push; applied by the next sync.
 */
export async function saveGoogleDiaryColours(formData: FormData): Promise<void> {
  const session = await verifySession();
  if (session.role !== 'ADMIN') throw new Error('Unauthorized');
  const unassigned = String(formData.get('googleUnassignedColorId') ?? '');
  const leave = String(formData.get('googleLeaveColorId') ?? '');
  if (!isGoogleColorId(unassigned) || !isGoogleColorId(leave)) redirect(await localizedPath('/admin/integrations?gcal=coloursInvalid'));
  if (unassigned === leave) redirect(await localizedPath('/admin/integrations?gcal=coloursSame'));
  const prisma = (await import('@/app/lib/prisma')).default;
  const holder = await prisma.stylist.findFirst({ where: { isActive: true, googleColorId: { in: [unassigned, leave] } }, select: { name: true } });
  if (holder) redirect(await localizedPath('/admin/integrations?gcal=coloursTaken'));
  await prisma.$transaction(async (tx) => {
    const colours = { googleUnassignedColorId: unassigned, googleLeaveColorId: leave };
    await tx.siteSettings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...colours }, update: colours });
    await appendAuditEvent({
      actorUserId: session.userId, action: 'INTEGRATION.GOOGLE_DIARY_COLOURS', targetType: 'Integration', targetId: 'google-calendar',
      metadata: { unassigned, leave },
    }, tx);
  });
  for (const path of ['/admin/integrations', '/admin']) revalidateAllLocales(revalidatePath, path);
  redirect(await localizedPath('/admin/integrations?gcal=coloursSaved'));
}
```

`GoogleCalendarStatus.tsx` — props `{ status, colours }`; after the Sync now form, a form `action={saveGoogleDiaryColours}` with heading `t('integrations.google.colours.title')`, intro, `GoogleColorPicker name="googleUnassignedColorId" allowNone={false} initial={colours.unassignedColorId}` (label/help `colours.unassigned`/`unassignedHelp`), the same for `googleLeaveColorId`, a read-only list of `colours.stylists` (name, a dot in `stylistSwatch({ calendarColor: null, googleColorId: s.googleColorId }).swatch` when set, else `colours.stylistNone`, and the aliases), and a submit button `colours.save`. Shown whether the sync is on or off.

Integrations page: `SearchParams.gcal` unchanged; load `loadDiaryConfig()` in the existing `Promise.all`; pass `colours` to `GoogleCalendarStatus`; banners: status codes `['done', 'disabled', 'cleared', 'coloursSaved']`, alert codes `['error', 'clearError', 'coloursSame', 'coloursTaken', 'coloursInvalid']` (keep the `t(\`integrations.google.status.${query.gcal}\`)` lookup, guarded by these lists).

Messages:
- `adminSchedule.googleColors` en: `{ none: 'No Google colour', lavender: 'Lavender', sage: 'Sage', grape: 'Grape', flamingo: 'Flamingo', banana: 'Banana', tangerine: 'Tangerine', peacock: 'Peacock', graphite: 'Graphite', blueberry: 'Blueberry', basil: 'Basil', tomato: 'Tomato' }`; zh: `{ none: '沒有 Google 顏色', lavender: '薰衣草紫', sage: '鼠尾草綠', grape: '葡萄紫', flamingo: '紅鶴粉', banana: '香蕉黃', tangerine: '橘橙色', peacock: '孔雀藍', graphite: '石墨灰', blueberry: '藍莓色', basil: '羅勒綠', tomato: '番茄紅' }`.
- `adminContent.stylists.form` en: `googleDiary: 'Google diary'`, `googleColour: 'Google colour'`, `googleColourHelp: 'The colour this stylist’s customers have in the salon’s Google Calendar. Events in it block this stylist on the website and in Fresha, and website bookings for this stylist are written in it. Applied by the next Google Calendar sync.'`, `googleNames: 'Google names'`, `googleNamesHelp: 'Other names the diary uses for this stylist, separated by commas, e.g. F or 天. A single letter counts only in brackets, as in “早走(L)”. The stylist’s own name always counts.'`. zh: `googleDiary: 'Google 日曆'`, `googleColour: 'Google 顏色'`, `googleColourHelp: '此髮型師的客人在本店 Google 日曆中使用的顏色。該顏色的活動會在網站及 Fresha 封鎖此髮型師的時間，此髮型師的網上預約亦會以此顏色寫入日曆。下次 Google 日曆同步後生效。'`, `googleNames: 'Google 名稱'`, `googleNamesHelp: '記事簿中對此髮型師的其他稱呼，以逗號分隔，例如 F 或 天。單一英文字母只在括號內才算，例如「早走(L)」。髮型師本身的名字一定會算。'`.
- `adminContent.stylists.errors` en: `GOOGLE_COLOUR: 'Unknown Google colour.'`, `GOOGLE_COLOUR_TAKEN: '{stylist} already uses this Google colour. Each active stylist needs their own.'`, `GOOGLE_COLOUR_RESERVED: 'This Google colour is set aside for bookings without a stylist or for leave (Admin → Integrations → Google Calendar).'`, `GOOGLE_NAMES: 'Google names are too long (max 200 characters).'`. zh: `'未知的 Google 顏色。'`, `'{stylist} 已使用此 Google 顏色。每位在職髮型師須使用不同顏色。'`, `'此 Google 顏色已預留給未指定髮型師的預約或休假（後台 → 整合 → Google 日曆）。'`, `'Google 名稱過長（最多 200 個字元）。'`.
- `adminOps.integrations.google.colours` en: `{ title: 'Diary colours', intro: 'How the salon’s Google Calendar colours are read. Each stylist’s colour and names are set in Admin → Stylists. Changes are applied by the next sync: press Sync now.', unassigned: 'No stylist (walk-ins, Treatwell)', unassignedHelp: 'Each event in this colour takes one chair: online booking always leaves a free stylist for it.', leave: 'Leave', leaveHelp: 'Set aside for leave: an event in it blocks the stylists its title names.', stylists: 'Stylist colours', stylistNone: 'No Google colour', save: 'Save colours' }`; zh: `{ title: '記事簿顏色', intro: '本店 Google 日曆顏色的讀取方式。各髮型師的顏色及名稱在「後台 → 髮型師」設定。更改會在下次同步後生效：請按「立即同步」。', unassigned: '未指定髮型師（即場客、Treatwell）', unassignedHelp: '此顏色的每項活動佔用一個座位：網上預約一定會為它留一位空閒髮型師。', leave: '休假', leaveHelp: '預留給休假：此顏色的活動會封鎖標題中提及的髮型師。', stylists: '髮型師顏色', stylistNone: '沒有 Google 顏色', save: '儲存顏色' }`.
- `adminOps.integrations.google.status` en: `coloursSaved: 'Diary colours saved. Press Sync now to apply them.'`, `coloursSame: 'The no-stylist and leave colours must be different. Nothing was changed.'`, `coloursTaken: 'An active stylist already uses that colour. Nothing was changed.'`, `coloursInvalid: 'Unknown colour. Nothing was changed.'`; zh: `coloursSaved: '已儲存記事簿顏色。請按「立即同步」套用。'`, `coloursSame: '未指定髮型師及休假的顏色必須不同。沒有作出任何更改。'`, `coloursTaken: '有在職髮型師已使用該顏色。沒有作出任何更改。'`, `coloursInvalid: '未知的顏色。沒有作出任何更改。'`.

- [ ] **Step 4: Run the tests**

Run the Step 2 command plus `node --conditions=react-server --import tsx --test src/i18n/messages/completeness.test.ts src/app/actions/admin-stylist-integrations.test.ts`, then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec eslint` on the changed files.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/GoogleColorPicker.tsx src/components/admin/GoogleColorPicker.test.ts src/components/admin/StylistForm.tsx \
  src/components/admin/StylistFormGoogle.test.ts 'src/app/[locale]/admin/stylists/[id]/edit/page.tsx' src/app/actions/admin-stylists.ts \
  src/app/actions/admin-stylists-google.test.ts src/app/actions/admin-google-calendar.ts src/app/actions/admin-google-calendar.test.ts \
  src/components/admin/GoogleCalendarStatus.tsx 'src/app/[locale]/admin/integrations/page.tsx' src/test/pages/admin-integrations-google-page.test.ts \
  src/i18n/messages/en/adminContent.ts src/i18n/messages/zh/adminContent.ts src/i18n/messages/en/adminOps.ts src/i18n/messages/zh/adminOps.ts \
  src/i18n/messages/en/adminSchedule.ts src/i18n/messages/zh/adminSchedule.ts
git commit -F - <<'EOF'
feat(gdiary): Google colour and names per stylist; diary colours in Integrations

Admin -> Stylists sets a stylist's Google colour (unique among active
stylists, never the no-stylist or leave colour) and the other names the
diary uses. Admin -> Integrations sets the no-stylist and leave colours
(defaults Tomato and Graphite), audited. Google's colour names in both
languages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 8: Admin → Schedule mirrors the Google diary

**Files:**
- Modify: `src/app/services/admin-calendar-data.ts:17-30, 122-183` (diary entries, GOOGLE blocks excluded, `googleColorId` selected)
- Modify: `src/app/services/admin-calendar-data.test.ts`
- Modify: `src/app/lib/calendar-busy-display.ts:15-28` (`calendarBusyForDay` made generic)
- Create: `src/app/lib/calendar-diary-display.ts`, `src/app/lib/calendar-diary-display.test.ts`
- Create: `src/components/admin/GoogleDiaryPanel.tsx`, `src/components/admin/GoogleDiaryNotes.tsx`
- Modify: `src/components/admin/ScheduleDayGrid.tsx`, `ScheduleWeekGrid.tsx`, `ScheduleCalendar.tsx`
- Modify: `src/app/[locale]/admin/page.tsx:40, 85` (pass `diaryEntries`)
- Create: `src/components/admin/ScheduleGoogleDiary.test.ts`
- Modify messages: `src/i18n/messages/{en,zh}/adminSchedule.ts` (`diary.*`)

**Interfaces:**
- Consumes: `DiaryKind` (Task 2, `import type` only: the classifier module pulls in `node:crypto` and must not enter a client bundle), `googleEventSwatch`, `stylistSwatch`, `GOOGLE_EVENT_COLORS` (Task 2), `adminSchedule.googleColors` (Task 7).
- Produces:
  ```ts
  // src/app/lib/calendar-diary-display.ts (client-safe, pure)
  export type CalendarDiaryEntry = { id: string; kind: DiaryKind; stylistIds: string[]; title: string; colorId: string | null; start: string; end: string; allDay: boolean; htmlLink: string | null };
  export type PlacedDiaryEntry = CalendarDiaryEntry & { startMin: number; endMin: number };
  export function diaryForDay(entries: readonly CalendarDiaryEntry[], dayKey: string): { placed: PlacedDiaryEntry[]; notes: PlacedDiaryEntry[] };
  export function diaryLanes(items: readonly { id: string; startMin: number; endMin: number }[]): { lane: Map<string, number>; laneCount: number };
  export function diaryRange(entry: { startMin: number; endMin: number }): string;   // "14:00–15:00"
  export function parseDiaryStylistIds(json: string): string[];
  // src/app/lib/calendar-busy-display.ts
  export function calendarBusyForDay<T extends { start: string; end: string }>(blocks: readonly T[], dayKey: string): (T & { startMin: number; endMin: number })[];
  // getAdminCalendarData() result gains diaryEntries: CalendarDiaryEntry[]
  // ScheduleDayGrid / ScheduleWeekGrid props gain diaryEntries?: CalendarDiaryEntry[]; onSelectDiary?: (entry: CalendarDiaryEntry) => void
  // GridStylist gains googleColorId?: string | null
  // GoogleDiaryPanel({ entry, stylistNames: Record<string, string>, onClose }) ; GoogleDiaryNotes({ notes, onSelect, compact? })
  ```

- [ ] **Step 1: Write the failing tests**

`src/app/lib/calendar-diary-display.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { diaryForDay, diaryLanes, diaryRange, parseDiaryStylistIds, type CalendarDiaryEntry } from './calendar-diary-display';

const entry = (id: string, kind: CalendarDiaryEntry['kind'], start: string, end: string, allDay = false): CalendarDiaryEntry =>
  ({ id, kind, stylistIds: [], title: id, colorId: null, start, end, allDay, htmlLink: null });

test('the London day: notes go to the strip, everything else to columns, clipped like busy time', () => {
  const day = diaryForDay([
    entry('walkin', 'UNASSIGNED', '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z'),
    entry('note', 'NOTE', '2026-10-23T09:00:00Z', '2026-10-23T09:30:00Z'),
    entry('away', 'LEAVE', '2026-10-22T23:00:00Z', '2026-10-23T23:00:00Z', true),
    entry('tomorrow', 'STYLIST', '2026-10-24T09:00:00Z', '2026-10-24T10:00:00Z'),
  ], '2026-10-23');
  assert.deepEqual(day.placed.map((e) => [e.id, e.startMin, e.endMin]), [['walkin', 840, 900], ['away', 0, 1440]]);
  assert.deepEqual(day.notes.map((e) => e.id), ['note']);
});

test('lanes put overlapping entries side by side', () => {
  const { lane, laneCount } = diaryLanes([{ id: 'a', startMin: 600, endMin: 660 }, { id: 'b', startMin: 630, endMin: 690 }, { id: 'c', startMin: 660, endMin: 720 }]);
  assert.equal(laneCount, 2);
  assert.deepEqual([lane.get('a'), lane.get('b'), lane.get('c')], [0, 1, 0]);
});

test('range text and stored stylist ids', () => {
  assert.equal(diaryRange({ startMin: 840, endMin: 900 }), '14:00–15:00');
  assert.deepEqual(parseDiaryStylistIds('["lox","funky"]'), ['lox', 'funky']);
  assert.deepEqual(parseDiaryStylistIds('not json'), []);
  assert.deepEqual(parseDiaryStylistIds('[1,"lox"]'), ['lox']);
});
```

`src/app/services/admin-calendar-data.test.ts` — add:

```ts
test('day view loads the Google diary for the range; Google busy blocks are no longer loaded separately', async () => {
  const busyWhere: Record<string, unknown>[] = [];
  const diaryQueries: Record<string, unknown>[] = [];
  const db = {
    appointment: { count: async () => 0, groupBy: async () => [], findMany: async () => [] },
    stylist: { findMany: async () => [] },
    service: { findMany: async () => [] },
    externalBusyBlock: { findMany: async ({ where }: { where: Record<string, unknown> }) => { busyWhere.push(where); return []; } },
    googleDiaryEntry: {
      findMany: async (query: Record<string, unknown>) => {
        diaryQueries.push(query);
        return [{ id: 'd1', kind: 'LEAVE', stylistIdsJson: '["lox","funky"]', title: '遲返 (L)(F)', colorId: '8', start: new Date('2026-09-16T09:00:00Z'), end: new Date('2026-09-16T10:00:00Z'), allDay: false, htmlLink: null }];
      },
    },
    $queryRaw: async () => [{}],
  };
  const { getAdminCalendarData } = loadServerModule<typeof import('./admin-calendar-data')>('src/app/services/admin-calendar-data.ts', {
    '@/app/lib/prisma': { __esModule: true, default: db, getDatabaseProvider: () => 'postgresql' },
    '@/app/lib/session': { requireAdmin: async () => ({ userId: 'admin', role: 'ADMIN' }) },
    './integration-readiness': { getTreatwellSyncCoverage: async () => ({ warning: null }) },
  });
  const result = await getAdminCalendarData({ date: '2026-09-16', view: 'day' });
  assert.deepEqual(result.diaryEntries, [{
    id: 'd1', kind: 'LEAVE', stylistIds: ['lox', 'funky'], title: '遲返 (L)(F)', colorId: '8',
    start: '2026-09-16T09:00:00.000Z', end: '2026-09-16T10:00:00.000Z', allDay: false, htmlLink: null,
  }]);
  assert.equal(diaryQueries.length, 1);
  assert.deepEqual((busyWhere[0] as { source?: unknown }).source, { not: 'GOOGLE' });
});
```

(The existing year-view test, whose fake has no `googleDiaryEntry`, proves the year view never reads the diary.)

`src/components/admin/ScheduleGoogleDiary.test.ts` (helpers `elements`/`text`/`hooks` as in `ScheduleExternalBusy.test.ts`; `i18n(locale)` returns `{ useT: (ns) => translator(locale, ns), useLocale: () => locale }`):

```ts
const DAY = '2026-10-23'; // BST: 13:00Z is 14:00 in London
const entry = (id: string, kind: CalendarDiaryEntry['kind'], stylistIds: string[], title: string, colorId: string | null, start: string, end: string): CalendarDiaryEntry =>
  ({ id, kind, stylistIds, title, colorId, start, end, allDay: false, htmlLink: `https://www.google.com/calendar/event?eid=${id}` });
const ENTRIES = [
  entry('amy', 'STYLIST', ['lox'], 'Amy 07700', '5', '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z'),
  entry('walkin', 'UNASSIGNED', [], 'Cut - Erin(W)', '11', '2026-10-23T14:00:00Z', '2026-10-23T15:00:00Z'),
  entry('late', 'LEAVE', ['lox', 'funky'], '遲返 (L)(F)', '8', '2026-10-23T09:00:00Z', '2026-10-23T10:00:00Z'),
  entry('note', 'NOTE', [], '卡機', '8', '2026-10-23T11:00:00Z', '2026-10-23T11:30:00Z'),
];
const STYLISTS = [
  { id: 'funky', name: 'Funky', calendarColor: null, googleColorId: '2', availability: { startTime: '10:00', endTime: '19:00' }, availabilityByWeekday: { 5: { startTime: '10:00', endTime: '19:00' } } },
  { id: 'lox', name: 'Lox', calendarColor: null, googleColorId: '5', availability: { startTime: '10:00', endTime: '19:00' }, availabilityByWeekday: { 5: { startTime: '10:00', endTime: '19:00' } } },
];
const BOOKING = { id: 'web', stylistId: 'lox', date: '2026-10-23T15:00:00Z', durationMin: 60, status: 'CONFIRMED', customerName: 'Web Customer', serviceName: 'Cut', serviceColor: null, updatedAt: '2026-10-01T00:00:00Z' };

function render(view: 'Day' | 'Week', entries = ENTRIES, locale: Locale = 'en-GB', selected: CalendarDiaryEntry[] = []) {
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(`src/components/admin/Schedule${view}Grid.tsx`, {
    react: hooks, '@/i18n/client': i18n(locale), './MoveConfirmDialog': { MoveConfirmDialog: () => null },
  });
  return elements(grid[`Schedule${view}Grid`]({
    day: new Date(`${DAY}T12:00:00Z`), dayKeys: [DAY], todayKey: DAY, stylists: STYLISTS, appointments: [BOOKING], busyBlocks: [],
    diaryEntries: entries, onSelectDiary: (picked: CalendarDiaryEntry) => selected.push(picked),
  }));
}
const labelled = (nodes: Element[], words: string) => nodes.filter((node) => String(node.props['aria-label'] ?? '').includes(words));

test('day view: a No stylist column for a walk-in, in Google’s tomato with its Google title and badge', () => {
  const nodes = render('Day');
  assert.ok(nodes.some((node) => text(node) === 'No stylist'));
  const [walkIn] = labelled(nodes, 'Cut - Erin(W)');
  assert.match(String(walkIn.props.className), /bg-\[#d50000\]/);
  assert.match(String(walkIn.props.className), /text-white/);
  assert.ok(elements(walkIn).some((node) => text(node) === 'Google'));
});

test('day view: no walk-in that day, no No stylist column', () => {
  assert.ok(!render('Day', ENTRIES.filter((e) => e.kind !== 'UNASSIGNED')).some((node) => text(node) === 'No stylist'));
});

// Child components (GoogleDiaryNotes) are elements, not rendered output, in these trees:
// the strip is found by its `notes` prop, and GoogleDiaryNotes is rendered on its own below.
const strip = (nodes: Element[]) => nodes.find((node) => Array.isArray(node.props.notes));

test('day view: a leave naming two stylists sits in both columns; a note goes to the strip, never a column', () => {
  const nodes = render('Day');
  assert.equal(labelled(nodes, '遲返 (L)(F)').length, 2);
  assert.deepEqual((strip(nodes)!.props.notes as CalendarDiaryEntry[]).map((e) => e.id), ['note']);
  assert.equal(labelled(nodes, '卡機').length, 0);
});

test('the notes strip: one button per note, labelled with its title and time', () => {
  const notes = loadServerModule<typeof import('./GoogleDiaryNotes')>('src/components/admin/GoogleDiaryNotes.tsx', { react: hooks, '@/i18n/client': i18n('en-GB') });
  const selected: CalendarDiaryEntry[] = [];
  const nodes = elements(notes.GoogleDiaryNotes({ notes: [{ ...ENTRIES[3], startMin: 720, endMin: 750 }], onSelect: (e: CalendarDiaryEntry) => selected.push(e) }));
  assert.ok(nodes.some((node) => node.props['data-testid'] === 'diary-notes'));
  const [button] = labelled(nodes, '卡機 · 12:00–12:30 · Google');
  (button.props.onClick as () => void)();
  assert.deepEqual(selected.map((e) => e.id), ['note']);
  assert.equal(elements(notes.GoogleDiaryNotes({ notes: [], onSelect: () => undefined })).length, 0);
});

test('day view: Google entries are read-only; a click opens the panel and never starts a booking', () => {
  const selected: CalendarDiaryEntry[] = [];
  const [amy] = labelled(render('Day', ENTRIES, 'en-GB', selected), 'Amy 07700');
  assert.equal(amy.props.onPointerDown, undefined, 'not draggable');
  let stopped = false;
  (amy.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(selected.map((e) => e.id), ['amy']);
});

test('day view: a website booking takes its stylist’s Google colour', () => {
  const booking = render('Day').find((node) => node.props.onPointerDown && String(node.props.className).includes('cursor-grab'))!;
  assert.match(String(booking.props.className), /bg-\[#f6bf26\]/);
  assert.match(String(booking.props.className), /text-zinc-950/);
});

test('week view: the same entries, compact, in their Google colours', () => {
  const nodes = render('Week');
  assert.match(String(labelled(nodes, 'Cut - Erin(W)')[0].props.className), /bg-\[#d50000\]/);
  assert.equal(labelled(nodes, '遲返 (L)(F)').length, 1, 'one block per entry in the week');
  assert.deepEqual((strip(nodes)!.props.notes as CalendarDiaryEntry[]).map((e) => e.id), ['note']);
});

test('Chinese labels', () => {
  assert.ok(render('Day', ENTRIES, 'zh-HK').some((node) => text(node) === '未指定髮型師'));
});

test('the panel: title, kind, stylists and an Open in Google Calendar link only for a Google link', () => {
  const panel = loadServerModule<typeof import('./GoogleDiaryPanel')>('src/components/admin/GoogleDiaryPanel.tsx', { react: hooks, '@/i18n/client': i18n('en-GB') });
  const nodes = elements(panel.GoogleDiaryPanel({ entry: ENTRIES[2], stylistNames: { lox: 'Lox', funky: 'Funky' }, onClose: () => undefined }));
  const link = nodes.find((node) => node.type === 'a')!;
  assert.deepEqual([link.props.href, link.props.target, link.props.rel, text(link)],
    ['https://www.google.com/calendar/event?eid=late', '_blank', 'noopener noreferrer', 'Open in Google Calendar']);
  assert.ok(nodes.some((node) => text(node) === 'Leave or away: blocks the stylists named'));
  assert.ok(nodes.some((node) => text(node) === 'Lox, Funky'));
  const plain = elements(panel.GoogleDiaryPanel({ entry: { ...ENTRIES[2], htmlLink: null }, stylistNames: {}, onClose: () => undefined }));
  assert.ok(!plain.some((node) => node.type === 'a'));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --conditions=react-server --import tsx --test src/app/lib/calendar-diary-display.test.ts src/app/services/admin-calendar-data.test.ts src/components/admin/ScheduleGoogleDiary.test.ts src/components/admin/ScheduleExternalBusy.test.ts`
Expected: FAIL (new module and props missing); `ScheduleExternalBusy.test.ts` still passes.

- [ ] **Step 3: Implement the data and pure display**

`calendar-busy-display.ts`: `export function calendarBusyForDay<T extends { start: string; end: string }>(blocks: readonly T[], dayKey: string): (T & { startMin: number; endMin: number })[]` — body unchanged.

`src/app/lib/calendar-diary-display.ts`:

```ts
import type { DiaryKind } from '@/app/services/google-diary-classify';
import { calendarBusyForDay } from './calendar-busy-display';

/** One salon-diary entry as Admin → Schedule receives it (admin-calendar-data.ts). Admin-only: titles may hold customers' names. */
export type CalendarDiaryEntry = {
  id: string; kind: DiaryKind; stylistIds: string[]; title: string; colorId: string | null;
  start: string; end: string; allDay: boolean; htmlLink: string | null;
};
export type PlacedDiaryEntry = CalendarDiaryEntry & { startMin: number; endMin: number };

/** The London day's entries, clipped like synced busy time: notes for the strip above the grid, the rest for columns. */
export function diaryForDay(entries: readonly CalendarDiaryEntry[], dayKey: string): { placed: PlacedDiaryEntry[]; notes: PlacedDiaryEntry[] } {
  const day = calendarBusyForDay(entries, dayKey);
  return { placed: day.filter((entry) => entry.kind !== 'NOTE'), notes: day.filter((entry) => entry.kind === 'NOTE') };
}

/** Side-by-side lanes for overlapping entries (the week grid's lanesFor rule). */
export function diaryLanes(items: readonly { id: string; startMin: number; endMin: number }[]): { lane: Map<string, number>; laneCount: number } {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin);
  const laneEnds: number[] = [];
  const lane = new Map<string, number>();
  for (const item of sorted) {
    const index = laneEnds.findIndex((end) => end <= item.startMin);
    const slot = index === -1 ? laneEnds.length : index;
    laneEnds[slot] = item.endMin;
    lane.set(item.id, slot);
  }
  return { lane, laneCount: Math.max(1, laneEnds.length) };
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function diaryRange(entry: { startMin: number; endMin: number }): string {
  return `${clock(entry.startMin)}–${clock(entry.endMin)}`;
}

export function parseDiaryStylistIds(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
```

`admin-calendar-data.ts`:
- `calendarAppointmentSelect.stylist`: `{ select: { name: true, calendarColor: true, googleColorId: true } }`.
- The `stylists` query selects `googleColorId: true` too.
- The busy query `where`: `{ source: { not: 'GOOGLE' }, start: { lt: range.lt }, end: { gt: range.gte } }` with the comment `// Google's own busy time is drawn from the diary entries below (diary mirror spec §9).`
- A new member of the `Promise.all` (destructured as `diaryRows`):
  ```ts
  view !== 'day' && view !== 'week' ? Promise.resolve([]) : prisma.googleDiaryEntry.findMany({
    where: { start: { lt: range.lt }, end: { gt: range.gte } },
    select: { id: true, kind: true, stylistIdsJson: true, title: true, colorId: true, start: true, end: true, allDay: true, htmlLink: true },
    orderBy: [{ start: 'asc' }, { id: 'asc' }],
  }),
  ```
- Result gains `diaryEntries: diaryRows.map(({ stylistIdsJson, kind, start, end, ...row }) => ({ ...row, kind: kind as DiaryKind, stylistIds: parseDiaryStylistIds(stylistIdsJson), start: start.toISOString(), end: end.toISOString() }))`.

- [ ] **Step 4: Implement the components**

`GoogleDiaryPanel.tsx` (`'use client'`): a fixed overlay `role="dialog" aria-modal="true" aria-labelledby="google-diary-title"`; backdrop button closes; content: heading `entry.title || t('diary.noTitle')` (id `google-diary-title`), a "Google" badge, a `dl` with `diary.when` (`formatCalendarDay(locale, salonDateKey(new Date(entry.start)), { weekday: 'long', day: 'numeric', month: 'long' })` plus `diary.allDay` or `formatSalonClock(locale, start)–formatSalonClock(locale, end)`), `diary.kindLabel` → `t(\`diary.kind.${entry.kind}\`)`, `diary.stylists` → names joined with `', '` (only when `stylistIds.length`), `diary.colour` → `t.dynamic(\`googleColors.${GOOGLE_EVENT_COLORS[id].key}\`)` or `googleColors.none`; the read-only note `diary.readOnly`; `{entry.htmlLink && <a href={entry.htmlLink} target="_blank" rel="noopener noreferrer">{t('diary.openInGoogle')}</a>}`; a Close button `diary.close`. Monochrome chrome; only the colour chip uses `googleEventSwatch(entry.colorId).swatch`.

`GoogleDiaryNotes.tsx` (`'use client'`): `({ notes, onSelect, compact })` → `<div data-testid="diary-notes">` with a heading `diary.notes` (hidden when `compact`) and one `<button type="button">` per note: `aria-label={t('diary.detail', { title: note.title || t('diary.noTitle'), range: note.allDay ? t('diary.allDay') : diaryRange(note) })}`, a dot in `googleEventSwatch(note.colorId).swatch`, the range and the title (truncated); `onClick={() => onSelect?.(note)}`. Renders nothing when `notes` is empty.

`ScheduleDayGrid.tsx`:
- `GridStylist` gains `googleColorId?: string | null`; every `resolveCalendarColor(stylist.calendarColor)` becomes `stylistSwatch(stylist)` (heading dot and booking blocks).
- Props `diaryEntries = []`, `onSelectDiary`; `const dayDiary = useMemo(() => diaryForDay(diaryEntries, dayKey), [diaryEntries, dayKey]);`, `const walkIns = dayDiary.placed.filter((e) => e.kind === 'UNASSIGNED');`, `const showNoStylist = walkIns.length > 0;`.
- `bounds`: also widen for `dayDiary.placed` entries that are not `allDay` (all-day entries are drawn clamped to the bounds and never stretch the grid to midnight).
- Under the column headings, when `dayDiary.notes.length`: `<GoogleDiaryNotes notes={dayDiary.notes} onSelect={onSelectDiary} />`.
- Headings: after the stylists, when `showNoStylist`, a heading cell with `t('diary.noStylist')` (no working hours line).
- A `DiaryBlock` render helper used in stylist columns (entries whose `kind` is STYLIST or LEAVE and whose `stylistIds` include the column's id) and in the No stylist column (UNASSIGNED, positioned with `diaryLanes(walkIns)`):
  ```tsx
  const diaryBlock = (entry: PlacedDiaryEntry, place: { left: string; width: string } = { left: '0%', width: '100%' }) => {
    const swatch = googleEventSwatch(entry.colorId);
    const startMin = Math.max(entry.startMin, bounds.startMin);
    const endMin = Math.min(entry.endMin, bounds.endMin);
    const label = t('diary.detail', { title: entry.title || t('diary.noTitle'), range: entry.allDay ? t('diary.allDay') : diaryRange(entry) });
    return (
      <div
        key={`diary-${entry.id}`}
        role="button"
        tabIndex={0}
        aria-label={label}
        title={label}
        onClick={(event) => { event.stopPropagation(); onSelectDiary?.(entry); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectDiary?.(entry); } }}
        className={`absolute overflow-hidden rounded px-1 text-[10px] leading-tight z-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-zinc-900 ${swatch.fill} ${swatch.text}`}
        style={{ top: minutesToOffset(startMin, bounds.startMin, PX_PER_MINUTE), height: Math.max(18, (endMin - startMin) * PX_PER_MINUTE), left: place.left, width: place.width }}
      >
        <span className="mr-1 rounded bg-white/80 px-0.5 font-semibold text-zinc-900">{t('diary.google')}</span>
        <span className="font-semibold">{entry.title || t('diary.noTitle')}</span>
        <span className="block tabular-nums opacity-90">{entry.allDay ? t('diary.allDay') : diaryRange(entry)}</span>
      </div>
    );
  };
  ```
  Booking blocks keep `z-10` so a website booking stays clickable above a diary entry it overlaps; diary blocks never get `onPointerDown`.
- The No stylist column is a `flex-1 min-w-0 relative border-l` div with the hour lines and no `onClick` (no booking can be created there); it is not added to `columnRefs` (bookings cannot be dragged into it).

`ScheduleWeekGrid.tsx`:
- `stylistSwatch(stylist ?? { calendarColor: null })` for booking blocks.
- Props `diaryEntries = []`, `onSelectDiary`; per day: `const diary = diaryForDay(diaryEntries, key)`; `lanesFor` also takes `diary.placed` (ids `diary-${id}`); each placed entry is drawn once (not per stylist) with the same Google fill/text classes, `aria-label` `t('diary.detail', …)`, `onClick` stopping propagation and calling `onSelectDiary`; NOTE entries render as `<GoogleDiaryNotes notes={diary.notes} onSelect={onSelectDiary} compact />` in that day's heading cell.

`ScheduleCalendar.tsx`:
- Import `useState` from react; `RosterStylist` gains `googleColorId: string | null`; `gridStylists` and `weekStylists` pass `googleColorId`; the month view's booking chip uses `stylistSwatch(appt.stylist)`.
- Prop `diaryEntries: CalendarDiaryEntry[]` (default `[]`); `const [diaryOpen, setDiaryOpen] = useState<CalendarDiaryEntry | null>(null);`
- `busyStylistIds` also adds every stylist id named by the day's STYLIST/LEAVE diary entries.
- Pass `diaryEntries` and `onSelectDiary={setDiaryOpen}` to both grids; render `{diaryOpen && <GoogleDiaryPanel entry={diaryOpen} stylistNames={Object.fromEntries(stylists.map((s) => [s.id, s.name]))} onClose={() => setDiaryOpen(null)} />}` next to the `AppointmentDialog`.
- Phone agenda (the `sm:hidden` day list and the `md:hidden` week list): after `BusyAgenda`, a compact list of that day's diary entries (`diaryForDay(diaryEntries, key)`: placed then notes), one line each: colour dot, range or all day, title, kind label; each line a button opening the panel.

`src/app/[locale]/admin/page.tsx`: destructure `diaryEntries` from the calendar data and pass `diaryEntries={diaryEntries}` to `ScheduleCalendar`.

Messages `adminSchedule.diary`:
- en: `{ google: 'Google', noStylist: 'No stylist', notes: 'Diary notes', allDay: 'All day', noTitle: '(no title)', readOnly: 'From the salon’s Google Calendar. Change it there.', openInGoogle: 'Open in Google Calendar', close: 'Close', when: 'When', kindLabel: 'Type', stylists: 'Stylists', colour: 'Colour', detail: '{title} · {range} · Google', kind: { STYLIST: 'Stylist’s booking', UNASSIGNED: 'No stylist yet: takes a chair', LEAVE: 'Leave or away: blocks the stylists named', NOTE: 'Note: blocks nothing' } }`
- zh: `{ google: 'Google', noStylist: '未指定髮型師', notes: '記事', allDay: '全日', noTitle: '（沒有標題）', readOnly: '來自本店 Google 日曆，請在 Google 日曆修改。', openInGoogle: '在 Google 日曆開啟', close: '關閉', when: '時間', kindLabel: '類別', stylists: '髮型師', colour: '顏色', detail: '{title} · {range} · Google', kind: { STYLIST: '髮型師的預約', UNASSIGNED: '未指定髮型師：佔用一個座位', LEAVE: '休假或外出：封鎖所列髮型師', NOTE: '記事：不封鎖任何時間' } }`

- [ ] **Step 5: Run the tests**

Run the Step 2 command plus `node --conditions=react-server --import tsx --test src/components/admin/ScheduleMoveConfirm.test.ts src/app/lib/calendar-busy-display.test.ts src/app/services/admin-calendar-week.test.ts src/i18n/messages/completeness.test.ts`, then `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm exec eslint` on the changed files.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/services/admin-calendar-data.ts src/app/services/admin-calendar-data.test.ts src/app/lib/calendar-busy-display.ts \
  src/app/lib/calendar-diary-display.ts src/app/lib/calendar-diary-display.test.ts src/components/admin/GoogleDiaryPanel.tsx \
  src/components/admin/GoogleDiaryNotes.tsx src/components/admin/ScheduleDayGrid.tsx src/components/admin/ScheduleWeekGrid.tsx \
  src/components/admin/ScheduleCalendar.tsx 'src/app/[locale]/admin/page.tsx' src/components/admin/ScheduleGoogleDiary.test.ts \
  src/i18n/messages/en/adminSchedule.ts src/i18n/messages/zh/adminSchedule.ts
git commit -F - <<'EOF'
feat(gdiary): Admin schedule mirrors the Google diary

Day view: Google entries in their stylists' columns with Google's title and
colour, walk-ins in a "No stylist" column, notes in a strip above the grid;
read-only, a click opens a panel with "Open in Google Calendar". Week view
shows the same entries compactly; website bookings take their stylist's
Google colour. Google busy blocks are no longer drawn separately.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

### Task 9: PostgreSQL lifecycle check, runbook and agent docs

**Files:**
- Modify: `scripts/verify-booking-lifecycle.ts:174-176` (empty-database check), `:1223-1470` (Google section)
- Modify: `docs/google-calendar-setup.md` (§1, §2, §4, §6, §8)
- Modify: `docs/data-erasure.md` (the diary copy)
- Modify: `CLAUDE.md` (Project Overview Google line, Current state, Calendars bullet, Neon section), `readme/structure.md:411-426`

**Interfaces:**
- Consumes: everything above. Produces: no code interface.

- [ ] **Step 1: Extend the PostgreSQL lifecycle check** (`scripts/verify-booking-lifecycle.ts`)

1. Add `db.googleDiaryEntry.count()` to the `existing` empty-database array.
2. Right after `const googleSettings = …` (line 1242):
   ```ts
   // The rows below belong to this calendar: record it, or the calendar change guard starts over.
   await db.googleCalendarSyncState.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', calendarId: googleConfig.calendarId }, update: { calendarId: googleConfig.calendarId } });
   // The stylist's Google colour: their website events are written in it, their diary events are theirs.
   await db.stylist.update({ where: { id: ids.stylist }, data: { googleColorId: '5' } });
   ```
3. After the first push's assertions: `assert.equal(googleStore.get(googleEventIdFor(neverWritten))?.colorId, '5', 'the stylist’s Google colour');`
4. Replace the `googleOnly.push(…)` block (lines 1339-1344) with:
   ```ts
   googleOnly.push(
     // LEAVE: no colour, names the stylist; "Show as available", which no longer matters.
     { id: 'salondentist01', status: 'confirmed', summary: 'Synthetic Stylist: dentist', transparency: 'transparent',
       start: { dateTime: instant(gDay(3), '11:00').toISOString() }, end: { dateTime: instant(gDay(3), '12:00').toISOString() } },
     // STYLIST: a diary customer in the stylist's colour.
     { id: 'salondiaryamy1', status: 'confirmed', summary: 'Amy 07700 900123', colorId: '5',
       start: { dateTime: instant(gDay(3), '09:00').toISOString() }, end: { dateTime: instant(gDay(3), '10:00').toISOString() } },
     // UNASSIGNED: a walk-in in the no-stylist colour (takes a chair; never a busy block).
     { id: 'salonwalkin001', status: 'confirmed', summary: 'Cut - Erin(W)', colorId: '11',
       start: { dateTime: instant(gDay(3), '15:00').toISOString() }, end: { dateTime: instant(gDay(3), '16:00').toISOString() } },
     // NOTE: names nobody, blocks nothing.
     { id: 'salonnote00001', status: 'confirmed', summary: '卡機', colorId: '8',
       start: { dateTime: instant(gDay(3), '13:00').toISOString() }, end: { dateTime: instant(gDay(3), '13:30').toISOString() } },
   );
   // An entry that ended 31 days ago: before the window, deleted by the pull.
   await db.googleDiaryEntry.create({ data: { googleEventId: 'ancient-entry', kind: 'NOTE', title: 'Old note',
     start: new Date(googleNow.getTime() - 32 * 86_400_000), end: new Date(googleNow.getTime() - 31 * 86_400_000) } });
   ```
5. The first pull's expectation becomes `{ reverted: 1, blocks: 2, entries: 4, changed: true, diaryChanged: true }`; the stored-blocks expectation becomes the 09:00–10:00 and 11:00–12:00 blocks (both `ids.stylist`, `summary` null); add:
   ```ts
   const diary = await db.googleDiaryEntry.findMany({ orderBy: { start: 'asc' } });
   assert.deepEqual(diary.map((row) => [row.googleEventId, row.kind, JSON.parse(row.stylistIdsJson), row.title, row.colorId]), [
     ['salondiaryamy1', 'STYLIST', [ids.stylist], 'Amy 07700 900123', '5'],
     ['salondentist01', 'LEAVE', [ids.stylist], 'Synthetic Stylist: dentist', null],
     ['salonnote00001', 'NOTE', [], '卡機', '8'],
     ['salonwalkin001', 'UNASSIGNED', [], 'Cut - Erin(W)', '11'],
   ]);
   assert.equal(await db.googleDiaryEntry.count({ where: { googleEventId: 'ancient-entry' } }), 0, 'past the 30-day window: deleted');
   // The real availability code: diary customer and leave block the stylist; the walk-in takes the only chair (chair rule); the note blocks nothing.
   for (const time of ['09:00', '09:30', '10:30', '11:00', '11:30', '14:30', '15:00', '15:30']) assert.equal(await slotAvailable(gDay(3), time), false, `${time} is taken`);
   for (const time of ['10:00', '12:00', '13:00', '14:00', '16:00']) assert.equal(await slotAvailable(gDay(3), time), true, `${time} is free`);
   ```
   (These replace the old `10:30…15:30` / `10:00…16:00` loops.)
6. The busy-feed check: every stored block's UID is in the feed (unchanged loop); add `assert.ok(!googleFeed.includes(\`DTSTART:${icalDate(instant(gDay(3), '15:00'))}\`), 'the walk-in (UNASSIGNED) is never exported to Fresha');` and widen the title check to `for (const word of ['dentist', 'Amy', 'Erin', '卡機']) assert.ok(!googleFeed.includes(word), word);`.
7. The unchanged-pull expectation becomes `{ reverted: 0, blocks: 2, entries: 4, changed: false, diaryChanged: false }`.
8. The rollback proof fails the LAST write of the transaction, so it proves the busy blocks roll back with the diary: in the `failingCreate` proxy replace `key !== 'externalBusyBlock'` with `key !== 'googleDiaryEntry'` and its message with `'Synthetic failure writing the diary'`; keep `assert.deepEqual(await googleBlocks(), stored, …)` and add `assert.equal((await db.googleDiaryEntry.findUniqueOrThrow({ where: { googleEventId: 'salondentist01' } })).start.getTime(), instant(gDay(3), '11:00').getTime(), 'the diary rolled back with the busy time');`. After the next (successful) pull: block starts `[09:00, 12:00]`, `slotAvailable(gDay(3), '11:00') === true`, `'12:00' === false`.
9. "Clear Google busy time": `removed` stays 2; add `assert.equal(JSON.parse(clearedAudit.metadataJson ?? '{}').diaryRemoved, 4);`, `assert.equal(await db.googleDiaryEntry.count(), 0);` and `assert.equal(await slotAvailable(gDay(3), '15:00'), true, 'the walk-in left with the diary');`.
10. Before the section's own clean-up, the guard over PostgreSQL:
    ```ts
    const guard = loadServerModule<typeof import('../src/app/services/google-calendar-guard')>('src/app/services/google-calendar-guard.ts', {});
    assert.equal(await guard.guardGoogleCalendarChange(db, googleConfig.calendarId), 'same');
    assert.ok(await db.googleCalendarEvent.count() > 0);
    await db.googleCalendarSyncState.update({ where: { id: 'singleton' }, data: { channelId: 'synthetic-channel', resourceId: 'synthetic-resource', channelExpiresAt: new Date(googleNow.getTime() + 86_400_000) } });
    assert.equal(await guard.guardGoogleCalendarChange(db, 'primary-synthetic@example.invalid'), 'switched');
    assert.equal(await db.googleCalendarEvent.count(), 0, 'rows about the old calendar are gone');
    const switched = await db.googleCalendarSyncState.findUniqueOrThrow({ where: { id: 'singleton' } });
    assert.deepEqual([switched.calendarId, switched.channelId, switched.resourceId, switched.channelExpiresAt], ['primary-synthetic@example.invalid', null, null, null]);
    assert.equal(await guard.guardGoogleCalendarChange(db, 'primary-synthetic@example.invalid'), 'same', 'a second caller clears nothing');
    ```
11. Clean-up: add `await db.googleDiaryEntry.deleteMany({});` next to the `googleCalendarEvent.deleteMany`. Update the two `console.log('PASS: …')` lines to describe the diary (entries stored with their kinds in the busy transaction, the walk-in closing a slot through the chair rule and never reaching the feed, retention, the guard).

Run (needs the disposable local database the script requires, `SALON_TEST_DATABASE_URL` on localhost, database `salon_test`, migrated with `pnpm db:vercel:deploy` against it): `pnpm test:booking-lifecycle`. If no such database is available locally, say so in the task report: CI runs it on PostgreSQL 18.

- [ ] **Step 2: Update the runbook** `docs/google-calendar-setup.md`

- Header: add the design link `docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md` and a one-line note that the sync now reads and writes the salon's **primary "HarbourHair" calendar**.
- §1 "Website to Google": events go on the primary calendar, coloured by the stylist's Google colour (no colour set → the no-stylist colour).
- §1 "Google to website": replace the title-prefix paragraph with the diary rules — colour first (a stylist's colour = that stylist; the no-stylist colour, default Tomato, takes one chair), then names in the title (the stylist's name or a Google name: one letter only in brackets, `早走(L)`; longer names not glued to other letters, `LoxOff`, `Day off lox`; Chinese names anywhere, `天off`); anything else is a note that blocks nothing. "Show as: Available" is **ignored** (#72's rule is dropped: Google makes all-day events available by default, and the salon's leave is all-day). Walk-ins are never sent to Fresha; stylist and leave events are, as before. Admin → Schedule shows the whole diary (30 days back, 90 ahead) read-only.
- §2: step 4 becomes "Share the **HarbourHair** calendar (Settings and sharing → Share with specific people) with the service account email with **Make changes and see all event details** (變更和查看所有活動詳情). Its Calendar ID is `harbourhairuk@gmail.com`." Step 5: staff keep their own access. Step 6 now reads: never point another app's Google sync at it; a foreign app's events would appear in the diary and, in a stylist's colour or naming one, block that stylist.
- New §2a "Diary colours and names": Admin → Stylists (Ivan = Lavender, Funky = Sage + `F`, Lox = Banana + `L`, Shania = `天`) and Admin → Integrations → Diary colours (no-stylist Tomato, leave Graphite); then Sync now.
- §4 verification: the spec §10.5 checks (a known diary week matches titles and colours; a red event greys a slot in the slot grid; a test booking appears in the diary in its stylist's colour and disappears when cancelled); "Harbour website bookings" is deleted by the owner afterwards.
- New §4a "Changing the calendar": setting `GOOGLE_CALENDAR_ID` to another calendar and redeploying makes the next run forget which bookings were written (rows and channel), write every booking in the window to the new calendar and watch it after Sync now; events in the old calendar are never deleted.
- §6 turning it off: "Clear Google busy time" also removes the diary copy; housekeeping deletes diary entries 30 days after they end even with the sync off.
- §8 privacy: the diary copy (titles typed by staff, may hold names and phone numbers), admin-only, deleted 30 days after each entry ends; the privacy notice's `retention.googleDiary` says so.

- [ ] **Step 3: Update the agent docs**

`CLAUDE.md`:
- Project Overview `Google Calendar` line: "two-way sync with the salon's primary "HarbourHair" calendar (harbourhairuk@gmail.com), mirrored in Admin → Schedule by colour (diary mirror, 2026-10-17)".
- Calendars bullet, a new sub-bullet: "**Diary mirror** (`docs/superpowers/specs/2026-10-17-google-diary-colour-mirror-design.md`): the pull classifies every Google-only event (`services/google-diary-classify.ts`: website/cancelled skipped; stylist Google colour → STYLIST; no-stylist colour (default Tomato 11) → UNASSIGNED; else names in the title → LEAVE, else NOTE; transparency ignored) into `GoogleDiaryEntry` (30 days back to 90 ahead, deleted 30 days after the end by the pull and by housekeeping) and writes GOOGLE busy blocks for STYLIST/LEAVE only, in one transaction. UNASSIGNED entries take a chair (`services/diary-chair-rule.ts`, loaded by `diary-chair-load.ts` inside the booking reads and transactions): customer paths refuse, admin create/move warn (`DIARY_CHAIR`), staff confirm/approve never apply it (`{ chairRule: false }`). Website events take the stylist's `googleColorId`; `GoogleCalendarSyncState.calendarId` + `services/google-calendar-guard.ts` start over when `GOOGLE_CALENDAR_ID` changes. Colours: Admin → Stylists (Google colour, Google names) and Admin → Integrations (Diary colours)."
- Neon section: "The chair rule adds one `GoogleDiaryEntry` read to the booking reads (three more when the range holds a walk-in); it rides requests that are already awake. The diary is written only when it changed."
- Current state: the rollout steps of spec §10 that remain for the owner.

`readme/structure.md` (Google section, lines 411-426): entries for `lib/google-aliases.ts`, `services/google-diary-classify.ts`, `services/google-diary-config.ts`, `services/diary-chair-rule.ts`, `services/diary-chair-load.ts`, `services/google-calendar-guard.ts`, `lib/calendar-diary-display.ts`, `components/admin/GoogleColorPicker.tsx`, `GoogleDiaryPanel.tsx`, `GoogleDiaryNotes.tsx`; update `google-busy-mapping.ts` (STYLIST/LEAVE entries → blocks; `eventInterval`), `google-calendar-event.ts` (`googleColorFor` replaces `stylistColorId`), `google-calendar-pull.ts` (30-day window, diary), `admin-google-calendar.ts` (`saveGoogleDiaryColours`; clear also removes the diary), and the migration list (`20261017120000_google_diary_mirror`).

`docs/data-erasure.md`: a short paragraph — diary titles are typed by staff in Google Calendar and are not linked to an account, so erasure cannot find them; remove the customer's name from the Google events by hand if asked; the website's copy follows at the next pull and is deleted 30 days after each entry ends anyway.

- [ ] **Step 4: The full local gate**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: all pass (only the known pre-existing `tsc` noise). `pnpm build` needs the production database environment (see the late-arrival plan's recipe); run it if that environment is set up, otherwise leave it to CI and say so.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-booking-lifecycle.ts docs/google-calendar-setup.md docs/data-erasure.md CLAUDE.md readme/structure.md
git status --short   # nothing else: no scratch logs
git commit -F - <<'EOF'
docs(gdiary): runbook, agent docs and the PostgreSQL lifecycle check

The lifecycle check stores a real diary week over PostgreSQL (stylist,
leave, walk-in, note), proves the walk-in closes a slot through the real
availability code and never reaches the busy feed, that busy time and diary
roll back together, the 30-day retention, and the calendar change guard.
Runbook, CLAUDE.md and structure.md describe the diary mirror and rollout.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx
EOF
```

---

## Rulings on spec gaps (made while planning; reviewers check against these)

1. **Staff confirm / approve never apply the chair rule.** Spec §6 lists `assertAppointmentSlotAvailable` for "online bookings and Anyone assignment" and says admin paths warn, never refuse. That function is also called by staff confirming a request (`actions/admin.ts:578, 687`), by the confirm after a deposit is taken (`:720`, where a refusal would cancel and refund the booking) and by staff approving a reschedule (`:847`). Those four pass `{ chairRule: false }`; the customer reschedule request (`actions/booking.ts:899`) keeps it on. A static test pins the four.
2. **"The whole clipped span of R"** is read as one span from the earliest clipped start to the latest clipped end; a stylist must work and be free over all of it (spec: "deliberately conservative").
3. **No calendar recorded yet counts as a change.** After deploy `calendarId` is null; the first push or pull clears the rows and channel once and re-pushes the window (idempotent PUTs at the same ids while the calendar is still the old one).
4. **Housekeeping also deletes diary entries** 30 days after they end, so the privacy notice stays true with the sync off (spec §7 names only the pull).
5. **Validation the spec implies:** a stylist cannot take the no-stylist or leave colour; the two salon colours must differ and no active stylist may hold either. Two active stylists sharing a colour (possible after a reactivation) are both blocked by its events.
6. **Several stylists named in one title all count** (#72's "longest name wins" is dropped with the title-prefix rule); "Lox" and "Lox Chan" in one roster would both match "Lox Chan off".
7. **All-day entries** of every kind but NOTE are drawn in their column, clamped to the grid; NOTE entries (all-day ones too) go to the strip. All-day entries never stretch the day grid to midnight.
8. **The leave colour** changes no classification (spec §4 rule 5 treats it like any non-stylist colour); it is stored, editable and reserved (no stylist may hold it).
9. **Diary titles in the busy-block hash stay out:** a title-only change rewrites the diary but never drops the Fresha busy feeds.

## Self-review notes

- Spec §1–§2 (decisions D1–D8) → Tasks 2 (D2–D5 classification), 3 (D5, D8 export), 4–5 (D3 chair), 6 (D6 colour, calendar), 8 (D7). §3 configuration → Tasks 1, 2, 7. §4 → Task 2. §5 → Task 3 (+ Task 9 feed check). §6 → Tasks 4, 5. §7 → Tasks 1, 3 (window, privacy, clear) and 9. §8 → Task 6 (+ runbook sharing in 9). §9 → Task 8. §10 rollout → Task 9 runbook and CLAUDE.md. §11 testing: unit (Tasks 2, 4, 5, 6, 7), PostgreSQL (Task 9), page/component tests (Tasks 7, 8). §12 out of scope respected (no editing Google from Admin, no red events to Fresha, no diary older than 30 days, primary calendar only).
- Names used across tasks: `GOOGLE_EVENT_COLORS`, `GOOGLE_COLOR_IDS`, `isGoogleColorId`, `googleEventSwatch`, `stylistSwatch`, `DEFAULT_UNASSIGNED_COLOR_ID`, `DEFAULT_LEAVE_COLOR_ID`, `parseGoogleAliases`, `classifyDiaryEvent`, `stylistsNamedIn`, `diaryEntriesFrom`, `diaryHash`, `DiaryEntry`, `DiaryConfig`, `DiaryKind`, `GOOGLE_DIARY_RETENTION_DAYS`, `GOOGLE_DIARY_LOOKAHEAD_DAYS`, `eventInterval`, `googleBusyBlocks(entries)`, `loadDiaryConfig`, `GooglePullResult.entries/diaryChanged`, `checkDiaryChair`, `diaryChairAllows`, `maxConcurrent`, `loadChairContext`, `chairAllows` (buildBookingDays input), `{ chairRule: false }`, `DIARY_CHAIR`, `googleColorFor`, `guardGoogleCalendarChange`, `saveGoogleDiaryColours`, `GoogleColorPicker`, `CalendarDiaryEntry`, `diaryForDay`, `diaryLanes`, `diaryRange`, `parseDiaryStylistIds`, `GoogleDiaryPanel`, `GoogleDiaryNotes`.
