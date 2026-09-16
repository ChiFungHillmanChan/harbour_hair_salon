# Admin Calendar — Per-Stylist Colours, Per-Service Stripes, and Drag-to-Move/Resize

**Date:** 2026-09-16
**Status:** Approved by owner (approach + all five UX decisions confirmed in session)
**Branch:** `feat/admin-calendar-colours-and-drag` (off `main`)

## Problem

The admin Schedule board (`src/components/admin/ScheduleCalendar.tsx`, 377 lines) is
the salon's day-to-day operational screen — it sits open on a display all day and
re-pulls every 60 seconds. Three gaps make it hard to run a busy day from:

1. **Every appointment looks the same.** Blocks are `bg-zinc-800`, with `bg-amber-600`
   for PENDING. On a day with four stylists working, nothing distinguishes whose
   client is whose, or a 20-minute fringe trim from a 3-hour full colour. Staff have
   to read each row's text to understand the day.

2. **There is no per-stylist view.** The Day view is a flat chronological *list*
   (`DayView`), not a time grid. A stylist cannot see their own column, and the salon
   cannot see at a glance that Ivan is triple-booked at 2pm while Kiki is empty.

3. **Durations and times cannot be adjusted on the board.** `Appointment.durationAtBooking`
   is set once at booking time from `Service.duration` and never changes. When a colour
   over-runs, or a client wants to come in 30 minutes later, the only route is the
   customer-facing reschedule flow (`rescheduleAppointment` in `src/app/actions/booking.ts`),
   which is bound by the 24-hour policy and cannot change duration or stylist at all.
   In practice the board drifts out of step with the real day.

## Decisions (confirmed with owner)

- **No stylist logins.** Stylists do not get accounts or a portal. Admins set
  everything and save. "A stylist's own calendar" is delivered as their own column
  in the admin grid plus their own assigned colour — not as a new authenticated surface.
- **Colour means two things at once:** the block is **filled** with the stylist's
  colour and carries a **stripe** in the service's colour.
- **Drag scope is full:** both edges resize (top edge moves the start, bottom edge
  moves the end), and the body of a block can be dragged to a different time *or
  dropped on a different stylist's column*.
- **Clash policy is warn-and-confirm.** A drag that overlaps another booking, falls
  outside the stylist's working hours, or lands on an external busy block is not
  refused — the admin is told exactly what it clashes with and confirms or cancels.
  Salons deliberately overlap (a blow-dry during colour processing time), so a hard
  block would fight real workflow; accidents still get caught.
- **Notifications are automatic but narrow.** Moving the start time or switching
  stylist on a CONFIRMED booking sends the existing reschedule email. Changing only
  the length sends nothing — the customer's arrival time has not moved.
- **Colours come from fixed preset swatches**, not a free hex picker. The public site
  stays monochrome (black/white/grey) per the standing client requirement; these
  colours exist only inside `/admin`.

## Design

### 1. Data model

Two new nullable columns, added to **all three** schema files (`prisma/dev/schema.prisma`,
`prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`):

```prisma
model Stylist {
  // ...
  calendarColor String? // preset palette key, e.g. "indigo" — drives block fill
}

model Service {
  // ...
  calendarColor String? // preset palette key — drives the block stripe
}
```

Both store a **palette key**, never a hex value. Retuning a swatch later is then a
one-line code change rather than a data migration, and an invalid key degrades to
neutral instead of producing an unstyled block.

**No new duration column.** Resizing writes `Appointment.durationAtBooking`, which
already exists and is already the effective duration everywhere in the codebase —
every consumer reads `durationAtBooking ?? service.duration`:

| Consumer | File |
|---|---|
| Clash detection for all future bookings | `services/booking-service.ts:56,83,308,394` |
| Stylist outbound iCal busy feed | `services/stylist-ical-feed.ts:78` |
| Customer "My appointments" page | `app/appointments/page.tsx:47` |
| Notification email snapshots | `services/notification-outbox-service.ts:41` |

A resize therefore propagates to the customer's own view, the stylist's external
calendar, and future availability calculations with no extra wiring.

`priceAtBooking` is deliberately **left untouched** by a resize. Stretching a job by
an hour must not silently re-bill the customer; price is a booking-time snapshot and
stays one.

### 2. The palette — `src/app/lib/calendar-colors.ts`

A single static map, key → complete Tailwind class strings:

```ts
export const CALENDAR_COLORS = {
  slate:   { label: 'Slate',   fill: 'bg-slate-600',   text: 'text-white', stripe: 'bg-slate-300',   swatch: 'bg-slate-600' },
  red:     { label: 'Red',     fill: 'bg-red-600',     /* ... */ },
  amber:   { label: 'Amber',   fill: 'bg-amber-600',   /* ... */ },
  emerald: { /* ... */ }, teal: { /* ... */ }, sky: { /* ... */ },
  indigo:  { /* ... */ }, violet: { /* ... */ }, fuchsia: { /* ... */ }, rose: { /* ... */ },
} as const;

export type CalendarColorKey = keyof typeof CALENDAR_COLORS;
export const DEFAULT_CALENDAR_COLOR = { fill: 'bg-zinc-800', text: 'text-white', stripe: 'bg-zinc-400' };
export function resolveCalendarColor(key: string | null): { fill: string; text: string; stripe: string };
```

**The map must hold complete literal class strings.** Tailwind v4 scans source text
for class names; a constructed name like `` `bg-${key}-600` `` is invisible to the
scanner and would be dropped from the stylesheet, producing unstyled blocks in
production while looking fine in dev. `resolveCalendarColor(null)` returns the current
zinc treatment, so the board looks exactly as it does today until colours are assigned.

Ten swatches, all at the `-600` level so white text clears WCAG AA on every one, and
all distinguishable from each other. Stripes use the `-300` level of the service's
colour, which stays visible against any `-600` fill.

### 3. Assigning colours

A `CalendarColorPicker` component (a radio group of swatch buttons, keyboard-navigable)
added to two existing forms:

- `src/components/admin/StylistForm.tsx` → saved by `src/app/actions/admin-stylists.ts`
- `src/components/admin/ServiceForm.tsx` → saved by `src/app/actions/admin-services.ts`

Both actions validate the submitted key against `CALENDAR_COLORS` with Zod and store
`null` for "no colour". Nothing outside `/admin` ever selects `calendarColor` — the
public stylist and service pages keep their existing explicit `select` clauses, so the
monochrome public site is structurally unable to pick the field up.

### 4. The day grid — `src/components/admin/ScheduleDayGrid.tsx`

Replaces `DayView` inside `ScheduleCalendar`. Month and Year views are unchanged
except that their chips take the stylist's fill colour.

**Layout.** Columns are the stylists working that day (those with a non-`isOff`
`Availability` row for that weekday, plus any stylist who has an appointment that day
regardless). Rows run from the earliest open to the latest close across those
stylists, at 15-minute granularity. Appointments are absolutely positioned inside
their stylist's column: `top` from the start offset, `height` from the duration.

**Time frame.** All positioning uses salon-local minutes via `salonMinutesOfDay()`
from `src/app/services/salon-time.ts` — never the browser's local time. This is the
same convention the booking engine uses, and the reason is the wrong-day booking bug
already fixed once in this codebase: deriving a grid position from a browser-local
`Date` puts a staff member in Spain on a different row from the same appointment in
London. `salon-time.ts` and `scheduling.ts` are both pure and import no `server-only`,
so the client grid imports them directly rather than duplicating the logic.

**Block rendering.** Fill = stylist colour, a 4px inset left bar = service colour,
PENDING keeps a distinct dashed border so status still reads independently of hue.
`ExternalBusyBlock` rows (synced Fresha/Treatwell time) render as hatched,
non-interactive blocks so admins can see what they are dragging near.

**Interaction.** Three grab zones per block: top edge (resize start), bottom edge
(resize end), body (move). Pointer events throughout — `pointerdown` /
`pointermove` / `pointerup` with `setPointerCapture` — which gives one code path for
mouse, trackpad and iPad touch. Movement snaps to 15 minutes. While dragging, any
block the ghost would clash with is highlighted, so the outcome is visible before
release.

**Minimum duration** is 15 minutes; a resize cannot invert or zero a block.

**Responsive.** Below the `sm` breakpoint the grid falls back to the existing list
view. Dragging inside a four-column time grid on a 375px phone is not usable, and the
salon's own screen and iPad both sit above that breakpoint. This follows the
established pattern from the responsive retrofit rather than inventing a new one.

### 5. Geometry — `src/app/lib/calendar-geometry.ts` (pure)

All drag mathematics lives in a pure, DOM-free module so it can be unit-tested by the
existing `node:test` runner:

```ts
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;

export function minutesToOffset(minutes, originMinutes, pxPerMinute): number;
export function offsetToMinutes(px, originMinutes, pxPerMinute): number;
export function snapToStep(minutes, step = SNAP_MINUTES): number;
export function applyMove(block, deltaMinutes, bounds): { startMin, durationMin };
export function applyResizeTop(block, deltaMinutes, bounds): { startMin, durationMin };
export function applyResizeBottom(block, deltaMinutes, bounds): { startMin, durationMin };
```

Overlap testing reuses `overlaps()` / `hasConflict()` from
`src/app/services/scheduling.ts` rather than reimplementing them, so the preview the
admin sees while dragging and the check the server performs on release cannot drift
apart.

### 6. Clash description — `describeAdminMoveClashes`

The existing `assertAppointmentSlotAvailable` **throws** (`BookingError` for hours and
horizon problems, `SlotUnavailableError` for overlaps). A thrown error cannot tell the
admin *what* the clash is, and the agreed policy requires naming it ("This overlaps
Mei L. 10:30").

So a new sibling in `src/app/services/booking-service.ts` returns structured
information instead of throwing:

```ts
export type MoveClash =
  | { kind: 'OVERLAP'; appointmentId: string; customerName: string | null; start: Date; end: Date }
  | { kind: 'OUTSIDE_HOURS'; availability: { startTime: string; endTime: string } | null }
  | { kind: 'EXTERNAL_BUSY'; source: string; start: Date; end: Date }
  | { kind: 'PATCH_TEST'; reason: 'missing' | 'too_soon' | 'expired' };

export async function describeAdminMoveClashes(
  tx: Prisma.TransactionClient,
  input: { appointmentId: string; stylistId: string; start: Date; durationMin: number; userId: string; requiresPatchTest: boolean },
): Promise<MoveClash[]>;
```

It reuses the same primitives `assertAppointmentSlotAvailable` uses —
`fitsWithinAvailability` (`services/salon-time.ts`), `loadExternalBusy`
(`services/external-busy.ts`), `hasConflict` (`services/scheduling.ts`) and
`getValidPatchTest` (`services/booking-service.ts`) — and
excludes the appointment being moved from its own overlap scan, exactly as the
existing check does with `id: { not: appointment.id }`. `assertAppointmentSlotAvailable`
itself is left untouched; the customer booking path does not change.

A colour appointment moved outside its patch-test window is reported as a clash and
warned about, not blocked — consistent with the agreed warn-and-confirm policy, and
because the salon can see the client's real patch-test history in a way the rule cannot.

### 7. The server action — `src/app/actions/admin-schedule.ts`

A new file rather than growing `src/app/actions/admin.ts`, which is already 500+ lines.

```ts
export async function moveAppointmentByAdmin(input: {
  appointmentId: string;
  dateStr: string;        // 'YYYY-MM-DD', salon-local
  time: string;           // 'HH:mm', salon-local
  durationMin: number;
  stylistId: string;
  overrideClashes: boolean;
  expectedUpdatedAt: string; // optimistic-concurrency token
}): Promise<{ success: true } | { success: false; error: string } | { success: false; clashes: MoveClash[] }>;
```

**Input convention.** The action takes salon-local `dateStr` + `time` strings and
resolves them with `resolveSalonDateTime()`, following the string-date convention the
booking actions already use. It does not accept a client `Date`.

**Auth.** `verifySession()` plus an explicit `role === 'ADMIN'` check in the action
body. Middleware protects the `/admin` *page*, but a server action is independently
addressable and must not rely on it.

**Transaction.** The whole mutation runs inside `runSerializableWithRetry`, matching
the customer reschedule path, so an admin drag cannot race a customer booking the
same slot.

```
runSerializableWithRetry(async (tx) => {
  load appointment (+ user, stylist, service)
  clashes = await describeAdminMoveClashes(tx, ...)
  if (clashes.length && !overrideClashes) → return { clashes }   // nothing written
  changed = await tx.appointment.updateMany({
    where: { id, updatedAt: expectedUpdatedAt },                  // optimistic guard
    data  : { date, durationAtBooking, stylistId,
              reminderSent: date changed ? false : undefined,
              treatwellSyncStatus, treatwellSyncError: null,
              notificationVersion: { increment: 1 } },
  })
  if (changed.count !== 1) throw BookingError('This appointment has changed. Please refresh and try again.')
  if (startMoved || stylistChanged) and status === 'CONFIRMED':
      enqueueAppointmentNotification(tx, 'RESCHEDULE', reloaded, { oldDate })
})
then: dispatchAppointmentNotifications(id); revalidatePath('/admin' | '/appointments' | '/book')
```

The clash check runs inside the transaction on **both** paths. `overrideClashes`
changes only whether a clash aborts the write — never whether the write is
serializable. Removing the check on the override path would reintroduce the
double-booking race the Serializable isolation exists to prevent.

The optimistic `updatedAt` guard matters more here than anywhere else in the app: the
board auto-refreshes every 60 seconds, so an admin can easily drag a block that
another admin (or the customer) has already moved. The guard turns that into a clear
"refresh and try again" rather than a silent overwrite.

**Two gates are deliberately skipped on the admin path:**

- **The 24-hour policy** (`hoursUntil < 24`) — it exists to stop *customers*
  rearranging same-day work. Applying it to the salon's own board would make the
  feature useless for exactly the case it was asked for: an over-running appointment
  today.
- **`assertOnlineBookingReady(tx)`** — the calendar-freshness gate that closes
  *online* booking when an external feed goes stale. An admin standing in the salon
  must not be blocked from fixing today's schedule because a Fresha feed is late.

**Treatwell sync status** is recomputed via the existing `changedTreatwellSyncStatus`
helper on the same terms as the customer reschedule, so an externally-synced booking
is re-queued rather than left stale.

### 8. Notifications

`enqueueAppointmentNotification(tx, 'RESCHEDULE', appointment, { oldDate })` is called
inside the transaction, and `dispatchAppointmentNotifications(id)` after it commits —
the established outbox pattern. Two conditions gate it:

- Status is `CONFIRMED` (a PENDING request has not been promised to anyone yet).
- The **start instant or the stylist changed**. A duration-only resize enqueues nothing.

The outbox's own `isCurrent` check already refuses to send a `RESCHEDULE` whose
`notificationVersion` or `date` no longer matches the row, so a rapid sequence of
drags settles into at most one email for the final state.

## Testing

Run by the existing `pnpm test` (`node --conditions=react-server --import tsx --test`).

**`src/app/lib/calendar-geometry.test.ts`** — pure, no DOM:
- minutes↔pixels round-trip at several `pxPerMinute` values
- snapping rounds to the nearest 15 (including exact-boundary and negative deltas)
- `applyMove` clamps to the day bounds instead of running off the grid
- `applyResizeTop` / `applyResizeBottom` enforce `MIN_DURATION_MINUTES` and never invert
- resizing the top edge changes start *and* duration; the end instant stays fixed

**`src/app/lib/calendar-colors.test.ts`**:
- every palette entry exposes complete, literal (non-interpolated) class strings
- `resolveCalendarColor(null)` and `resolveCalendarColor('nonsense')` both fall back to zinc

**`src/app/actions/admin-schedule.test.ts`** — fake Prisma, modelled on the existing
`src/app/actions/booking-concurrency.test.ts`:
- a clash with `overrideClashes: false` returns the clashes and performs **no write**
- the same input with `overrideClashes: true` writes, and still runs the check inside the transaction
- a stale `expectedUpdatedAt` yields "refresh and try again" and no write
- duration-only change enqueues **no** notification
- start-time change on a CONFIRMED booking enqueues exactly one `RESCHEDULE`
- a start-time change on a PENDING booking enqueues none
- a non-admin session is rejected
- `priceAtBooking` is never written

**`src/app/services/admin-move-clashes.test.ts`** (new — `booking-service.ts` has no
test file of its own today; its behaviour is covered by `booking-persistence.test.ts`,
`booking-horizon.test.ts` and `actions/booking-concurrency.test.ts`):
- `describeAdminMoveClashes` excludes the appointment being moved from its own overlap scan
- it reports `OVERLAP`, `OUTSIDE_HOURS` and `EXTERNAL_BUSY` independently and can return several at once

## Non-goals

- No stylist logins, accounts, or portal.
- No per-date time off or holiday editor — weekly `Availability` is unchanged.
- No colour anywhere on the public site.
- No dragging in Month or Year views.
- No creating or deleting appointments by dragging on empty grid space.
- **No new cron and no new polling.** The Neon compute budget is untouched; the
  board's existing 60-second `router.refresh()` is unchanged, and this feature adds
  no scheduled work. (See the Neon compute budget rules in `CLAUDE.md`.)

## Migration and deployment

One migration adding two nullable columns — additive, no backfill, no downtime, and
safe to deploy before the UI ships.

```bash
pnpm db:dev:migrate      # dev SQLite
pnpm db:vercel:migrate   # generates the Postgres migration
```

**CI does not run migrations in this project.** `vercel-build` runs
`prisma migrate deploy` only when `VERCEL_ENV=production`, so the migration must be
applied against prod deliberately before the PR merges, in line with the process used
for the Stage 1 booking launch.

All three schema files must be edited together, per `CLAUDE.md`. The app's generated
Prisma client comes from the **vercel** schema (`postinstall`), so
`pnpm db:vercel:generate` is what makes the new fields visible to TypeScript locally.

## Risks and accepted risks

- **Deliberate double-booking is now possible.** That is the agreed policy, not an
  oversight — the warning names the clash and the admin confirms. The risk is an
  admin clicking through the confirm out of habit. Mitigated by naming the specific
  conflicting customer and time in the prompt rather than showing a generic warning.
- **Moving an appointment outside a stylist's hours is permitted on confirm.** The
  block will render outside the normal grid bounds; the grid extends its range to
  include any appointment that falls outside opening hours so it can never become
  invisible.
- **Colour carries meaning, so colour-blind staff need a fallback.** Every block keeps
  its text label (customer, service, time) and PENDING keeps a dashed border, so no
  information is conveyed by hue alone.
- **Touch drag on iPad is the main implementation risk.** Pointer events with
  `setPointerCapture` plus `touch-action: none` on the blocks is the intended
  approach; this needs real-device verification before merge, not just a desktop
  browser with touch emulation.
