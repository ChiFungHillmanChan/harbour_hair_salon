# Consultation-Gated Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict online booking so only haircuts (剪髮) and the TOKIO oil treatment (焗油) book directly; every other service routes the customer to a consultation slot.

**Architecture:** A per-service `requiresConsultation` flag gates the booking wizard. When a gated service is selected, a pure `resolveConsultationTarget` helper picks the target — colour services (`requiresPatchTest`) route to the existing £10 "Consultation & Patch Test", everything else to a new free £0 "Consultation" (`isConsultation`). The wizard swaps the selected service to the target, records the original in the appointment's `notes`, and proceeds normally. The server rejects direct bookings of gated services as defense in depth.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Prisma (triple schema: dev SQLite / vercel Postgres / prod MSSQL), Zod, Tailwind v4, `node:test` + `tsx` for tests.

## Global Constraints

- **Edit all three Prisma schema files** for any schema change: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`.
- **The app's generated Prisma client comes from the vercel schema** (`postinstall`/`db:vercel:generate`). After any schema change, run `pnpm db:vercel:generate` before type-checking.
- **Local `pnpm build` cannot reach the database** — do NOT use it as the verification gate. Verify with `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm test`.
- **Test files live under `src/` and are named `*.test.ts`** (the test script is `node --import tsx --test $(find src -name '*.test.ts')`).
- **Never access env vars at module level** — wrap in async functions.
- **Use Prisma generated types** from `@prisma/client`; never hand-write DB model interfaces.
- **Tailwind only** for styling. Primary brand colour `#174F7F`; the wizard uses the `accent` colour token.
- Brand: consultation targets are `isConsultation` (free £0) and `isPatchTest` (colour, £10). A gated service is `requiresConsultation: true`.

---

### Task 1: Add `requiresConsultation` / `isConsultation` to the Service model

**Files:**
- Modify: `prisma/dev/schema.prisma:56` (after `isPatchTest`)
- Modify: `prisma/vercel/schema.prisma:58` (after `isPatchTest`)
- Modify: `prisma/prod/schema.prisma:57` (after `isPatchTest`)
- Create: `prisma/vercel/migrations/20260704090000_add_consultation_flags/migration.sql`

**Interfaces:**
- Produces: two new boolean columns on `Service`: `requiresConsultation` (default false), `isConsultation` (default false). Available on `@prisma/client`'s `Service` type after regeneration.

- [ ] **Step 1: Add the two flags to all three schemas**

In **each** of the three schema files, the `Service` model has these consecutive lines:

```prisma
  requiresPatchTest  Boolean  @default(false)
  isPatchTest        Boolean  @default(false)
  imageUrl           String?
```

Change to (in all three files):

```prisma
  requiresPatchTest  Boolean  @default(false)
  isPatchTest        Boolean  @default(false)
  requiresConsultation Boolean @default(false)
  isConsultation     Boolean  @default(false)
  imageUrl           String?
```

- [ ] **Step 2: Create the Vercel/Postgres migration**

Create `prisma/vercel/migrations/20260704090000_add_consultation_flags/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Service" ADD COLUMN "requiresConsultation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "isConsultation" BOOLEAN NOT NULL DEFAULT false;
```

(The folder timestamp `20260704090000` sorts after the existing `20260703173000_init`, so `prisma migrate deploy` applies it in order. Do not touch `migration_lock.toml`.)

- [ ] **Step 3: Regenerate the Prisma client and sync local dev DB**

Run:
```bash
pnpm db:vercel:generate
pnpm db:dev:push
```
Expected: both complete without error; `db:vercel:generate` prints "Generated Prisma Client".

- [ ] **Step 4: Verify the types compile**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (the new fields exist on `Service`; no code uses them yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/dev/schema.prisma prisma/vercel/schema.prisma prisma/prod/schema.prisma prisma/vercel/migrations/20260704090000_add_consultation_flags/migration.sql
git commit -m "feat(booking): add requiresConsultation/isConsultation flags to Service"
```

---

### Task 2: `resolveConsultationTarget` pure helper (TDD)

**Files:**
- Create: `src/app/services/consultation-routing.ts`
- Test: `src/app/services/consultation-routing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // A minimal shape so the helper works with both full Service rows and the
  // wizard's ClientService (price as number). Only the flags matter here.
  export interface RoutableService {
    id: string;
    name: string;
    requiresConsultation: boolean;
    requiresPatchTest: boolean;
    isConsultation: boolean;
    isPatchTest: boolean;
    price: number;
  }
  export interface ConsultationTarget<T extends RoutableService> {
    target: T;   // the service the customer should actually book
    fee: number; // target.price, for the gate copy ("free" when 0)
  }
  // Returns null when the service books directly, OR when the required
  // target service is missing from `all` (caller shows a "contact us" fallback).
  export function resolveConsultationTarget<T extends RoutableService>(
    service: T,
    all: T[],
  ): ConsultationTarget<T> | null;
  ```
- Consumed by: Task 5 (wizard).

- [ ] **Step 1: Write the failing test**

Create `src/app/services/consultation-routing.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsultationTarget, type RoutableService } from './consultation-routing';

function svc(over: Partial<RoutableService>): RoutableService {
  return {
    id: 'x', name: 'X', requiresConsultation: false, requiresPatchTest: false,
    isConsultation: false, isPatchTest: false, price: 0, ...over,
  };
}

const freeConsult = svc({ id: 'c', name: 'Consultation', isConsultation: true, price: 0 });
const patchTest = svc({ id: 'p', name: 'Consultation & Patch Test', isPatchTest: true, price: 10 });
const all = [freeConsult, patchTest];

test('directly-bookable service → null', () => {
  const haircut = svc({ id: 'h', name: 'Haircut', requiresConsultation: false });
  assert.equal(resolveConsultationTarget(haircut, [...all, haircut]), null);
});

test('colour service (requiresPatchTest) → routes to the £10 patch test', () => {
  const colour = svc({ id: 'col', name: 'Full Head Colour', requiresConsultation: true, requiresPatchTest: true, price: 110 });
  const r = resolveConsultationTarget(colour, [...all, colour]);
  assert.equal(r?.target.id, 'p');
  assert.equal(r?.fee, 10);
});

test('non-colour gated service (perm) → routes to the free Consultation', () => {
  const perm = svc({ id: 'perm', name: 'Cold Perm', requiresConsultation: true, price: 143 });
  const r = resolveConsultationTarget(perm, [...all, perm]);
  assert.equal(r?.target.id, 'c');
  assert.equal(r?.fee, 0);
});

test('gated but free Consultation service missing → null (caller falls back)', () => {
  const perm = svc({ id: 'perm', name: 'Cold Perm', requiresConsultation: true, price: 143 });
  assert.equal(resolveConsultationTarget(perm, [patchTest, perm]), null);
});

test('gated colour but patch-test service missing → null', () => {
  const colour = svc({ id: 'col', name: 'Colour', requiresConsultation: true, requiresPatchTest: true });
  assert.equal(resolveConsultationTarget(colour, [freeConsult, colour]), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec node --import tsx --test src/app/services/consultation-routing.test.ts`
Expected: FAIL — cannot find module `./consultation-routing`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/app/services/consultation-routing.ts` (a pure, isomorphic module — **no** `server-only`, since the client wizard imports it):

```ts
/**
 * Decides where a consultation-gated service should route the customer.
 *
 * Only haircuts and the 焗油 (oil) treatment book directly; every other service
 * is `requiresConsultation`. Colour (which also needs an allergy patch test)
 * routes to the paid Consultation & Patch Test; everything else routes to the
 * free general Consultation.
 */
export interface RoutableService {
  id: string;
  name: string;
  requiresConsultation: boolean;
  requiresPatchTest: boolean;
  isConsultation: boolean;
  isPatchTest: boolean;
  price: number;
}

export interface ConsultationTarget<T extends RoutableService> {
  target: T;
  fee: number;
}

export function resolveConsultationTarget<T extends RoutableService>(
  service: T,
  all: T[],
): ConsultationTarget<T> | null {
  if (!service.requiresConsultation) return null;

  const target = service.requiresPatchTest
    ? all.find((s) => s.isPatchTest)
    : all.find((s) => s.isConsultation);

  if (!target) return null;
  return { target, fee: target.price };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec node --import tsx --test src/app/services/consultation-routing.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/services/consultation-routing.ts src/app/services/consultation-routing.test.ts
git commit -m "feat(booking): add resolveConsultationTarget routing helper with tests"
```

---

### Task 3: Seed defaults + free Consultation service + backfill script

**Files:**
- Modify: `prisma/seed.ts` (the `serviceList` array + add the Consultation row)
- Create: `prisma/backfill-consultation-flags.ts`
- Modify: `package.json` (add `db:backfill:consultation` script)

**Interfaces:**
- Produces: a seeded `Consultation` service (`isConsultation: true`, £0, 15 min) and `requiresConsultation: true` on all Colouring/Perms/Styling seed rows; a re-runnable backfill for the live DB.

- [ ] **Step 1: Flag gated categories in the seed's `serviceList`**

In `prisma/seed.ts`, add `requiresConsultation: true` to **every** service object in the `Colouring`, `Perms`, and `Styling` sections, **except** the `Consultation & Patch Test` row. Haircuts and Treatments (the TOKIO 焗油 rows) get **no** new flag (they stay directly bookable).

Example — the first Colouring row becomes:
```ts
    { name: 'Full Head Colour & Blow Dry - Short Hair (NHS)', price: 99.00, duration: 150, category: 'Colouring', requiresPatchTest: true, requiresConsultation: true, description: 'Full head colour application including blow dry for short hair (NHS rate).' },
```
Example — a Perms row becomes:
```ts
    { name: 'Cold Perm Half Head (NHS)', price: 129.00, duration: 150, category: 'Perms', requiresConsultation: true, description: 'Cold perm for half head (NHS rate).' },
```
Example — a Styling row becomes:
```ts
    { name: 'Shampoo & Dry & Set', price: 10.00, duration: 45, category: 'Styling', requiresConsultation: true, description: 'Shampoo, dry and set. From £10 depending on hair length.' },
```
Leave the existing `Consultation & Patch Test` row unchanged:
```ts
    { name: 'Consultation & Patch Test', price: 10.00, duration: 5, category: 'Colouring', isPatchTest: true, description: 'Required consultation and allergy patch test before any colour service (book at least 48h ahead).' },
```

- [ ] **Step 2: Add the free Consultation service row**

In `prisma/seed.ts`, add a new row to `serviceList` (put it just after the `Consultation & Patch Test` row, before the `// Perms` comment):
```ts
    // General consultation (free) — the target for perms/styling/other gated services
    { name: 'Consultation', price: 0.00, duration: 15, category: 'Consultation', isConsultation: true, description: 'Free consultation to discuss your service before booking.' },
```

- [ ] **Step 3: Create the backfill script for the live DB**

Create `prisma/backfill-consultation-flags.ts`:

```ts
/**
 * Non-destructive backfill for the consultation gate.
 *
 * `prisma migrate deploy` adds the `Service.requiresConsultation` / `isConsultation`
 * columns (defaulting to false) but does NOT touch existing rows or insert the new
 * free Consultation service. The full seed (`prisma/seed.ts`) is destructive
 * (deleteMany) and cannot run on a production DB with bookings, so use THIS script.
 *
 * Idempotent: safe to run multiple times. No rows are deleted.
 *
 * Run against the Vercel/Neon DB with the production connection string, e.g.:
 *   POSTGRES_URL=... pnpm db:backfill:consultation
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) Ensure the free general Consultation service exists.
  const existing = await prisma.service.findFirst({ where: { isConsultation: true } });
  if (!existing) {
    await prisma.service.create({
      data: {
        name: 'Consultation',
        price: 0,
        duration: 15,
        category: 'Consultation',
        isConsultation: true,
        description: 'Free consultation to discuss your service before booking.',
      },
    });
  }

  // 2) Gate every Colouring / Perms / Styling service. Exclude the consultation
  //    targets themselves (isPatchTest / isConsultation) so they stay bookable.
  const gated = await prisma.service.updateMany({
    where: {
      category: { in: ['Colouring', 'Perms', 'Styling'] },
      isPatchTest: false,
      isConsultation: false,
    },
    data: { requiresConsultation: true },
  });

  const total = await prisma.service.count({ where: { requiresConsultation: true } });
  console.log(
    `Backfill complete. Consultation service present: ${existing ? 'yes (existing)' : 'created'}; ` +
      `services gated this run: ${gated.count}. Now requiresConsultation=${total}.`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Add the package.json script**

In `package.json`, the `scripts` block ends with:
```json
    "db:backfill:patch-test": "tsx prisma/backfill-patch-test-flags.ts"
```
Change to:
```json
    "db:backfill:patch-test": "tsx prisma/backfill-patch-test-flags.ts",
    "db:backfill:consultation": "tsx prisma/backfill-consultation-flags.ts"
```

- [ ] **Step 5: Verify types + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors. (The destructive `prisma db seed` and the backfill are run manually at deploy time — not part of automated verification.)

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts prisma/backfill-consultation-flags.ts package.json
git commit -m "feat(booking): seed consultation gate defaults + free Consultation service + backfill"
```

---

### Task 4: Server-side enforcement + consultation intent note

**Files:**
- Modify: `src/app/services/booking-service.ts` (`createBooking` ~222-280, `createBookingForFirstAvailable` ~288-355)
- Modify: `src/app/actions/booking.ts` (`createBookingSchema` ~53-59, `submitBooking` ~177-290)

**Interfaces:**
- Consumes: `createBooking` / `createBookingForFirstAvailable` from Task-0 codebase.
- Produces: `submitBooking` accepts optional `consultationForServiceId`; `createBooking` and `createBookingForFirstAvailable` accept optional `notes`.

- [ ] **Step 1: Add `notes` to `createBooking`**

In `src/app/services/booking-service.ts`, `createBooking`'s data type and its `tx.appointment.create` call. Change the signature:
```ts
export async function createBooking(data: {
  stylistId: string;
  serviceId: string;
  date: Date;
  userId: string;
  discountCode?: string;
  notes?: string;
}) {
```
And in its `tx.appointment.create({ data: { ... } })`, add `notes`:
```ts
    return tx.appointment.create({
      data: {
        date: data.date,
        stylistId: data.stylistId,
        serviceId: data.serviceId,
        userId: data.userId,
        status: 'CONFIRMED',
        discountCodeId,
        notes: data.notes ?? null,
      },
```

- [ ] **Step 2: Add `notes` to `createBookingForFirstAvailable`**

Same file, change the signature:
```ts
export async function createBookingForFirstAvailable(data: {
  candidateStylistIds: string[];
  serviceId: string;
  date: Date;
  userId: string;
  discountCode?: string;
  notes?: string;
}) {
```
And add `notes: data.notes ?? null,` to its `tx.appointment.create({ data: { ... } })` (alongside `discountCodeId`).

- [ ] **Step 3: Extend the booking schema with `consultationForServiceId`**

In `src/app/actions/booking.ts`, update `CreateBookingInput` and `createBookingSchema`:
```ts
type CreateBookingInput = {
  stylistId: string;
  serviceId: string;
  date: Date | string;
  time: string;
  discountCode?: string;
  consultationForServiceId?: string;
};

const createBookingSchema = z.object({
  stylistId: z.string(),
  serviceId: z.string(),
  date: z.coerce.date(),
  time: z.string().regex(SALON_TIME_RE, 'Invalid time'), // strict HH:mm
  discountCode: z.string().optional(),
  consultationForServiceId: z.string().optional(),
}) satisfies z.ZodType<CreateBookingInput>;
```

- [ ] **Step 4: Enforce the gate + build the note in `submitBooking`**

In `src/app/actions/booking.ts`, the current block that loads the service for the patch-test check is:
```ts
  // Colour services require a completed Consultation & Patch Test first.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { requiresPatchTest: true },
  });
  if (service?.requiresPatchTest) {
```
Replace that `findUnique` select and add the consultation guard immediately before the existing patch-test check:
```ts
  // Load the flags we gate on. A gated service must never be booked directly —
  // the client routes to a consultation, but a crafted request must be rejected.
  const service = await prisma.service.findUnique({
    where: { id: validData.serviceId },
    select: { requiresPatchTest: true, requiresConsultation: true, isConsultation: true, isPatchTest: true },
  });
  if (service?.requiresConsultation) {
    return { success: false, error: 'This service is by consultation only. Please book a consultation to discuss it.' };
  }

  // If this booking IS a consultation target, record which service it's for.
  let notes: string | undefined;
  if ((service?.isConsultation || service?.isPatchTest) && validData.consultationForServiceId) {
    const origin = await prisma.service.findUnique({
      where: { id: validData.consultationForServiceId },
      select: { name: true },
    });
    if (origin) notes = `Consultation requested for: ${origin.name}`;
  }

  if (service?.requiresPatchTest) {
```
(The existing patch-test eligibility block below is unchanged.)

- [ ] **Step 5: Pass `notes` into both create calls**

In the same `try` block, add `notes` to both branches:
```ts
    const appointment = isAnyStylist
      ? await createBookingForFirstAvailable({
          candidateStylistIds,
          serviceId: validData.serviceId,
          date: fullDate,
          userId: session.userId,
          discountCode: validData.discountCode,
          notes,
        })
      : await createBooking({
          stylistId: validData.stylistId,
          serviceId: validData.serviceId,
          date: fullDate,
          userId: session.userId,
          discountCode: validData.discountCode,
          notes,
        });
```

- [ ] **Step 6: Verify types + lint + existing tests**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: no type/lint errors; all existing tests (incl. Task 2's) pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/services/booking-service.ts src/app/actions/booking.ts
git commit -m "feat(booking): reject direct booking of gated services + record consultation intent in notes"
```

---

### Task 5: Booking wizard — gate UI, badge, hidden targets, intent

**Files:**
- Modify: `src/components/booking/BookingWizard.tsx`

**Interfaces:**
- Consumes: `resolveConsultationTarget` from Task 2; `submitBooking`'s new `consultationForServiceId` from Task 4. `ClientService` gains `requiresConsultation`/`isConsultation`/`isPatchTest` automatically from the regenerated `Service` type.

- [ ] **Step 1: Import the routing helper and add consultation-origin state**

At the top of `src/components/booking/BookingWizard.tsx`, add the import:
```ts
import { resolveConsultationTarget } from '@/app/services/consultation-routing';
```
Inside the component, next to the other `useState` calls (after `bookingError`), add:
```ts
  // Set when the customer picked a consultation-gated service. Holds the ORIGINAL
  // service so we can label the consultation and record intent on submit.
  const [consultationOrigin, setConsultationOrigin] = useState<ClientService | null>(null);
  // The gate panel for the service the customer just clicked (before they confirm).
  const [pendingGate, setPendingGate] = useState<{ service: ClientService; fee: number; hasTarget: boolean } | null>(null);
```

- [ ] **Step 2: Route gated services and hide targets from the menu**

Replace the `filteredServices` definition:
```ts
  const filteredServices = services.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = service.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });
```
with (also hides consultation targets from the browseable menu):
```ts
  const filteredServices = services.filter(service => {
    if (service.isConsultation || service.isPatchTest) return false; // reached via routing, not browsed
    const matchesSearch = service.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = service.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Called when a service card is clicked. Gated services open the consultation
  // gate instead of proceeding straight to stylist selection.
  const handleSelectService = (service: ClientService) => {
    if (service.requiresConsultation) {
      const routed = resolveConsultationTarget(service, services);
      setPendingGate({ service, fee: routed?.fee ?? 0, hasTarget: routed !== null });
      return;
    }
    setConsultationOrigin(null);
    setSelectedService(service);
    setStep('STYLIST');
  };

  // Confirm the gate: swap to the consultation target and continue the flow.
  const confirmConsultation = () => {
    if (!pendingGate) return;
    const routed = resolveConsultationTarget(pendingGate.service, services);
    if (!routed) return;
    setConsultationOrigin(pendingGate.service);
    setSelectedService(routed.target);
    setPendingGate(null);
    setStep('STYLIST');
  };
```

- [ ] **Step 3: Use the handler + add the "Consultation required" badge on cards**

In the SERVICE step, change the card's `onClick`:
```tsx
                    onClick={() => { setSelectedService(service); setStep('STYLIST'); }}
```
to:
```tsx
                    onClick={() => handleSelectService(service)}
```
Then, inside the card's title block, right after the `<h3>` service name element, add the badge:
```tsx
                      {service.requiresConsultation && (
                        <span className="inline-block mt-1 text-[11px] uppercase tracking-wider font-semibold text-accent bg-accent/10 border border-accent/30 rounded px-2 py-0.5">
                          Consultation required
                        </span>
                      )}
```

- [ ] **Step 4: Render the consultation gate panel**

Immediately after the opening `{step === 'SERVICE' && (` block's `<div className="space-y-6">`, render the gate as an overlay when `pendingGate` is set. Add this as the first child inside that `<div className="space-y-6">`:
```tsx
          {pendingGate && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-6">
              <h3 className="font-serif text-lg text-zinc-900 mb-2">{pendingGate.service.name}</h3>
              {pendingGate.hasTarget ? (
                <>
                  <p className="text-sm text-zinc-700">
                    This service is by consultation. We&apos;ll book you a{' '}
                    {pendingGate.fee > 0 ? `£${pendingGate.fee.toFixed(2)}` : 'free'} consultation to discuss it,
                    then arrange the service with you.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={confirmConsultation}
                      className="bg-accent text-black px-6 py-2.5 rounded-lg uppercase text-sm font-bold tracking-wider hover:bg-accent-light transition-colors"
                    >
                      Book a Consultation
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingGate(null)}
                      className="text-sm font-medium text-zinc-600 hover:text-accent px-3"
                    >
                      Back
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-700">
                    This service is by consultation only. Please contact the salon to arrange it.
                  </p>
                  <button
                    type="button"
                    onClick={() => setPendingGate(null)}
                    className="mt-4 text-sm font-medium text-zinc-600 hover:text-accent"
                  >
                    Back to services
                  </button>
                </>
              )}
            </div>
          )}
```

- [ ] **Step 5: Show consultation intent on the confirm summary**

In the `step === 'CONFIRM'` Booking Summary grid, immediately after the Service `<div>` (the one showing `selectedService?.name`), add:
```tsx
              {consultationOrigin && (
                <div className="col-span-2">
                  <span className="text-zinc-500 uppercase text-xs tracking-wider font-semibold block mb-1">Consultation for</span>
                  <span className="text-zinc-900 font-medium text-base">{consultationOrigin.name}</span>
                </div>
              )}
```

- [ ] **Step 6: Send `consultationForServiceId` on submit**

In `handleSubmit`, update the `submitBooking` call:
```ts
    const result = await submitBooking({
      stylistId: selectedStylist.id,
      serviceId: selectedService.id,
      date: selectedDate,
      time: selectedTime,
      discountCode: appliedDiscount?.code,
      consultationForServiceId: consultationOrigin?.id,
    });
```

- [ ] **Step 7: Reset origin when going back to services**

In the STYLIST step's "Back to Services" button and the SERVICE-list rendering, ensure a fresh browse clears the origin. Update the STYLIST-step back button:
```tsx
          <button onClick={() => setStep('SERVICE')} className="text-sm font-medium text-zinc-600 hover:text-accent flex items-center gap-1">
```
to:
```tsx
          <button onClick={() => { setConsultationOrigin(null); setStep('SERVICE'); }} className="text-sm font-medium text-zinc-600 hover:text-accent flex items-center gap-1">
```

- [ ] **Step 8: Verify types + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/booking/BookingWizard.tsx
git commit -m "feat(booking): consultation gate in wizard (badge, gate panel, intent on confirm)"
```

---

### Task 6: Admin — expose the new flags

**Files:**
- Modify: `src/app/actions/admin-services.ts` (`createService` ~40-43, `updateService` ~70-73)
- Modify: `src/components/admin/ServiceForm.tsx` (`ServiceLite` type ~9-19, flags section ~154-174)
- Modify: `src/app/admin/services/[id]/edit/page.tsx` (`serviceLite` ~29-39)

**Interfaces:**
- Consumes: the schema flags from Task 1.
- Produces: admin create/edit persists `requiresConsultation` and `isConsultation`.

- [ ] **Step 1: Persist the flags in the server actions**

In `src/app/actions/admin-services.ts`, `createService` currently has:
```ts
  const requiresPatchTest = formData.get('requiresPatchTest') === 'on';
  const isPatchTest = formData.get('isPatchTest') === 'on';

  const created = await prisma.service.create({ data: { ...parsed.data, requiresPatchTest, isPatchTest } });
```
Change to:
```ts
  const requiresPatchTest = formData.get('requiresPatchTest') === 'on';
  const isPatchTest = formData.get('isPatchTest') === 'on';
  const requiresConsultation = formData.get('requiresConsultation') === 'on';
  const isConsultation = formData.get('isConsultation') === 'on';

  const created = await prisma.service.create({ data: { ...parsed.data, requiresPatchTest, isPatchTest, requiresConsultation, isConsultation } });
```
Make the identical change in `updateService` (its `requiresPatchTest`/`isPatchTest` lines and the `prisma.service.update({ ... data: { ...parsed.data, requiresPatchTest, isPatchTest } })` call → add `requiresConsultation, isConsultation`).

- [ ] **Step 2: Add the flags to the `ServiceLite` type and the form**

In `src/components/admin/ServiceForm.tsx`, extend `ServiceLite`:
```ts
  requiresPatchTest: boolean;
  isPatchTest: boolean;
  requiresConsultation: boolean;
  isConsultation: boolean;
};
```
Then in the flags `<section>`, after the existing `isPatchTest` checkbox `</label>` (before the section closes), add:
```tsx
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-600 pt-2">Consultation gate</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="requiresConsultation"
              defaultChecked={service?.requiresConsultation ?? false}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
            />
            <span className="text-sm text-zinc-700">Requires consultation before booking <span className="text-zinc-400">(customer is routed to a consultation instead of booking this directly)</span></span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="isConsultation"
              defaultChecked={service?.isConsultation ?? false}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
            />
            <span className="text-sm text-zinc-700">This IS the free general consultation service</span>
          </label>
```

- [ ] **Step 3: Pass the flags from the edit page**

In `src/app/admin/services/[id]/edit/page.tsx`, extend the `serviceLite` object:
```ts
    requiresPatchTest: service.requiresPatchTest,
    isPatchTest: service.isPatchTest,
    requiresConsultation: service.requiresConsultation,
    isConsultation: service.isConsultation,
  };
```

- [ ] **Step 4: Verify types + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/admin-services.ts src/components/admin/ServiceForm.tsx src/app/admin/services/[id]/edit/page.tsx
git commit -m "feat(admin): expose requiresConsultation/isConsultation on the service form"
```

---

### Task 7: Update the function/component registry

**Files:**
- Modify: `readme/structure.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Register the new module**

Open `readme/structure.md`, find the services/booking section, and add an entry for the new helper (match the surrounding format). Example line to add under the services listing:
```markdown
- `src/app/services/consultation-routing.ts` — `resolveConsultationTarget(service, all)`: decides whether a service books directly or routes to a consultation target (colour → £10 Consultation & Patch Test, others → free Consultation).
```
Also note the new `Service.requiresConsultation` / `isConsultation` flags and the `Consultation` service wherever service flags are documented.

- [ ] **Step 2: Commit**

```bash
git add readme/structure.md
git commit -m "docs: register consultation-routing helper and consultation gate flags"
```

---

## Final verification (run after all tasks)

- [ ] `pnpm db:vercel:generate` — client matches the schema.
- [ ] `pnpm exec tsc --noEmit` — no type errors.
- [ ] `pnpm lint` — clean.
- [ ] `pnpm test` — all tests pass (incl. `consultation-routing.test.ts`).
- [ ] Manual (dev server, needs local DB seeded): on `/book`, a Colouring service shows the "Consultation required" badge → clicking opens the gate → "Book a Consultation" routes to the £10 Consultation & Patch Test; a Perm routes to the free Consultation; a Haircut and the TOKIO treatment book directly. Confirm screen shows "Consultation for: <service>". Admin service edit shows and persists the new checkboxes.

## Deployment notes (manual, per project workflow)

- Squash-merge the PR → GitHub Actions → Vercel prod. `vercel-build` runs `prisma migrate deploy` (applies `20260704090000_add_consultation_flags`).
- After deploy, run the backfill once against prod: `POSTGRES_URL=... pnpm db:backfill:consultation` (creates the Consultation service + gates existing Colouring/Perms/Styling rows). The seed is NOT run on prod (destructive).
