# Google Calendar Two-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror every website booking into one shared Google calendar in real time, and turn events the salon adds in Google into busy time that blocks website booking and Fresha.

**Architecture:** A service account (RS256 JWT via `jose`, plain REST, no Google SDK) writes events with deterministic ids; a `GoogleCalendarEvent` row per appointment records the hash last written. Outbound runs in `after()` from the existing feed-invalidation hook and in the existing crons; inbound arrives as `events.watch` pushes to a token-checked webhook that lists the window and (a) reverts edited website events, (b) replaces `ExternalBusyBlock(source='GOOGLE')` rows, which the outbound busy feed also exports.

**Tech Stack:** Next.js 16 route handlers / server actions / `after()`, Prisma (3 schemas), `jose` ^6, Upstash Redis (`@upstash/redis`) for single-flight, node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-10-16-google-calendar-two-way-sync-design.md`
**Depends on:** `docs/superpowers/plans/2026-10-16-late-arrival-auto-cancel.md` merged or on the same branch (late cancel/restore are appointment changes this sync mirrors).

## Global Constraints

- Env, read only inside functions: `GOOGLE_CALENDAR_SYNC_ENABLED` (`"true"` = on), `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_SA_EMAIL`, `GOOGLE_CALENDAR_SA_PRIVATE_KEY` (PEM; literal `\n` sequences are converted to newlines), `GOOGLE_CALENDAR_WEBHOOK_SECRET`. Missing/blank any → sync off. `VERCEL_ENV === 'preview'` → off whatever the env says (the preview DB holds real customers).
- Scope `https://www.googleapis.com/auth/calendar.events`; token endpoint `https://oauth2.googleapis.com/token`; API base `https://www.googleapis.com/calendar/v3`. Every call: `cache: 'no-store'`, `redirect: 'error'`, `AbortSignal.timeout(10_000)`.
- Event id: `'hh' + sha256hex('harbour-appointment:' + appointmentId).slice(0, 40)` (base32hex-safe).
- Private extended property key: `harbourAppointmentId`.
- Window: outbound appointments with `date >= startOfToday(London) - 7 days`; inbound list `timeMin = now - 1 day`, `timeMax = now + 90 days`.
- Google retention: events for appointments that ended more than 12 months ago are deleted by housekeeping.
- Google is NOT a `CalendarConnection` and NOT in `CALENDAR_PROVIDERS`.
- An event carrying `harbourAppointmentId` is NEVER an `ExternalBusyBlock` (echo guard).
- GOOGLE blocks ARE exported in the stylist's outbound busy feed; FRESHA/TREATWELL blocks are not.
- Webhook: enabled check and token check before any DB access; `sync` state → 200 with no work.
- Never call Google inside a database transaction. No new cron in `vercel.json`.
- Every fixed `lastError` sentence catalogued in `services/operations-messages.ts`; en + zh for every UI string; monochrome UI.
- Commit messages: never a bracketed skip-ci marker; end with the Co-Authored-By / Claude-Session lines.

## Review Focus

1. Echo: a website event listed by the pull must never become a busy block, or every booking clashes with itself (G5 test "website events are never blocks").
2. Revert loop: writing a reverted event back triggers another push; the second pull must find it equal and write nothing (G5 test "revert is idempotent").
3. Burst of pushes from our own writes → one pull at a time and one trailing re-run, not N pulls (G7 test).
4. A stylist named "Ivan" and a title "Ivana's party" → must NOT match Ivan (word boundary) → whole salon (G3 mapping test).
5. Google 5xx/timeouts on push → row keeps `attempts`/`lastError`, booking action still succeeds, cron retries (G4 test).

---

### Task 1 (G1): Schema and migrations

**Files:** `prisma/{vercel,dev,prod}/schema.prisma`; `prisma/*/migrations/20261016150000_google_calendar_sync/migration.sql`; test `src/app/lib/google-calendar-schema.test.ts`.

**Interfaces — Produces:** models `GoogleCalendarEvent`, `GoogleCalendarSyncState` exactly as in spec §4, plus on `Appointment`: `googleCalendarEvent GoogleCalendarEvent?`.

- [ ] Step 1: failing test in the style of `src/app/lib/late-arrival-schema.test.ts` (the late-arrival plan's Task 1): each schema has both models with the fields of spec §4, and the migration folder exists in all three providers mentioning `GoogleCalendarEvent` and `GoogleCalendarSyncState`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: add the models (copy spec §4 verbatim) and the back-relation on `Appointment` in all three schemas.
- [ ] Step 4: generate each provider's migration with `pnpm exec prisma migrate diff --from-schema-datamodel <old copy in scratchpad> --to-schema-datamodel prisma/P/schema.prisma --script`; wrap the SQL Server one in the TRY/TRAN frame used by `prisma/prod/migrations/20261009120000_reschedule_requests/migration.sql`.
- [ ] Step 5: `pnpm db:vercel:generate`; run → PASS; commit `feat(gcal): schema for Google Calendar sync`.

### Task 2 (G2): Configuration and the Google gateway

**Files:** create `src/app/lib/google-calendar-config.ts`, `src/app/services/google-calendar-gateway.ts`; tests `src/app/lib/google-calendar-config.test.ts`, `src/app/services/google-calendar-gateway.test.ts`.

**Interfaces — Produces:**

```ts
// google-calendar-config.ts
export type GoogleCalendarConfig = { calendarId: string; clientEmail: string; privateKey: string; webhookSecret: string };
export function googleCalendarConfig(env?: NodeJS.ProcessEnv): GoogleCalendarConfig | null;

// google-calendar-gateway.ts
export class GoogleCalendarError extends Error { constructor(readonly kind: 'disabled' | 'auth' | 'not_found' | 'gone' | 'conflict' | 'retryable' | 'refused' | 'invalid_response', readonly status?: number) }
export type GoogleEvent = {
  id: string; status?: 'confirmed' | 'tentative' | 'cancelled'; summary?: string; description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: 'opaque' | 'transparent'; colorId?: string;
  extendedProperties?: { private?: Record<string, string> };
};
export function createGoogleCalendarGateway(deps?: { loadConfig?: () => GoogleCalendarConfig | null; transport?: typeof fetch; now?: () => number }): {
  putEvent(event: GoogleEvent): Promise<GoogleEvent>;      // PUT /calendars/{id}/events/{eventId}
  insertEvent(event: GoogleEvent): Promise<GoogleEvent>;   // POST /calendars/{id}/events
  deleteEvent(eventId: string): Promise<void>;             // DELETE; 404/410 resolve
  listEvents(window: { timeMin: Date; timeMax: Date }): Promise<GoogleEvent[]>; // singleEvents=true, showDeleted=true, maxResults=2500, follows nextPageToken (max 10 pages)
  watch(channel: { id: string; token: string; address: string; expiration: Date }): Promise<{ resourceId: string; expiration: Date }>;
  stopChannel(channel: { id: string; resourceId: string }): Promise<void>;
};
```

- [ ] Step 1: failing tests.
  - config: all five vars → config; any blank → null; `GOOGLE_CALENDAR_SYNC_ENABLED` ≠ `"true"` → null; `VERCEL_ENV=preview` → null; `\n` in the key becomes a newline.
  - gateway (fake `transport` recording calls; a test RSA key from `crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })` exported as PKCS8 PEM): first call POSTs to the token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and an assertion whose decoded payload has `iss`=clientEmail, `scope`=calendar.events, `aud`=token endpoint, `exp - iat === 3600`; the access token is reused until 60 s before expiry; `putEvent` sends `Authorization: Bearer …` to `/calendars/{encodeURIComponent(id)}/events/{eventId}`; 404 → `not_found`, 409 → `conflict`, 410 → `gone`, 401/403 → `auth`, 429/5xx/timeout → `retryable`, other 4xx → `refused`; `deleteEvent` resolves on 404/410; `listEvents` follows two pages.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement. Config:

```ts
export function googleCalendarConfig(env: NodeJS.ProcessEnv = process.env): GoogleCalendarConfig | null {
  if (env.GOOGLE_CALENDAR_SYNC_ENABLED !== 'true' || env.VERCEL_ENV === 'preview') return null;
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim();
  const clientEmail = env.GOOGLE_CALENDAR_SA_EMAIL?.trim();
  const privateKey = env.GOOGLE_CALENDAR_SA_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const webhookSecret = env.GOOGLE_CALENDAR_WEBHOOK_SECRET?.trim();
  if (!calendarId || !clientEmail || !privateKey || !webhookSecret || privateKey === '[SENSITIVE]') return null;
  return { calendarId, clientEmail, privateKey, webhookSecret };
}
```

  Gateway: follow `square-gateway.ts:78-130` (`request()` with config read per call, typed errors, transport seam). Token:

```ts
import { importPKCS8, SignJWT } from 'jose';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
let cached: { key: string; token: string; expiresAt: number } | null = null; // module-level cache of a short-lived token is fine (no env read at module level)

async function accessToken(config: GoogleCalendarConfig, transport: typeof fetch, now: () => number) {
  const cacheKey = `${config.clientEmail}`;
  if (cached && cached.key === cacheKey && cached.expiresAt - 60_000 > now()) return cached.token;
  const key = await importPKCS8(config.privateKey, 'RS256');
  const iat = Math.floor(now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(config.clientEmail).setAudience(TOKEN_URL).setIssuedAt(iat).setExpirationTime(iat + 3600)
    .sign(key);
  const response = await transport(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
  }).catch(() => { throw new GoogleCalendarError('retryable'); });
  if (!response.ok) throw new GoogleCalendarError(response.status >= 500 || response.status === 429 ? 'retryable' : 'auth', response.status);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new GoogleCalendarError('invalid_response');
  cached = { key: cacheKey, token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}
```

  Export a `resetGoogleTokenCacheForTests()` for the tests.
- [ ] Step 4: run → PASS; commit `feat(gcal): configuration and REST gateway (service account JWT)`.

### Task 3 (G3): Pure event rendering and busy mapping

**Files:** create `src/app/services/google-calendar-event.ts`, `src/app/services/google-busy-mapping.ts`; tests alongside.

**Interfaces — Produces:**

```ts
// google-calendar-event.ts
export const GOOGLE_APPOINTMENT_PROPERTY = 'harbourAppointmentId';
export function googleEventIdFor(appointmentId: string): string;
export type RenderableAppointment = {
  id: string; date: Date; status: string; notes: string | null; durationMin: number;
  customer: { name: string | null; phone: string | null; erased: boolean };
  stylist: { id: string; name: string }; serviceName: string;
  deposit: { state: string; amountPence: number } | null;
};
export function renderGoogleEvent(appt: RenderableAppointment, ctx: { locale: Locale; adminDayUrl: string; colorId: string }): { event: GoogleEvent; hash: string };
export function stylistColorId(stylistIds: string[], stylistId: string): string; // sorted ids → '1'..'11' cycling
export function sameRenderedEvent(listed: GoogleEvent, expected: GoogleEvent): boolean; // compares summary, description, start/end instants, colorId, status (cancelled vs not)

// google-busy-mapping.ts
export type GoogleBusyBlock = { externalUid: string; stylistId: string; start: Date; end: Date };
export function googleBusyBlocks(events: GoogleEvent[], stylists: { id: string; name: string }[]): GoogleBusyBlock[];
export function googleBusyHash(blocks: GoogleBusyBlock[]): string;
```

- [ ] Step 1: failing tests:
  - id: 42 chars, starts `hh`, only `[0-9a-v]`, stable for the same id, differs for two ids.
  - render (en and zh-HK): title `Ivan · Chan Tai Man · Haircut`; PENDING → `[Request] ` / `[待確認] ` prefix; description lines include the phone, notes, status label, deposit state, the admin URL and the "changes made here are undone" sentence; erased customer renders the anonymised name and no phone; `start.dateTime`/`end.dateTime` ISO with `timeZone: 'Europe/London'`; `extendedProperties.private.harbourAppointmentId === id`; `transparency: 'opaque'`; hash stable across calls and changes when any field changes.
  - mapping: `Ivan: dentist` → Ivan only; `ivan - off`, `Ivan`, `IVAN·x`, `Ivan：午飯` → Ivan; `Ivana party` → all; `Lox Chan holiday` with stylists `Lox` and `Lox Chan` → `Lox Chan` (longest first); no title → all; `transparency: 'transparent'` → none; `status: 'cancelled'` → none; any event with the private property → none (echo guard); all-day `{ date: '2026-10-25' }` → 2026-10-25T00:00 London to 2026-10-26T00:00 London (a DST-change day: 25 hours); `externalUid` = sha256(eventId + '::' + stylistId); `googleBusyHash` independent of input order.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement. Use `fromZonedTime` (`date-fns-tz`, already used in `calendar-ical.ts`) for all-day bounds. Title prefix rule: `new RegExp('^' + escapeRegExp(name) + '(?=$|[\\s:：\\-·])', 'i')`, longest stylist name first. Messages for the event text live in a new `googleCalendar` section of `src/i18n/messages/{en,zh}/emails.ts` (salon-facing strings: `request`, `phone`, `notes`, `status.{PENDING,CONFIRMED,COMPLETED}`, `deposit`, `adminLink`, `editWarning`).
- [ ] Step 4: run → PASS; commit `feat(gcal): event rendering and Google busy-time mapping`.

### Task 4 (G4): Outbound push

**Files:** create `src/app/services/google-calendar-push.ts`; test alongside; add `GOOGLE_PUSH_FAILED`, `GOOGLE_PUSH_REFUSED` to `operations-messages.ts` (+ en/zh `adminOps.operations.messages`).

**Interfaces — Produces:** `pushGoogleCalendar(options?: { db?: PrismaClient; now?: Date; gateway?: GoogleGateway; mode?: 'recent' | 'all'; appointmentIds?: string[] }): Promise<{ written: number; deleted: number; unchanged: number; failed: number; skipped?: 'disabled' }>`.

Behaviour:
- `googleCalendarConfig()` null → `{ skipped: 'disabled', … }` before any DB read.
- Select appointments: `appointmentIds` if given; else `mode 'recent'`: `updatedAt >= now - 15 min` OR no `googleCalendarEvent` row OR row `lastError != null`, within the window; `mode 'all'`: every appointment in the window. Include user (name, phone, email), stylist (id, name), service (name, duration), paymentAttempt (deposit view), `googleCalendarEvent`.
- Locale: `SiteSettings.salonNotificationLocale` (live row). Service name in that locale via `loadPublishedTranslations(db, 'SERVICE', ids, locale)` (`services/content/translations.ts:13`), fallback English name. Admin day URL: `${SITE_URL}${localizeHref(locale, '/admin')}?date=YYYY-MM-DD&view=day`.
- CANCELLED → if a row exists and not `removed`: `deleteEvent`, set `removed=true, syncedHash=null`. Otherwise render; equal hash and `!removed` → unchanged; else `putEvent` → on `not_found` `insertEvent` → on `conflict` `putEvent` again; upsert the row `{ eventId, syncedHash, syncedAt: now, removed: false, attempts: 0, lastError: null }`.
- Failure: increment `attempts`, `lastError = OPERATIONS_MESSAGES.GOOGLE_PUSH_FAILED` (retryable/auth) or `GOOGLE_PUSH_REFUSED` (refused); never throw.
- `mode 'all'` also deletes events for appointments that ended more than 12 months ago and still have a non-removed row.
- Max 100 appointments per run; time budget 40 s (stop starting new writes after it).

- [ ] Step 1: failing tests (fake db via `loadServerModule`, fake gateway): disabled → no DB call; new CONFIRMED → put 404 → insert → row stored; unchanged hash → no call; cancelled → delete + removed; restored after delete → put with `status: 'confirmed'`; retryable error → attempts+1, lastError, other rows still processed; 12-month retention in `all` mode.
- [ ] Step 2–4: run FAIL → implement → PASS.
- [ ] Step 5: commit `feat(gcal): push website bookings to Google`.

### Task 5 (G5): Inbound pull

**Files:** create `src/app/services/google-calendar-pull.ts`; test alongside; `GOOGLE_PULL_FAILED` in operations messages (+ labels).

**Interfaces — Produces:** `pullGoogleCalendar(options?: { db?; now?; gateway? }): Promise<{ reverted: number; blocks: number; changed: boolean; skipped?: 'disabled' }>`.

Behaviour:
1. Config null → skipped before DB.
2. `listEvents({ timeMin: now - 1 day, timeMax: now + 90 days })`.
3. Website events (private property present): load those appointments (one query) with the push include; for each, if the appointment is open (PENDING/CONFIRMED/COMPLETED, in window) and `!sameRenderedEvent(listed, rendered)` (including a listed `status: 'cancelled'`) → `putEvent(rendered)` and update the row's hash; if the appointment is CANCELLED and the listed event is not cancelled → `deleteEvent`. Count `reverted`.
4. Foreign events → `googleBusyBlocks(events, activeStylists)`; `hash = googleBusyHash(blocks)`; if equal to `GoogleCalendarSyncState.busyHash` → no write; else one transaction: `externalBusyBlock.deleteMany({ where: { source: 'GOOGLE', end: { gt: now - 1 day }, start: { lt: now + 90 days } } })`, `createMany` (`source: 'GOOGLE', summary: null, lastSyncAt: now`), upsert state `{ busyHash: hash }`; after commit `invalidateStylistIcalFeedFromCron()`.
5. Upsert state `lastPullAt`, `lastPullSuccessAt`/`lastPullError` (`OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED`).

- [ ] Step 1: failing tests: website events never become blocks; moved website event → reverted once, and a second pull with the reverted listing → 0 writes; deleted (cancelled) website event of a CONFIRMED booking → put back; Google-only event "Ivan: dentist" → one Ivan block, unchanged second pull → no transaction; failure → lastPullError, no throw.
- [ ] Step 2–4: FAIL → implement → PASS. Commit `feat(gcal): pull Google-only events as busy time; revert edited website events`.

### Task 6 (G6): Busy time everywhere — feed export and admin label

**Files:** modify `src/app/services/stylist-ical-feed.ts` (`loadBusyEvents`), `src/app/lib/calendar-busy-display.ts` (`calendarBusyLabel` provider name), `src/i18n/messages/{en,zh}/adminSchedule.ts` if needed; tests `stylist-ical-feed.test.ts`, `calendar-busy-display.test.ts`.

- [ ] Step 1: failing tests: `loadBusyEvents` returns GOOGLE blocks for that stylist (`end > now`) as events with id `g-${externalUid}` and FRESHA blocks never; label for `source: 'GOOGLE'` is `Google`.
- [ ] Step 2–4: implement — in `loadBusyEvents`, a second query `externalBusyBlock.findMany({ where: { stylistId, source: 'GOOGLE', end: { gt: now } }, select: { externalUid: true, start: true, end: true } })` merged and sorted by start; minutes = `(end - start) / 60000`. Update the doc comments (sync service's "External busy times are never copied to outbound feeds" → "except Google-only time the salon added itself; Fresha never re-exports imported events").
- [ ] Step 5: commit `feat(gcal): Google-only busy time blocks Fresha too (busy feed) and shows as Google`.

### Task 7 (G7): Webhook and watch channel

**Files:** create `src/app/api/webhooks/google-calendar/route.ts`, `src/app/services/google-calendar-channel.ts`, `src/app/lib/google-channel-token.ts`; tests alongside (`route.test.ts` next to the route, like Square's).

**Interfaces — Produces:**
- `channelToken(secret: string, channelId: string): string` (HMAC-SHA256 hex) and `channelTokenMatches(secret, channelId, token): boolean` (timing-safe).
- `ensureGoogleWatchChannel(options?: { db?; now?; gateway?; renew?: boolean }): Promise<'created' | 'renewed' | 'current' | 'disabled'>` — creates when none/expired/expiring within 48 h (or `renew`), `expiration = now + 7 days` (Google may shorten it; store what it returns), stops the previous channel after the new one exists (errors ignored).
- `runPullSingleFlight(pull: () => Promise<unknown>): Promise<void>` — Upstash `SET google-calendar-pull NX EX 60`; if held, `SET google-calendar-pull-again 1 EX 120` and return; after a pull, if `-again` was set, delete it and pull once more. No Redis credentials → just pull.
- Route `POST`: `googleCalendarConfig()` null → 404; missing `X-Goog-Channel-ID`/`-Token` or mismatch → 401; `X-Goog-Resource-State: sync` → 200; else `after(() => runPullSingleFlight(() => pullGoogleCalendar()))` and 200. No DB import above the `after`.

- [ ] Step 1: failing tests: 404/401 paths make zero prisma imports/queries (stub `@/app/lib/prisma` with a counter as Square's route test does); `sync` → no `after`; `exists` → one `after` scheduled; channel: none → watch called with address `${SITE_URL}/api/webhooks/google-calendar` and token = HMAC; current (expires in 5 days) → `current`; expiring in 1 day → new then stop old; single-flight: two overlapping calls → one pull plus one trailing re-run.
- [ ] Step 2–4: FAIL → implement → PASS. Commit `feat(gcal): push webhook, watch channel and single-flight pull`.

### Task 8 (G8): Wiring into actions and crons

**Files:** modify `src/app/services/stylist-ical-cache.ts` (`invalidateStylistIcalFeed` also schedules `after(() => pushGoogleCalendar({ mode: 'recent' }))`, guarded by try/catch and a lazy import), add `scheduleGoogleCalendarPush(appointmentIds?: string[])` there; call it from `booking.ts` `requestReschedule` / `withdrawRescheduleRequest`, `admin.ts` reschedule DECLINE, and `admin-erasure.ts` after commit (with the customer's appointment ids, `mode: 'all'` semantics via `appointmentIds`); `src/app/api/cron/calendar-sync/route.ts` (after the late-arrival step: `pushGoogleCalendar({ mode: 'recent' })` then `runPullSingleFlight(pullGoogleCalendar)`, own job row `google-calendar`, never fails the sync); `src/app/api/cron/housekeeping/route.ts` (guarded block: `ensureGoogleWatchChannel({ renew: false })`, `pushGoogleCalendar({ mode: 'all' })`, `pullGoogleCalendar()`), tests for each route and for the cache helper (stub `next/server.after`).

- [ ] Steps: failing tests (route order and isolation: a Google failure never changes the sync/housekeeping status code; disabled config → zero Google calls and zero extra queries), implement, run, commit `feat(gcal): run push/pull from actions, calendar-sync and housekeeping`.

### Task 9 (G9): Admin → Integrations status and "Sync now"

**Files:** create `src/app/actions/admin-google-calendar.ts` (`syncGoogleCalendarNow()`: admin-only, audited `INTEGRATION.GOOGLE_CALENDAR_SYNC`, runs `ensureGoogleWatchChannel({ renew: false })`, `pushGoogleCalendar({ mode: 'all' })`, `pullGoogleCalendar()`, redirects back with `?gcal=done|error`), `src/components/admin/GoogleCalendarStatus.tsx`; modify `src/app/[locale]/admin/integrations/page.tsx`; messages `adminOps.integrations.google.*` en/zh; loader `getGoogleCalendarStatus()` in `services/google-calendar-status.ts` (enabled, calendarId masked to its first 6 chars + `…`, channel expiry, last pull/success/error, failed event count = rows with `lastError`).

- [ ] Steps: failing loader + action auth tests, implement, run, commit `feat(gcal): Integrations status and Sync now`.

### Task 10 (G10): Privacy, docs, verification, PR

- [ ] Privacy notice (`legal.ts` en/zh): extend `share.google` — "Google (Google Calendar): the salon's appointment diary holds your name, phone number, booking details and notes" — the transfers sentence, and `retention` — "Copies in the salon's Google Calendar: up to 12 months after the appointment". Update the page test that pins the notice.
- [ ] `docs/google-calendar-setup.md` runbook: GCP steps (enable Calendar API; service account; JSON key; never commit it), calendar creation + sharing ("Make changes to events"), the five env vars (Production only; `vercel env add NAME production`; the PEM with `\n` escapes), first "Sync now", verification (book a test appointment → appears; add "Ivan: test" in Google → Ivan's slot greys on /book within a minute; delete both), turning it off (`GOOGLE_CALENDAR_SYNC_ENABLED` unset → webhook 404s, Google stops retrying after failures; stop the channel via Sync now first if possible).
- [ ] CLAUDE.md: Calendars bullet + env vars list; `readme/structure.md`; `docs/data-erasure.md` (Google copy re-rendered).
- [ ] Full gate: `pnpm run lint && pnpm run test && pnpm run build` (with prod DB env exported as in the late-arrival plan), `pnpm exec tsc --noEmit`.
- [ ] Commit, push, PR (note: preview DB migration by hand after merge; env vars set only after merge).

## Self-review notes

- Spec §3 → G2; §4 → G1; §5 → G3, G4, G8; §6 → G3, G5, G6, G7; §7 → G7, G8, G9; §8 → G4, G5, G9 (job rows auto-surface as `JOB_FAILING` in the ops alert); §9 → G3 (erased), G4 (retention), G8 (erasure), G10 (notice); §10 → every task; §11 → G10 runbook.
- Names: `googleCalendarConfig`, `createGoogleCalendarGateway`, `GoogleCalendarError`, `GoogleEvent`, `googleEventIdFor`, `renderGoogleEvent`, `sameRenderedEvent`, `stylistColorId`, `googleBusyBlocks`, `googleBusyHash`, `pushGoogleCalendar`, `pullGoogleCalendar`, `ensureGoogleWatchChannel`, `runPullSingleFlight`, `channelToken`, `channelTokenMatches`, `scheduleGoogleCalendarPush`, `syncGoogleCalendarNow`, `getGoogleCalendarStatus`.
