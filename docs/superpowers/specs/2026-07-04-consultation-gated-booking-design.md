# Consultation-gated booking — design

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan

## Problem

The salon owner wants online booking restricted: **only haircuts (剪髮) and the oil/conditioning treatment (焗油) can be booked directly online.** Every other service — colouring, perms, other treatments, styling — must instead route the customer to book a **consultation**, so the stylist can discuss the work in person before committing.

This extends the existing colour patch-test gate (see `2026-06-14-trycolor-bleach-modes-and-colour-consultation-gate-design.md`) from colour-only to a general, admin-controlled consultation gate.

## Decisions (from brainstorming)

1. **Consultation = a booked appointment slot.** The customer books a consultation in the same wizard (not just a "call us" message), mirroring the existing patch-test flow.
2. **Service selection is a per-service admin toggle** (`requiresConsultation`), not a hardcoded category rule — the salon can flip individual services as the menu changes.
3. **焗油 = the "Dr.Jr. TOKIO Inkarami System Treatment"** — stays directly bookable.
4. **Two consultation targets, chosen by service type:**
   - Colour services (already `requiresPatchTest`) route to the existing **£10 "Consultation & Patch Test"** (includes the allergy patch test).
   - All other consultation-required services route to a **new free £0 "Consultation"** service.
5. **Record intent:** when a consultation is booked, store `"Consultation requested for: <original service name>"` in the appointment's `notes`, built server-side.
6. **Styling requires consultation too** (literal reading of "everything except 剪髮 and 焗油"); the admin toggle makes individual exceptions easy.

## Data model

Add two flags to the `Service` model in **all three** schema files (`prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`):

```prisma
requiresConsultation Boolean @default(false)  // customer must book a consultation instead of this service
isConsultation       Boolean @default(false)  // marks the general (free) Consultation service
```

Existing `requiresPatchTest` / `isPatchTest` are unchanged.

- **Vercel (Postgres):** add a migration under `prisma/vercel/migrations/` adding the two `BOOLEAN NOT NULL DEFAULT false` columns; regenerate the client.
- **Dev (SQLite):** applied via `pnpm db:dev:push`.
- **Prod (MS SQL):** schema edited to match (legacy, not actively deployed).

## Routing rule (pure, testable)

A pure helper resolves where a consultation-required service should route:

```ts
// resolveConsultationTarget(service, allServices) -> { target: Service, fee: number } | null
// - service.requiresConsultation === false            -> null (book directly)
// - service.requiresPatchTest === true                -> the isPatchTest service (£10)
// - otherwise                                         -> the isConsultation service (£0)
// - target service missing from allServices           -> null (caller falls back to a "contact salon" message)
```

This lives in a small module (e.g. `src/app/services/consultation-routing.ts`) and is unit-tested in the style of `patch-test-eligibility.test.ts`.

## Seed & backfill

### Seed defaults (`prisma/seed.ts`)

| Category | `requiresConsultation` | Routes to |
|---|---|---|
| Haircuts (剪髮) | off | — books directly |
| Treatments — TOKIO Inkarami (焗油) | off | — books directly |
| Colouring | on | £10 Consultation & Patch Test |
| Perms | on | free Consultation |
| Styling | on | free Consultation |

- New seed row: `Consultation` — price `0.00`, duration `15`, category `Consultation`, `isConsultation: true`, `requiresConsultation: false`.
- The £10 "Consultation & Patch Test" (`isPatchTest`) and the new £0 "Consultation" (`isConsultation`) are both `requiresConsultation: false` (they are the routing targets).

### Backfill for live data

A script mirroring `prisma/backfill-patch-test-flags.ts`:
1. Create the `Consultation` (£0) service if it does not already exist.
2. Set `requiresConsultation = true` for existing services where `category IN ('Colouring','Perms','Styling')` AND NOT `isPatchTest` AND NOT `isConsultation`. (Haircuts and Treatments/TOKIO stay `false`.)

## Booking wizard UX (`src/components/booking/BookingWizard.tsx`)

- **Menu display:**
  - Consultation-required services stay visible in their category with a small **"Consultation required"** badge on the card.
  - Consultation targets (`isConsultation` or `isPatchTest`) are **hidden** from the menu list (today the £10 patch test shows under Colouring — this removes it from the browseable menu).
- **Consultation gate:** clicking a `requiresConsultation` service shows an interstitial panel:
  > "This service is by consultation. We'll book you a [free / £10] consultation to discuss it."
  - **[Book Consultation]** → swaps the selected service to the resolved target, records the original service as the "consultation origin", and continues to the STYLIST → DATE → CONFIRM steps as normal.
  - **[Back]** → returns to the service list.
  - If the target service is missing (`resolveConsultationTarget` returns `null`), show a "please contact the salon" fallback instead of a broken flow.
- **Confirm step:** when a consultation origin is set, show a "Consultation for: <original service name>" line in the summary.

## Server enforcement + intent note

In `src/app/actions/booking.ts` (`submitBooking`) and `src/app/services/booking-service.ts`:

- **Reject direct bookings** of any service where `requiresConsultation === true` (defense in depth; the client routes away, but a crafted request must be blocked). Returns a customer-safe error.
- `submitBooking` gains an optional `consultationForServiceId`. When the booked service is a consultation target (`isConsultation` or `isPatchTest`) and this id is provided, the server looks up that service's name and sets `notes = "Consultation requested for: <name>"`. The note is composed server-side; the client only passes the id.
- `notes` is plumbed through `createBooking` and `createBookingForFirstAvailable` (added to their `data` objects and the `tx.appointment.create` call).

## Admin (`src/components/admin/ServiceForm.tsx`, `src/app/actions/admin-services.ts`)

- Add a **"Requires consultation before booking"** checkbox and an **"Is consultation service"** checkbox, wired identically to the existing `requiresPatchTest` / `isPatchTest` fields (read `formData.get(...) === 'on'`, spread into `create`/`update`).

## Testing & verification

- Unit tests for `resolveConsultationTarget`: colour → patch test; perm/styling → free consultation; directly-bookable → `null`; missing-target → `null`.
- Verify with `pnpm lint`, `tsc --noEmit` (via the test script), and `pnpm test`. Local `pnpm build` cannot reach the database, so it is not the verification gate (per project notes; the app's Prisma client comes from the vercel schema).

## Out of scope

- The existing colour patch-test **confirm-step** gate stays in place as defense in depth (largely superseded online, since colour now gates up-front). No refactor of that logic.
- No changes to pricing display, confirmation emails, the offers page, or the public services listing pages.

## Files touched (anticipated)

- `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`
- `prisma/vercel/migrations/<new>/migration.sql`
- `prisma/seed.ts`, new backfill script under `prisma/`
- `src/app/services/consultation-routing.ts` (+ test)
- `src/components/booking/BookingWizard.tsx`
- `src/app/actions/booking.ts`, `src/app/services/booking-service.ts`
- `src/components/admin/ServiceForm.tsx`, `src/app/actions/admin-services.ts`
- `readme/structure.md` (registry update per project convention)
