# Site Links + Clock-In & Payroll (Phase 1 MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the salon's Treatwell/Instagram/Google Maps links across the site, and add an employee clock-in (shared kiosk PIN) + admin-approved timesheet + monthly gross-pay system.

**Architecture:** Pure, unit-tested calculation modules (hours, gross pay, kiosk state, CSV, social-link list) sit under `src/app/services/` and `src/app/lib/`; thin server actions wire Prisma data into them following the existing `requireAdmin()` + Zod + `revalidatePath()` pattern. Clock-in runs on a shared device gated by a separate `kiosk` JWT cookie; employees identify-then-PIN. New Prisma models (`Employee`, `TimeEntry`, `PayrollPeriod`, `PayrollLine`) are added to all three schemas.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, Prisma 5, PostgreSQL (Vercel)/SQLite (dev), Zod 4, jose (JWT), bcryptjs, date-fns-tz, Tailwind v4. Tests: `node:test` + `node:assert/strict` via `tsx`.

## Global Constraints

- **Edit all three Prisma schemas** identically: `prisma/dev/schema.prisma` (SQLite), `prisma/vercel/schema.prisma` (PostgreSQL), `prisma/prod/schema.prisma` (MSSQL). The app's Prisma **client is generated from the vercel schema** (`postinstall`).
- **Use portable Prisma types only** (`String`, `Int`, `Decimal`, `DateTime`, `Boolean`) and represent enums as `String` with a `//` comment listing allowed values — matching the existing `role`/`status`/`type` fields. No Prisma `enum` blocks (kept for SQLite/MSSQL parity).
- **Use Prisma generated types** from `@prisma/client`; never hand-write DB-model interfaces.
- **Money/rates are `Decimal`** in the DB; convert to `number` only inside calculation modules and round to 2 dp (pence) at the gross stage.
- **Never read env at module top level** except the existing Upstash/`SESSION_SECRET` patterns already in the codebase.
- **All admin server actions call `requireAdmin()`**; kiosk actions authenticate by PIN + kiosk cookie, never by admin role.
- **Timezone:** all month/day boundaries via `src/app/services/salon-time.ts` (`SALON_TIMEZONE = 'Europe/London'`).
- **Styling:** Tailwind only; brand `#174F7F` (`--brand`), accent `#C9A96E` (`--accent`); link hover pattern `hover:text-accent transition-colors`. No icon library — hand-coded inline SVG (mirror the existing Instagram icon in `src/components/layout/Layout.tsx`).
- **Verification:** local `pnpm build` fails on DB — do **not** use it to verify. Verify with `pnpm test`, `npx tsc --noEmit`, and `pnpm lint`. Regenerate types after schema edits with `pnpm db:vercel:generate`.
- **Commit after every task.** Branch: `feat/clock-in-payroll` (already created).
- **The three salon URLs:**
  - Treatwell: `https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/`
  - Instagram: `https://www.instagram.com/harbourhair_leeds/`
  - Google Maps: `https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111`

---

## File Structure

**Part A — links (no migration):**
- Create `src/components/layout/social-links-data.ts` — pure `getSocialLinks(settings)` builder.
- Create `src/components/layout/social-links-data.test.ts` — its tests.
- Create `src/components/layout/SocialLinks.tsx` — presentational icon row.
- Create `src/components/home/VisitFollowBlock.tsx` — home "Visit & follow us" section (async, fetches settings).
- Modify `src/components/layout/Layout.tsx` — footer renders `<SocialLinks>`.
- Modify `src/app/contact/page.tsx` — "Find & follow us" row.
- Modify `src/app/page.tsx` — insert `<VisitFollowBlock>` before footer.
- Modify `prisma/{dev,vercel,prod}/schema.prisma` + `src/app/services/site-settings-service.ts` — default the Treatwell/Google URLs.

**Part B — clock-in & payroll:**
- Modify `prisma/{dev,vercel,prod}/schema.prisma` — `Employee`, `TimeEntry`, `PayrollPeriod`, `PayrollLine` + `Stylist.employee` back-relation.
- Create `src/app/lib/pin.ts` (+ `.test.ts`) — PIN validate/hash/verify.
- Create `src/app/services/timesheet-calc.ts` (+ `.test.ts`) — worked hours, regular/overtime split.
- Create `src/app/services/payroll-calc.ts` (+ `.test.ts`) — gross-pay math.
- Create `src/app/services/kiosk-state.ts` (+ `.test.ts`) — clock toggle state machine.
- Create `src/app/services/payroll-csv.ts` (+ `.test.ts`) — CSV export.
- Create `src/app/services/payroll-service.ts` — Prisma glue (gather + compute + persist).
- Modify `src/app/lib/session.ts` — kiosk cookie helpers.
- Modify `middleware.ts` — gate `/kiosk`.
- Create `src/app/actions/employees.ts` — employee CRUD.
- Create `src/app/actions/kiosk.ts` — roster, clock toggle, enable/disable kiosk mode.
- Create `src/app/actions/timesheets.ts` — edit/approve entries.
- Create `src/app/actions/payroll.ts` — run/adjust/finalize.
- Create `src/app/admin/employees/page.tsx` + `src/components/admin/EmployeeForm.tsx`.
- Create `src/app/admin/timesheets/page.tsx`.
- Create `src/app/admin/payroll/page.tsx`.
- Create `src/app/kiosk/page.tsx` + `src/components/kiosk/KioskClock.tsx`.
- Modify `src/app/admin/layout.tsx` — nav links.
- Modify `readme/structure.md` — register new units.

---

## PART A — SOCIAL & REVIEW LINKS

### Task A1: Pure social-link list builder

**Files:**
- Create: `src/components/layout/social-links-data.ts`
- Test: `src/components/layout/social-links-data.test.ts`

**Interfaces:**
- Produces: `type SocialLink = { key: 'instagram' | 'treatwell' | 'google'; label: string; href: string }` and `getSocialLinks(settings: { instagramUrl: string; treatwellUrl: string; googleBusinessUrl: string }): SocialLink[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/layout/social-links-data.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSocialLinks } from './social-links-data';

test('returns only links whose URL is set, in IG/Treatwell/Google order', () => {
  const links = getSocialLinks({
    instagramUrl: 'https://instagram.com/x',
    treatwellUrl: 'https://treatwell.co.uk/x',
    googleBusinessUrl: 'https://maps.google.com/x',
  });
  assert.deepEqual(links.map((l) => l.key), ['instagram', 'treatwell', 'google']);
  assert.equal(links[0].href, 'https://instagram.com/x');
});

test('omits empty/whitespace URLs', () => {
  const links = getSocialLinks({ instagramUrl: '', treatwellUrl: '   ', googleBusinessUrl: 'https://maps.google.com/x' });
  assert.deepEqual(links.map((l) => l.key), ['google']);
});

test('every link has a non-empty human label', () => {
  const links = getSocialLinks({ instagramUrl: 'a', treatwellUrl: 'b', googleBusinessUrl: 'c' });
  for (const l of links) assert.ok(l.label.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/components/layout/social-links-data.test.ts`
Expected: FAIL — cannot find module `./social-links-data`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/layout/social-links-data.ts
export type SocialLink = {
  key: 'instagram' | 'treatwell' | 'google';
  label: string;
  href: string;
};

type SocialSettings = {
  instagramUrl: string;
  treatwellUrl: string;
  googleBusinessUrl: string;
};

export function getSocialLinks(settings: SocialSettings): SocialLink[] {
  const candidates: SocialLink[] = [
    { key: 'instagram', label: 'Instagram', href: settings.instagramUrl },
    { key: 'treatwell', label: 'Book on Treatwell', href: settings.treatwellUrl },
    { key: 'google', label: 'Find us on Google', href: settings.googleBusinessUrl },
  ];
  return candidates.filter((l) => l.href && l.href.trim().length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/components/layout/social-links-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/social-links-data.ts src/components/layout/social-links-data.test.ts
git commit -m "feat(links): pure social-link list builder from site settings"
```

---

### Task A2: SocialLinks presentational component

**Files:**
- Create: `src/components/layout/SocialLinks.tsx`

**Interfaces:**
- Consumes: `getSocialLinks` + `SocialLink` from Task A1.
- Produces: `export default function SocialLinks(props: { settings: { instagramUrl: string; treatwellUrl: string; googleBusinessUrl: string }; className?: string }): JSX.Element`

- [ ] **Step 1: Write the component** (no unit test — UI; verified by lint/tsc/manual)

```tsx
// src/components/layout/SocialLinks.tsx
import { getSocialLinks, type SocialLink } from './social-links-data';

function Icon({ k }: { k: SocialLink['key'] }) {
  const common = {
    width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (k === 'instagram') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" {...common}>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }
  if (k === 'google') {
    // map pin
    return (
      <svg xmlns="http://www.w3.org/2000/svg" {...common}>
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }
  // treatwell — calendar/booking glyph
  return (
    <svg xmlns="http://www.w3.org/2000/svg" {...common}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export default function SocialLinks({
  settings,
  className = '',
}: {
  settings: { instagramUrl: string; treatwellUrl: string; googleBusinessUrl: string };
  className?: string;
}) {
  const links = getSocialLinks(settings);
  if (links.length === 0) return null;
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.label}
          className="text-zinc-500 hover:text-accent transition-colors"
        >
          <Icon k={l.key} />
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify types & lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors for these files.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/SocialLinks.tsx
git commit -m "feat(links): SocialLinks icon-row component"
```

---

### Task A3: Render SocialLinks in the footer

**Files:**
- Modify: `src/components/layout/Layout.tsx` (the `Footer()` async component)

- [ ] **Step 1: Wire settings into the footer**

In `Layout.tsx`, the `Footer` is an `async` server component. Ensure it loads settings and renders `<SocialLinks>` in place of the existing single hardcoded Instagram `<a>`:

```tsx
// at top of file, add imports
import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';
```

Inside `async function Footer()`, near the top of the body:

```tsx
const settings = await getSiteSettings();
```

Replace the existing hardcoded Instagram `<a>...</a>` block (the one with `href="https://www.instagram.com/harbourhair_leeds/"`) with:

```tsx
<SocialLinks settings={settings} />
```

- [ ] **Step 2: Verify types, lint, and render**

Run: `npx tsc --noEmit && pnpm lint`
Then `pnpm dev`, open `http://localhost:3000`, scroll to the footer, confirm Instagram + Treatwell + Google icons appear and open the correct URLs in new tabs. (Treatwell/Google appear only after Task A6 sets their URLs, or set them now in `/admin/settings`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/Layout.tsx
git commit -m "feat(links): footer renders settings-driven social links"
```

---

### Task A4: Contact page "Find & follow us" row

**Files:**
- Modify: `src/app/contact/page.tsx`

- [ ] **Step 1: Add the row**

Import at top:

```tsx
import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';
```

The contact page is a server component. Load settings (`const settings = await getSiteSettings();`) and add a block below the existing contact details (keep the existing Google Maps iframe untouched):

```tsx
<section className="mt-10">
  <h2 className="font-serif text-2xl text-brand mb-4">Find &amp; follow us</h2>
  <SocialLinks settings={settings} className="mb-6" />
  <div className="flex flex-wrap gap-3">
    {settings.treatwellUrl && (
      <a
        href={settings.treatwellUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="border border-accent text-brand px-6 py-3 uppercase tracking-[0.2em] text-sm font-bold hover:bg-accent hover:text-black transition-colors"
      >
        Book on Treatwell
      </a>
    )}
    {settings.googleBusinessUrl && (
      <a
        href={settings.googleBusinessUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand underline hover:text-accent transition-colors self-center"
      >
        Get directions &amp; read our Google reviews
      </a>
    )}
  </div>
</section>
```

Keep the salon's own "Book appointment" CTA as the primary (existing) button; Treatwell here is the secondary outline button.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && pnpm lint`; check `/contact` in `pnpm dev`.

- [ ] **Step 3: Commit**

```bash
git add src/app/contact/page.tsx
git commit -m "feat(links): contact page find & follow us row"
```

---

### Task A5: Home "Visit & follow us" block

**Files:**
- Create: `src/components/home/VisitFollowBlock.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create the block**

```tsx
// src/components/home/VisitFollowBlock.tsx
import SocialLinks from '@/components/layout/SocialLinks';
import { getSiteSettings } from '@/app/services/site-settings-service';

export default async function VisitFollowBlock() {
  const settings = await getSiteSettings();
  return (
    <section className="bg-zinc-50 py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="font-serif text-3xl text-brand mb-3">Visit &amp; follow us</h2>
        <p className="text-zinc-600 mb-6">
          Find us in central Leeds, book through Treatwell, or follow along on Instagram.
        </p>
        <div className="flex justify-center mb-6">
          <SocialLinks settings={settings} />
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          {settings.treatwellUrl && (
            <a
              href={settings.treatwellUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-accent text-brand px-6 py-3 uppercase tracking-[0.2em] text-sm font-bold hover:bg-accent hover:text-black transition-colors"
            >
              Book on Treatwell
            </a>
          )}
          {settings.googleBusinessUrl && (
            <a
              href={settings.googleBusinessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline hover:text-accent transition-colors self-center"
            >
              Directions &amp; Google reviews
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Insert into the home page**

In `src/app/page.tsx`, import and render `<VisitFollowBlock />` after `<Faq />` (i.e., last section before the footer):

```tsx
import VisitFollowBlock from '@/components/home/VisitFollowBlock';
// ...inside the returned JSX, after <Faq />:
<VisitFollowBlock />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && pnpm lint`; check home page renders the block.

- [ ] **Step 4: Commit**

```bash
git add src/components/home/VisitFollowBlock.tsx src/app/page.tsx
git commit -m "feat(links): home visit & follow us block"
```

---

### Task A6: Default the Treatwell & Google Maps URLs

**Files:**
- Modify: `src/app/services/site-settings-service.ts` (the `DEFAULTS` const)
- Modify: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma` (`SiteSettings` defaults)

Rationale: `instagramUrl` already defaults to the salon's IG (same convention). Add the same for Treatwell and Google so fresh installs render all three; existing rows are updated via `/admin/settings` (or a one-line Studio edit).

- [ ] **Step 1: Update the service defaults**

In `site-settings-service.ts`, set in `DEFAULTS`:

```ts
  googleBusinessUrl: 'https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111',
  treatwellUrl: 'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/',
```

- [ ] **Step 2: Update all three schemas**

In each `schema.prisma`, set the `SiteSettings` field defaults:

```prisma
  googleBusinessUrl   String   @default("https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111")
  treatwellUrl        String   @default("https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/")
```

- [ ] **Step 3: Regenerate client & sync dev DB**

Run: `pnpm db:vercel:generate && pnpm db:dev:push`
Expected: client regenerates, dev SQLite updated, no errors.

- [ ] **Step 4: Populate the existing singleton row** (so the live/dev row, which already exists, picks up the URLs)

Either: open `/admin/settings`, paste the three URLs into Treatwell / Google Business Profile / Instagram, save. Or run in `pnpm db:dev:studio` to set the singleton. Confirm footer/contact/home now show all three icons.

- [ ] **Step 5: Verify & commit**

Run: `npx tsc --noEmit && pnpm lint && pnpm test`
```bash
git add src/app/services/site-settings-service.ts prisma/dev/schema.prisma prisma/vercel/schema.prisma prisma/prod/schema.prisma
git commit -m "feat(links): default Treatwell & Google Maps URLs in site settings"
```

---

## PART B — CLOCK-IN & PAYROLL (PHASE 1 MVP)

### Task B1: Add Prisma models (Employee, TimeEntry, PayrollPeriod, PayrollLine)

**Files:**
- Modify: `prisma/dev/schema.prisma`, `prisma/vercel/schema.prisma`, `prisma/prod/schema.prisma`

**Interfaces:**
- Produces: Prisma models `Employee`, `TimeEntry`, `PayrollPeriod`, `PayrollLine` and the `@prisma/client` types `Employee`, `TimeEntry`, `PayrollPeriod`, `PayrollLine`.

- [ ] **Step 1: Append these models to all three schema files (identical text)**

```prisma
model Employee {
  id                     String   @id @default(cuid())
  name                   String
  title                  String   // e.g. "Senior Stylist", "Receptionist"
  pinHash                String
  payType                String   @default("HOURLY") // HOURLY, SALARY, COMMISSION, HYBRID
  hourlyRate             Decimal?
  monthlySalary          Decimal?
  commissionRate         Decimal? // fraction, e.g. 0.40 = 40%
  overtimeEnabled        Boolean  @default(false)
  overtimeThresholdHours Decimal? // hours per pay period before overtime
  overtimeMultiplier     Decimal? // e.g. 1.5
  unpaidBreakMinutes     Int?     // fixed auto-deduct (Phase 3); unused in Phase 1
  isActive               Boolean  @default(true)
  hireDate               DateTime @default(now())
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  stylistId String?  @unique
  stylist   Stylist? @relation(fields: [stylistId], references: [id], onDelete: SetNull)

  timeEntries  TimeEntry[]
  payrollLines PayrollLine[]

  @@index([isActive])
}

model TimeEntry {
  id              String    @id @default(cuid())
  employeeId      String
  employee        Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  clockIn         DateTime
  clockOut        DateTime?
  breakMinutes    Int       @default(0)
  source          String    @default("KIOSK") // KIOSK, ADMIN
  status          String    @default("PENDING") // OPEN, PENDING, APPROVED, EDITED
  note            String?
  editedByAdminId String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([employeeId, clockIn])
  @@index([status, clockIn])
}

model PayrollPeriod {
  id                 String   @id @default(cuid())
  year               Int
  month              Int      // 1-12
  status             String   @default("DRAFT") // DRAFT, FINALIZED
  finalizedByAdminId String?
  finalizedAt        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  lines PayrollLine[]

  @@unique([year, month])
}

model PayrollLine {
  id                   String        @id @default(cuid())
  periodId             String
  period               PayrollPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  employeeId           String
  employee             Employee      @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  totalHours           Decimal       @default(0)
  regularHours         Decimal       @default(0)
  overtimeHours        Decimal       @default(0)
  basePay              Decimal       @default(0)
  overtimePay          Decimal       @default(0)
  commissionableRevenue Decimal      @default(0)
  commissionPay        Decimal       @default(0)
  adjustments          Decimal       @default(0)
  adjustmentNote       String?
  grossPay             Decimal       @default(0)
  snapshotJson         String        @default("")
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt

  @@unique([periodId, employeeId])
}
```

- [ ] **Step 2: Add the back-relation on `Stylist` in all three schemas**

Inside `model Stylist { ... }`, add:

```prisma
  employee        Employee?
```

- [ ] **Step 3: Regenerate client & sync dev DB**

Run: `pnpm db:vercel:generate && pnpm db:dev:push`
Expected: "Your database is now in sync" / client generated, no errors.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors (new models available on `@prisma/client`).

- [ ] **Step 5: Commit**

```bash
git add prisma/dev/schema.prisma prisma/vercel/schema.prisma prisma/prod/schema.prisma
git commit -m "feat(payroll): add Employee, TimeEntry, PayrollPeriod, PayrollLine models"
```

---

### Task B2: PIN validate/hash/verify helper

**Files:**
- Create: `src/app/lib/pin.ts`
- Test: `src/app/lib/pin.test.ts`

**Interfaces:**
- Produces: `isValidPin(pin: string): boolean`, `hashPin(pin: string): Promise<string>`, `verifyPin(pin: string, hash: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/lib/pin.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPin, hashPin, verifyPin } from './pin';

test('isValidPin accepts 4-6 digit PINs', () => {
  for (const ok of ['0000', '12345', '987654']) assert.equal(isValidPin(ok), true);
});

test('isValidPin rejects non-digit, too-short, too-long', () => {
  for (const bad of ['', '123', '1234567', '12a4', '12 4', ' 1234']) assert.equal(isValidPin(bad), false);
});

test('hashPin/verifyPin round-trips and rejects wrong PIN', async () => {
  const hash = await hashPin('4821');
  assert.notEqual(hash, '4821');
  assert.equal(await verifyPin('4821', hash), true);
  assert.equal(await verifyPin('0000', hash), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/app/lib/pin.test.ts`
Expected: FAIL — cannot find module `./pin`.

- [ ] **Step 3: Implement**

```ts
// src/app/lib/pin.ts
import bcrypt from 'bcryptjs';

const PIN_RE = /^\d{4,6}$/;

export function isValidPin(pin: string): boolean {
  return PIN_RE.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/app/lib/pin.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/pin.ts src/app/lib/pin.test.ts
git commit -m "feat(payroll): PIN validate/hash/verify helper"
```

---

### Task B3: Timesheet hours calculation (pure)

**Files:**
- Create: `src/app/services/timesheet-calc.ts`
- Test: `src/app/services/timesheet-calc.test.ts`

**Interfaces:**
- Produces:
  - `type ClosedSegment = { clockIn: Date; clockOut: Date; breakMinutes: number }`
  - `segmentWorkedMinutes(seg: ClosedSegment): number`
  - `totalWorkedHours(segs: ClosedSegment[]): number`
  - `splitRegularOvertime(totalHours: number, opts: { enabled: boolean; thresholdHours: number }): { regularHours: number; overtimeHours: number }`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/services/timesheet-calc.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { segmentWorkedMinutes, totalWorkedHours, splitRegularOvertime } from './timesheet-calc';

const seg = (inH: number, outH: number, brk = 0) => ({
  clockIn: new Date(`2026-06-01T${String(inH).padStart(2, '0')}:00:00Z`),
  clockOut: new Date(`2026-06-01T${String(outH).padStart(2, '0')}:00:00Z`),
  breakMinutes: brk,
});

test('segmentWorkedMinutes subtracts break minutes', () => {
  assert.equal(segmentWorkedMinutes(seg(9, 17, 30)), 8 * 60 - 30); // 450
});

test('segmentWorkedMinutes never returns negative', () => {
  assert.equal(segmentWorkedMinutes(seg(9, 9, 30)), 0);
});

test('totalWorkedHours sums segments in hours', () => {
  assert.equal(totalWorkedHours([seg(9, 13), seg(14, 18)]), 8); // 4 + 4
});

test('splitRegularOvertime returns all-regular when disabled', () => {
  assert.deepEqual(splitRegularOvertime(50, { enabled: false, thresholdHours: 40 }), {
    regularHours: 50,
    overtimeHours: 0,
  });
});

test('splitRegularOvertime splits at threshold when enabled', () => {
  assert.deepEqual(splitRegularOvertime(50, { enabled: true, thresholdHours: 40 }), {
    regularHours: 40,
    overtimeHours: 10,
  });
});

test('splitRegularOvertime — under threshold yields no overtime', () => {
  assert.deepEqual(splitRegularOvertime(30, { enabled: true, thresholdHours: 40 }), {
    regularHours: 30,
    overtimeHours: 0,
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/app/services/timesheet-calc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/services/timesheet-calc.ts
export type ClosedSegment = { clockIn: Date; clockOut: Date; breakMinutes: number };

export function segmentWorkedMinutes(seg: ClosedSegment): number {
  const gross = (seg.clockOut.getTime() - seg.clockIn.getTime()) / 60000;
  return Math.max(0, gross - seg.breakMinutes);
}

export function totalWorkedHours(segs: ClosedSegment[]): number {
  const minutes = segs.reduce((sum, s) => sum + segmentWorkedMinutes(s), 0);
  return minutes / 60;
}

export function splitRegularOvertime(
  totalHours: number,
  opts: { enabled: boolean; thresholdHours: number },
): { regularHours: number; overtimeHours: number } {
  if (!opts.enabled || totalHours <= opts.thresholdHours) {
    return { regularHours: totalHours, overtimeHours: 0 };
  }
  return { regularHours: opts.thresholdHours, overtimeHours: totalHours - opts.thresholdHours };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/app/services/timesheet-calc.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/timesheet-calc.ts src/app/services/timesheet-calc.test.ts
git commit -m "feat(payroll): pure timesheet hours + overtime split"
```

---

### Task B4: Gross-pay calculation (pure)

**Files:**
- Create: `src/app/services/payroll-calc.ts`
- Test: `src/app/services/payroll-calc.test.ts`

**Interfaces:**
- Produces:
  - `type PayType = 'HOURLY' | 'SALARY' | 'COMMISSION' | 'HYBRID'`
  - `round2(n: number): number`
  - `computeGross(input: GrossInput): GrossResult` where
    `GrossInput = { payType: PayType; hourlyRate: number | null; monthlySalary: number | null; commissionRate: number | null; regularHours: number; overtimeHours: number; overtimeMultiplier: number | null; commissionableRevenue: number; adjustments: number }`
    `GrossResult = { basePay: number; overtimePay: number; commissionPay: number; grossPay: number }`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/services/payroll-calc.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGross, round2 } from './payroll-calc';

const base = {
  hourlyRate: null as number | null,
  monthlySalary: null as number | null,
  commissionRate: null as number | null,
  regularHours: 0,
  overtimeHours: 0,
  overtimeMultiplier: 1.5,
  commissionableRevenue: 0,
  adjustments: 0,
};

test('round2 rounds to pence', () => {
  assert.equal(round2(10.005), 10.01);
  assert.equal(round2(8.333333), 8.33);
});

test('HOURLY: regular + overtime', () => {
  const r = computeGross({ ...base, payType: 'HOURLY', hourlyRate: 12, regularHours: 40, overtimeHours: 5 });
  assert.equal(r.basePay, 480); // 40*12
  assert.equal(r.overtimePay, 90); // 5*12*1.5
  assert.equal(r.commissionPay, 0);
  assert.equal(r.grossPay, 570);
});

test('SALARY: fixed amount, no overtime, plus commission', () => {
  const r = computeGross({ ...base, payType: 'SALARY', monthlySalary: 2000, commissionRate: 0.1, commissionableRevenue: 500, regularHours: 200, overtimeHours: 5 });
  assert.equal(r.basePay, 2000);
  assert.equal(r.overtimePay, 0);
  assert.equal(r.commissionPay, 50); // 500*0.1
  assert.equal(r.grossPay, 2050);
});

test('COMMISSION: only commission', () => {
  const r = computeGross({ ...base, payType: 'COMMISSION', commissionRate: 0.4, commissionableRevenue: 1000, regularHours: 100 });
  assert.equal(r.basePay, 0);
  assert.equal(r.commissionPay, 400);
  assert.equal(r.grossPay, 400);
});

test('HYBRID with hourly base = hourly + commission', () => {
  const r = computeGross({ ...base, payType: 'HYBRID', hourlyRate: 10, regularHours: 30, commissionRate: 0.2, commissionableRevenue: 600 });
  assert.equal(r.basePay, 300);
  assert.equal(r.commissionPay, 120);
  assert.equal(r.grossPay, 420);
});

test('HYBRID with salary base when no hourly rate', () => {
  const r = computeGross({ ...base, payType: 'HYBRID', monthlySalary: 1500, commissionRate: 0.2, commissionableRevenue: 600 });
  assert.equal(r.basePay, 1500);
  assert.equal(r.commissionPay, 120);
  assert.equal(r.grossPay, 1620);
});

test('adjustments add (or subtract) from gross', () => {
  const r = computeGross({ ...base, payType: 'HOURLY', hourlyRate: 10, regularHours: 10, adjustments: -15 });
  assert.equal(r.grossPay, 85); // 100 - 15
});

test('null rates treated as zero', () => {
  const r = computeGross({ ...base, payType: 'HOURLY', regularHours: 10 });
  assert.equal(r.grossPay, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/app/services/payroll-calc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/services/payroll-calc.ts
export type PayType = 'HOURLY' | 'SALARY' | 'COMMISSION' | 'HYBRID';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type GrossInput = {
  payType: PayType;
  hourlyRate: number | null;
  monthlySalary: number | null;
  commissionRate: number | null;
  regularHours: number;
  overtimeHours: number;
  overtimeMultiplier: number | null;
  commissionableRevenue: number;
  adjustments: number;
};

type GrossResult = { basePay: number; overtimePay: number; commissionPay: number; grossPay: number };

export function computeGross(input: GrossInput): GrossResult {
  const rate = input.hourlyRate ?? 0;
  const salary = input.monthlySalary ?? 0;
  const commRate = input.commissionRate ?? 0;
  const otMult = input.overtimeMultiplier ?? 1.5;

  const hourlyBase = input.regularHours * rate;
  const overtimePayHourly = input.overtimeHours * rate * otMult;
  const commissionPay = input.commissionableRevenue * commRate;

  let basePay = 0;
  let overtimePay = 0;

  switch (input.payType) {
    case 'HOURLY':
      basePay = hourlyBase;
      overtimePay = overtimePayHourly;
      break;
    case 'SALARY':
      basePay = salary; // full fixed monthly amount, no overtime
      break;
    case 'COMMISSION':
      basePay = 0;
      break;
    case 'HYBRID':
      // Hourly base if an hourly rate is set, otherwise salary base.
      basePay = input.hourlyRate != null ? hourlyBase : salary;
      overtimePay = input.hourlyRate != null ? overtimePayHourly : 0;
      break;
  }

  const grossPay = basePay + overtimePay + commissionPay + input.adjustments;
  return {
    basePay: round2(basePay),
    overtimePay: round2(overtimePay),
    commissionPay: round2(commissionPay),
    grossPay: round2(grossPay),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/app/services/payroll-calc.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/payroll-calc.ts src/app/services/payroll-calc.test.ts
git commit -m "feat(payroll): pure gross-pay calculation across all pay types"
```

---

### Task B5: Kiosk clock state machine (pure)

**Files:**
- Create: `src/app/services/kiosk-state.ts`
- Test: `src/app/services/kiosk-state.test.ts`

**Interfaces:**
- Produces:
  - `type ClockAction = { type: 'CLOCK_IN' } | { type: 'CLOCK_OUT'; entryId: string }`
  - `nextClockAction(openEntry: { id: string } | null): ClockAction`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/services/kiosk-state.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextClockAction } from './kiosk-state';

test('no open entry -> CLOCK_IN', () => {
  assert.deepEqual(nextClockAction(null), { type: 'CLOCK_IN' });
});

test('open entry -> CLOCK_OUT with that entry id', () => {
  assert.deepEqual(nextClockAction({ id: 'te_1' }), { type: 'CLOCK_OUT', entryId: 'te_1' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/app/services/kiosk-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/services/kiosk-state.ts
export type ClockAction = { type: 'CLOCK_IN' } | { type: 'CLOCK_OUT'; entryId: string };

export function nextClockAction(openEntry: { id: string } | null): ClockAction {
  return openEntry ? { type: 'CLOCK_OUT', entryId: openEntry.id } : { type: 'CLOCK_IN' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/app/services/kiosk-state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/kiosk-state.ts src/app/services/kiosk-state.test.ts
git commit -m "feat(payroll): pure kiosk clock state machine"
```

---

### Task B6: Payroll CSV export (pure)

**Files:**
- Create: `src/app/services/payroll-csv.ts`
- Test: `src/app/services/payroll-csv.test.ts`

**Interfaces:**
- Produces:
  - `type PayrollCsvRow = { employeeName: string; payType: string; totalHours: number; regularHours: number; overtimeHours: number; basePay: number; overtimePay: number; commissionPay: number; adjustments: number; grossPay: number }`
  - `toPayrollCsv(rows: PayrollCsvRow[]): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/services/payroll-csv.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { toPayrollCsv } from './payroll-csv';

const row = {
  employeeName: 'Jane Doe',
  payType: 'HOURLY',
  totalHours: 40,
  regularHours: 40,
  overtimeHours: 0,
  basePay: 480,
  overtimePay: 0,
  commissionPay: 0,
  adjustments: 0,
  grossPay: 480,
};

test('first line is the header row', () => {
  const csv = toPayrollCsv([row]);
  const lines = csv.split('\n');
  assert.equal(
    lines[0],
    'Employee,Pay Type,Total Hours,Regular Hours,Overtime Hours,Base Pay,Overtime Pay,Commission,Adjustments,Gross Pay',
  );
});

test('data rows follow the header', () => {
  const csv = toPayrollCsv([row]);
  const lines = csv.split('\n');
  assert.equal(lines[1], 'Jane Doe,HOURLY,40,40,0,480,0,0,0,480');
});

test('names containing commas are quoted', () => {
  const csv = toPayrollCsv([{ ...row, employeeName: 'Doe, Jane' }]);
  assert.ok(csv.includes('"Doe, Jane"'));
});

test('empty rows still emit the header', () => {
  assert.equal(toPayrollCsv([]).split('\n').length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/app/services/payroll-csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/services/payroll-csv.ts
export type PayrollCsvRow = {
  employeeName: string;
  payType: string;
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  commissionPay: number;
  adjustments: number;
  grossPay: number;
};

const HEADER = [
  'Employee', 'Pay Type', 'Total Hours', 'Regular Hours', 'Overtime Hours',
  'Base Pay', 'Overtime Pay', 'Commission', 'Adjustments', 'Gross Pay',
];

function cell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toPayrollCsv(rows: PayrollCsvRow[]): string {
  const lines = [HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        cell(r.employeeName), cell(r.payType), cell(r.totalHours), cell(r.regularHours),
        cell(r.overtimeHours), cell(r.basePay), cell(r.overtimePay), cell(r.commissionPay),
        cell(r.adjustments), cell(r.grossPay),
      ].join(','),
    );
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/app/services/payroll-csv.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/services/payroll-csv.ts src/app/services/payroll-csv.test.ts
git commit -m "feat(payroll): pure payroll CSV export"
```

---

### Task B7: Kiosk session cookie + middleware gate

**Files:**
- Modify: `src/app/lib/session.ts`
- Modify: `middleware.ts`

**Interfaces:**
- Produces (session.ts): `createKioskSession(): Promise<void>`, `getKioskSession(): Promise<boolean>`, `deleteKioskSession(): Promise<void>` — cookie name `kiosk`, payload `{ kiosk: true }`, 365-day expiry, signed with the same `SESSION_SECRET`.

- [ ] **Step 1: Add kiosk helpers to `session.ts`**

Append to `src/app/lib/session.ts`:

```ts
type KioskPayload = { kiosk: true; expiresAt: Date };

export async function createKioskSession() {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
  const token = await new SignJWT({ kiosk: true, expiresAt })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(getKey());

  (await cookies()).set('kiosk', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
}

export async function getKioskSession(): Promise<boolean> {
  const cookie = (await cookies()).get('kiosk')?.value;
  if (!cookie) return false;
  try {
    const { payload } = await jwtVerify(cookie, getKey(), { algorithms: ['HS256'] });
    return (payload as unknown as KioskPayload).kiosk === true;
  } catch {
    return false;
  }
}

export async function deleteKioskSession() {
  (await cookies()).delete('kiosk');
}
```

- [ ] **Step 2: Gate `/kiosk` in `middleware.ts`**

Add a kiosk-cookie check helper and route guard. After the existing `getSessionFromRequest` function, add:

```ts
async function hasKioskCookie(request: NextRequest): Promise<boolean> {
  if (!key) return false;
  const cookie = request.cookies.get('kiosk')?.value;
  if (!cookie) return false;
  try {
    const { payload } = await jwtVerify(cookie, key, { algorithms: ['HS256'] });
    return (payload as { kiosk?: boolean }).kiosk === true;
  } catch {
    return false;
  }
}
```

Inside `middleware()`, after the `/admin` block, add (admins may also open the kiosk to enable it):

```ts
  if (path.startsWith('/kiosk')) {
    const isAdmin = session?.userId && session.role === 'ADMIN';
    const isKiosk = await hasKioskCookie(request);
    if (!isAdmin && !isKiosk) {
      return NextResponse.redirect(new URL('/auth/signin?redirect=/kiosk', request.url));
    }
  }
```

Update the matcher to include `/kiosk`:

```ts
export const config = {
  matcher: ['/admin/:path*', '/appointments/:path*', '/book/:path*', '/reviews/new', '/kiosk/:path*'],
};
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/lib/session.ts middleware.ts
git commit -m "feat(kiosk): kiosk-mode cookie session + /kiosk route gate"
```

---

### Task B8: Employee admin server actions

**Files:**
- Create: `src/app/actions/employees.ts`

**Interfaces:**
- Consumes: `isValidPin`, `hashPin` (B2); `requireAdmin` pattern (mirror `admin.ts`).
- Produces:
  - `createEmployee(formData: FormData): Promise<{ error?: string } | void>`
  - `updateEmployee(id: string, formData: FormData): Promise<{ error?: string } | void>`
  - `setEmployeePin(id: string, pin: string): Promise<{ error?: string; success?: boolean }>`
  - `setEmployeeActive(id: string, isActive: boolean): Promise<void>`

- [ ] **Step 1: Implement the actions**

```ts
// src/app/actions/employees.ts
'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { isValidPin, hashPin } from '@/app/lib/pin';
import { z } from 'zod';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized', session: null };
  return { error: null, session };
}

const PAY_TYPES = ['HOURLY', 'SALARY', 'COMMISSION', 'HYBRID'] as const;

const employeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  title: z.string().min(1, 'Title is required').max(100),
  payType: z.enum(PAY_TYPES),
  hourlyRate: z.coerce.number().nonnegative().nullable().optional(),
  monthlySalary: z.coerce.number().nonnegative().nullable().optional(),
  commissionRate: z.coerce.number().min(0).max(1, 'Commission rate is a fraction 0–1').nullable().optional(),
  overtimeEnabled: z.boolean().optional(),
  overtimeThresholdHours: z.coerce.number().nonnegative().nullable().optional(),
  overtimeMultiplier: z.coerce.number().min(1).nullable().optional(),
  stylistId: z.string().nullable().optional(),
});

function parseEmployeeForm(formData: FormData) {
  return employeeSchema.safeParse({
    name: formData.get('name'),
    title: formData.get('title'),
    payType: formData.get('payType'),
    hourlyRate: formData.get('hourlyRate') || null,
    monthlySalary: formData.get('monthlySalary') || null,
    commissionRate: formData.get('commissionRate') || null,
    overtimeEnabled: formData.get('overtimeEnabled') === 'on',
    overtimeThresholdHours: formData.get('overtimeThresholdHours') || null,
    overtimeMultiplier: formData.get('overtimeMultiplier') || null,
    stylistId: (formData.get('stylistId') as string) || null,
  });
}

export async function createEmployee(formData: FormData) {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const pin = String(formData.get('pin') ?? '');
  if (!isValidPin(pin)) return { error: 'PIN must be 4–6 digits' };

  const d = parsed.data;
  await prisma.employee.create({
    data: {
      name: d.name,
      title: d.title,
      pinHash: await hashPin(pin),
      payType: d.payType,
      hourlyRate: d.hourlyRate ?? null,
      monthlySalary: d.monthlySalary ?? null,
      commissionRate: d.commissionRate ?? null,
      overtimeEnabled: d.overtimeEnabled ?? false,
      overtimeThresholdHours: d.overtimeThresholdHours ?? null,
      overtimeMultiplier: d.overtimeMultiplier ?? null,
      stylistId: d.stylistId || null,
    },
  });

  revalidatePath('/admin/employees');
}

export async function updateEmployee(id: string, formData: FormData) {
  const { error } = await requireAdmin();
  if (error) return { error };

  const parsed = parseEmployeeForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  await prisma.employee.update({
    where: { id },
    data: {
      name: d.name,
      title: d.title,
      payType: d.payType,
      hourlyRate: d.hourlyRate ?? null,
      monthlySalary: d.monthlySalary ?? null,
      commissionRate: d.commissionRate ?? null,
      overtimeEnabled: d.overtimeEnabled ?? false,
      overtimeThresholdHours: d.overtimeThresholdHours ?? null,
      overtimeMultiplier: d.overtimeMultiplier ?? null,
      stylistId: d.stylistId || null,
    },
  });

  revalidatePath('/admin/employees');
}

export async function setEmployeePin(id: string, pin: string) {
  const { error } = await requireAdmin();
  if (error) return { error };
  if (!isValidPin(pin)) return { error: 'PIN must be 4–6 digits' };

  await prisma.employee.update({ where: { id }, data: { pinHash: await hashPin(pin) } });
  revalidatePath('/admin/employees');
  return { success: true };
}

export async function setEmployeeActive(id: string, isActive: boolean) {
  const { error } = await requireAdmin();
  if (error) return;
  await prisma.employee.update({ where: { id }, data: { isActive } });
  revalidatePath('/admin/employees');
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/employees.ts
git commit -m "feat(payroll): employee admin CRUD server actions"
```

---

### Task B9: Employee admin page + form

**Files:**
- Create: `src/app/admin/employees/page.tsx`
- Create: `src/components/admin/EmployeeForm.tsx`

- [ ] **Step 1: Build the form component**

`EmployeeForm.tsx` is a `'use client'` component used for both create and edit. It renders inputs for: name, title, payType (`<select>`: HOURLY/SALARY/COMMISSION/HYBRID), hourlyRate, monthlySalary, commissionRate (fraction 0–1), overtimeEnabled (checkbox), overtimeThresholdHours, overtimeMultiplier, stylistId (`<select>` of stylists incl. a "— none —" option), and on create a `pin` field. It submits to a passed-in server action and surfaces the returned `{ error }`.

```tsx
// src/components/admin/EmployeeForm.tsx
'use client';

import { useState } from 'react';

type Stylist = { id: string; name: string };
type Employee = {
  id: string; name: string; title: string; payType: string;
  hourlyRate: string | null; monthlySalary: string | null; commissionRate: string | null;
  overtimeEnabled: boolean; overtimeThresholdHours: string | null; overtimeMultiplier: string | null;
  stylistId: string | null;
};

export default function EmployeeForm({
  action,
  stylists,
  employee,
}: {
  action: (formData: FormData) => Promise<{ error?: string } | void>;
  stylists: Stylist[];
  employee?: Employee;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const res = await action(formData);
    setPending(false);
    if (res && 'error' in res && res.error) setError(res.error);
    else setError(null);
  }

  return (
    <form action={onSubmit} className="space-y-4 max-w-xl">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <input name="name" defaultValue={employee?.name} placeholder="Full name" required className="w-full border p-2 rounded" />
      <input name="title" defaultValue={employee?.title} placeholder="Title (e.g. Senior Stylist)" required className="w-full border p-2 rounded" />
      <select name="payType" defaultValue={employee?.payType ?? 'HOURLY'} className="w-full border p-2 rounded">
        <option value="HOURLY">Hourly</option>
        <option value="SALARY">Fixed monthly salary</option>
        <option value="COMMISSION">Commission only</option>
        <option value="HYBRID">Hybrid (base + commission)</option>
      </select>
      <input name="hourlyRate" type="number" step="0.01" defaultValue={employee?.hourlyRate ?? ''} placeholder="Hourly rate (£)" className="w-full border p-2 rounded" />
      <input name="monthlySalary" type="number" step="0.01" defaultValue={employee?.monthlySalary ?? ''} placeholder="Monthly salary (£)" className="w-full border p-2 rounded" />
      <input name="commissionRate" type="number" step="0.01" min="0" max="1" defaultValue={employee?.commissionRate ?? ''} placeholder="Commission rate (fraction, e.g. 0.4)" className="w-full border p-2 rounded" />
      <label className="flex items-center gap-2">
        <input name="overtimeEnabled" type="checkbox" defaultChecked={employee?.overtimeEnabled} /> Enable overtime
      </label>
      <input name="overtimeThresholdHours" type="number" step="0.5" defaultValue={employee?.overtimeThresholdHours ?? ''} placeholder="Overtime threshold (hours/month)" className="w-full border p-2 rounded" />
      <input name="overtimeMultiplier" type="number" step="0.1" min="1" defaultValue={employee?.overtimeMultiplier ?? ''} placeholder="Overtime multiplier (e.g. 1.5)" className="w-full border p-2 rounded" />
      <select name="stylistId" defaultValue={employee?.stylistId ?? ''} className="w-full border p-2 rounded">
        <option value="">— Not a bookable stylist —</option>
        {stylists.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {!employee && (
        <input name="pin" inputMode="numeric" pattern="\d{4,6}" placeholder="Clock-in PIN (4–6 digits)" required className="w-full border p-2 rounded" />
      )}
      <button type="submit" disabled={pending} className="bg-accent text-black px-6 py-3 uppercase tracking-[0.2em] font-bold hover:bg-accent-light transition-colors disabled:opacity-50">
        {employee ? 'Save changes' : 'Add employee'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Build the list page**

`page.tsx` is a server component (mirror the structure of `src/app/admin/discounts/page.tsx`). It loads employees + stylists, renders the create form and a table of employees with their pay type, rates, linked stylist, active status, and a deactivate/reactivate button. Convert Prisma `Decimal` fields to strings for the client form via `?.toString() ?? null`.

```tsx
// src/app/admin/employees/page.tsx
import prisma from '@/app/lib/prisma';
import EmployeeForm from '@/components/admin/EmployeeForm';
import { createEmployee } from '@/app/actions/employees';

export default async function AdminEmployeesPage() {
  const [employees, stylists] = await Promise.all([
    prisma.employee.findMany({ orderBy: { name: 'asc' }, include: { stylist: true } }),
    prisma.stylist.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="p-6 space-y-8">
      <h1 className="font-serif text-3xl text-brand">Employees</h1>

      <section>
        <h2 className="text-xl mb-3">Add employee</h2>
        <EmployeeForm action={createEmployee} stylists={stylists} />
      </section>

      <section>
        <h2 className="text-xl mb-3">Team</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="p-2">Name</th><th className="p-2">Title</th><th className="p-2">Pay type</th>
              <th className="p-2">Stylist link</th><th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="p-2">{e.name}</td>
                <td className="p-2">{e.title}</td>
                <td className="p-2">{e.payType}</td>
                <td className="p-2">{e.stylist?.name ?? '—'}</td>
                <td className="p-2">{e.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

(Edit/PIN-reset/deactivate controls can reuse `updateEmployee`/`setEmployeePin`/`setEmployeeActive` via small client buttons mirroring the discounts page's action buttons; include them if time permits — not required for the Phase 1 happy path.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && pnpm lint`; in `pnpm dev` (logged in as admin) open `/admin/employees`, add an employee with a PIN, confirm it appears in the table.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/employees/page.tsx src/components/admin/EmployeeForm.tsx
git commit -m "feat(payroll): admin employees page + form"
```

---

### Task B10: Kiosk actions (roster, clock toggle, enable/disable)

**Files:**
- Create: `src/app/actions/kiosk.ts`

**Interfaces:**
- Consumes: `verifyPin` (B2), `nextClockAction` (B5), `getKioskSession`/`createKioskSession`/`deleteKioskSession` (B7).
- Produces:
  - `getKioskRoster(): Promise<{ id: string; name: string; title: string; imageUrl: string | null; isClockedIn: boolean }[]>`
  - `clockToggle(employeeId: string, pin: string): Promise<{ ok: boolean; status?: 'IN' | 'OUT'; name?: string; error?: string }>`
  - `enableKioskMode(): Promise<{ error?: string } | void>`
  - `disableKioskMode(): Promise<void>`

- [ ] **Step 1: Implement**

```ts
// src/app/actions/kiosk.ts
'use server';

import prisma from '@/app/lib/prisma';
import { verifySession, createKioskSession, deleteKioskSession, getKioskSession } from '@/app/lib/session';
import { verifyPin } from '@/app/lib/pin';
import { nextClockAction } from '@/app/services/kiosk-state';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const clockLimiter = upstashUrl && upstashToken
  ? new Ratelimit({
      redis: new Redis({ url: upstashUrl, token: upstashToken }),
      limiter: Ratelimit.slidingWindow(8, '5 m'),
      prefix: 'rl:clock',
    })
  : null;

const memAttempts = new Map<string, { count: number; firstAttempt: number }>();
function memOk(keyId: string): boolean {
  const now = Date.now();
  const rec = memAttempts.get(keyId);
  if (!rec || now - rec.firstAttempt > 5 * 60 * 1000) {
    memAttempts.set(keyId, { count: 1, firstAttempt: now });
    return true;
  }
  rec.count++;
  return rec.count <= 8;
}

async function clockRateOk(keyId: string): Promise<boolean> {
  if (clockLimiter) return (await clockLimiter.limit(keyId)).success;
  return memOk(keyId);
}

export async function getKioskRoster() {
  if (!(await getKioskSession())) return [];
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { stylist: { select: { imageUrl: true } } },
  });
  const openByEmployee = new Set(
    (await prisma.timeEntry.findMany({ where: { clockOut: null }, select: { employeeId: true } })).map((t) => t.employeeId),
  );
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.title,
    imageUrl: e.stylist?.imageUrl ?? null,
    isClockedIn: openByEmployee.has(e.id),
  }));
}

export async function clockToggle(employeeId: string, pin: string) {
  if (!(await getKioskSession())) return { ok: false, error: 'Kiosk not enabled on this device' };

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await clockRateOk(`${ip}:${employeeId}`))) {
    return { ok: false, error: 'Too many attempts. Please wait a few minutes.' };
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.isActive) return { ok: false, error: 'Unknown employee' };

  const valid = await verifyPin(pin, employee.pinHash);
  if (!valid) return { ok: false, error: 'Incorrect PIN' };

  const open = await prisma.timeEntry.findFirst({
    where: { employeeId, clockOut: null },
    orderBy: { clockIn: 'desc' },
    select: { id: true },
  });

  const action = nextClockAction(open);
  if (action.type === 'CLOCK_IN') {
    await prisma.timeEntry.create({ data: { employeeId, clockIn: new Date(), source: 'KIOSK', status: 'OPEN' } });
    revalidatePath('/kiosk');
    return { ok: true, status: 'IN' as const, name: employee.name };
  }
  await prisma.timeEntry.update({
    where: { id: action.entryId },
    data: { clockOut: new Date(), status: 'PENDING' },
  });
  revalidatePath('/kiosk');
  return { ok: true, status: 'OUT' as const, name: employee.name };
}

export async function enableKioskMode() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized' };
  await createKioskSession();
}

export async function disableKioskMode() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return;
  await deleteKioskSession();
}
```

Note: `new Date()` is the actual clock instant (UTC) — correct to store as the absolute time. Salon-local display happens at read time via `salon-time.ts`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/kiosk.ts
git commit -m "feat(kiosk): roster, PIN clock-toggle, enable/disable kiosk mode"
```

---

### Task B11: Kiosk clock-in page

**Files:**
- Create: `src/app/kiosk/page.tsx`
- Create: `src/components/kiosk/KioskClock.tsx`

- [ ] **Step 1: Server page loads roster**

```tsx
// src/app/kiosk/page.tsx
import { getKioskRoster } from '@/app/actions/kiosk';
import KioskClock from '@/components/kiosk/KioskClock';

export const dynamic = 'force-dynamic';

export default async function KioskPage() {
  const roster = await getKioskRoster();
  return (
    <main className="min-h-screen bg-brand text-white p-8">
      <h1 className="font-serif text-3xl mb-8 text-center">Staff Clock-In</h1>
      <KioskClock roster={roster} />
    </main>
  );
}
```

- [ ] **Step 2: Client component — identify, then PIN**

```tsx
// src/components/kiosk/KioskClock.tsx
'use client';

import { useState } from 'react';
import { clockToggle } from '@/app/actions/kiosk';

type RosterEntry = { id: string; name: string; title: string; imageUrl: string | null; isClockedIn: boolean };

export default function KioskClock({ roster }: { roster: RosterEntry[] }) {
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setSelected(null);
    setPin('');
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    const res = await clockToggle(selected.id, pin);
    setBusy(false);
    if (res.ok) {
      setMessage(`${res.name}: clocked ${res.status === 'IN' ? 'in' : 'out'} ✓`);
      reset();
      setTimeout(() => setMessage(null), 3000);
    } else {
      setMessage(res.error ?? 'Error');
      setPin('');
    }
  }

  if (selected) {
    return (
      <div className="max-w-xs mx-auto text-center">
        <p className="text-xl mb-2">{selected.name}</p>
        <p className="mb-4 opacity-80">{selected.isClockedIn ? 'Clock out' : 'Clock in'}</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Enter PIN"
          className="w-full text-center text-2xl tracking-[0.5em] p-4 rounded text-black"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={reset} className="flex-1 border border-white/40 py-3 rounded">Back</button>
          <button onClick={submit} disabled={busy || pin.length < 4} className="flex-1 bg-accent text-black py-3 rounded font-bold disabled:opacity-50">
            Confirm
          </button>
        </div>
        {message && <p className="mt-4">{message}</p>}
      </div>
    );
  }

  return (
    <div>
      {message && <p className="text-center text-accent text-xl mb-6">{message}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        {roster.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r)}
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-lg p-6 text-center"
          >
            <span className="block text-lg font-bold">{r.name}</span>
            <span className="block text-sm opacity-70">{r.title}</span>
            <span className={`block text-xs mt-2 ${r.isClockedIn ? 'text-green-300' : 'text-white/50'}`}>
              {r.isClockedIn ? '● On shift' : '○ Off'}
            </span>
          </button>
        ))}
        {roster.length === 0 && <p className="col-span-full text-center opacity-70">Kiosk not enabled or no active staff.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && pnpm lint`. In `pnpm dev` as admin, first enable kiosk mode (Task B12 adds the button) or temporarily call `enableKioskMode()`; open `/kiosk`, tap a name, enter the PIN you set, confirm the entry toggles in `/admin/timesheets` (Task B14).

- [ ] **Step 4: Commit**

```bash
git add src/app/kiosk/page.tsx src/components/kiosk/KioskClock.tsx
git commit -m "feat(kiosk): identify-then-PIN clock-in screen"
```

---

### Task B12: "Enable kiosk on this device" admin control

**Files:**
- Create: `src/components/admin/KioskModeButton.tsx`
- Modify: `src/app/admin/employees/page.tsx` (render the button)

- [ ] **Step 1: Button component**

```tsx
// src/components/admin/KioskModeButton.tsx
'use client';

import { useState } from 'react';
import { enableKioskMode, disableKioskMode } from '@/app/actions/kiosk';

export default function KioskModeButton() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={async () => { const r = await enableKioskMode(); setMsg(r?.error ?? 'Kiosk enabled on this device — open /kiosk'); }}
        className="bg-brand text-white px-4 py-2 rounded"
      >
        Enable kiosk on this device
      </button>
      <button
        onClick={async () => { await disableKioskMode(); setMsg('Kiosk disabled on this device'); }}
        className="border px-4 py-2 rounded"
      >
        Disable
      </button>
      {msg && <span className="text-sm text-zinc-600">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Render it** at the top of `/admin/employees` page (import and place `<KioskModeButton />` under the `<h1>`).

- [ ] **Step 3: Verify & commit**

Run: `npx tsc --noEmit && pnpm lint`
```bash
git add src/components/admin/KioskModeButton.tsx src/app/admin/employees/page.tsx
git commit -m "feat(kiosk): admin control to enable/disable kiosk mode on a device"
```

---

### Task B13: Timesheet actions (edit, approve)

**Files:**
- Create: `src/app/actions/timesheets.ts`

**Interfaces:**
- Consumes: `requireAdmin` pattern; `resolveSalonDateTime` from `salon-time.ts` for parsing admin date+time edits.
- Produces:
  - `updateTimeEntry(id: string, formData: FormData): Promise<{ error?: string } | void>` — edit clockIn/clockOut (salon-local date + HH:mm), breakMinutes, note; sets `status='EDITED'`, stamps `editedByAdminId`.
  - `approveTimeEntry(id: string): Promise<void>`
  - `approveMonth(year: number, month: number): Promise<{ count: number } | { error: string }>` — approve all PENDING/EDITED entries whose `clockIn` falls in that salon month.
  - `deleteTimeEntry(id: string): Promise<void>`

- [ ] **Step 1: Implement**

```ts
// src/app/actions/timesheets.ts
'use server';

import prisma from '@/app/lib/prisma';
import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { resolveSalonDateTime, isValidSalonDate, isValidSalonTime } from '@/app/services/salon-time';
import { fromZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { z } from 'zod';

async function requireAdmin() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return { error: 'Unauthorized', session: null };
  return { error: null, session };
}

const editSchema = z.object({
  date: z.string().refine(isValidSalonDate, 'Invalid date'),
  clockInTime: z.string().refine(isValidSalonTime, 'Invalid clock-in time'),
  clockOutTime: z.string().refine((t) => t === '' || isValidSalonTime(t), 'Invalid clock-out time'),
  breakMinutes: z.coerce.number().int().min(0).max(1440),
  note: z.string().max(500).optional(),
});

export async function updateTimeEntry(id: string, formData: FormData) {
  const { error, session } = await requireAdmin();
  if (error || !session) return { error: error ?? 'Unauthorized' };

  const parsed = editSchema.safeParse({
    date: formData.get('date'),
    clockInTime: formData.get('clockInTime'),
    clockOutTime: formData.get('clockOutTime') ?? '',
    breakMinutes: formData.get('breakMinutes') ?? 0,
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const clockIn = resolveSalonDateTime(d.date, d.clockInTime).utc;
  const clockOut = d.clockOutTime ? resolveSalonDateTime(d.date, d.clockOutTime).utc : null;
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    return { error: 'Clock-out must be after clock-in' };
  }

  await prisma.timeEntry.update({
    where: { id },
    data: {
      clockIn,
      clockOut,
      breakMinutes: d.breakMinutes,
      note: d.note || null,
      status: 'EDITED',
      editedByAdminId: session.userId,
    },
  });
  revalidatePath('/admin/timesheets');
}

export async function approveTimeEntry(id: string) {
  const { error } = await requireAdmin();
  if (error) return;
  const entry = await prisma.timeEntry.findUnique({ where: { id } });
  if (!entry || !entry.clockOut) return; // cannot approve an open entry
  await prisma.timeEntry.update({ where: { id }, data: { status: 'APPROVED' } });
  revalidatePath('/admin/timesheets');
}

export async function approveMonth(year: number, month: number) {
  const { error } = await requireAdmin();
  if (error) return { error };
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const end = fromZonedTime(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const res = await prisma.timeEntry.updateMany({
    where: { clockIn: { gte: start, lt: end }, clockOut: { not: null }, status: { in: ['PENDING', 'EDITED'] } },
    data: { status: 'APPROVED' },
  });
  revalidatePath('/admin/timesheets');
  return { count: res.count };
}

export async function deleteTimeEntry(id: string) {
  const { error } = await requireAdmin();
  if (error) return;
  await prisma.timeEntry.delete({ where: { id } });
  revalidatePath('/admin/timesheets');
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/timesheets.ts
git commit -m "feat(payroll): timesheet edit/approve server actions"
```

---

### Task B14: Timesheets admin page

**Files:**
- Create: `src/app/admin/timesheets/page.tsx`

- [ ] **Step 1: Build the month view**

A server component taking `searchParams` for `year`/`month` (default to the current salon month). It lists entries grouped by employee for that month, shows worked hours (via `segmentWorkedMinutes`), flags open entries, and exposes approve buttons + an "Approve all" for the month. Display times in `Europe/London` using `toZonedTime` + `date-fns` `format`.

```tsx
// src/app/admin/timesheets/page.tsx
import prisma from '@/app/lib/prisma';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { segmentWorkedMinutes } from '@/app/services/timesheet-calc';
import { approveTimeEntry, approveMonth } from '@/app/actions/timesheets';

function monthBounds(year: number, month: number) {
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = fromZonedTime(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  return { start, end };
}

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = toZonedTime(new Date(), SALON_TIMEZONE);
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const { start, end } = monthBounds(year, month);

  const entries = await prisma.timeEntry.findMany({
    where: { clockIn: { gte: start, lt: end } },
    orderBy: [{ employeeId: 'asc' }, { clockIn: 'asc' }],
    include: { employee: { select: { name: true } } },
  });

  const fmt = (d: Date) => format(toZonedTime(d, SALON_TIMEZONE), 'dd MMM HH:mm');

  return (
    <div className="p-6 space-y-6">
      <h1 className="font-serif text-3xl text-brand">Timesheets — {year}-{String(month).padStart(2, '0')}</h1>

      <form action={async () => { 'use server'; await approveMonth(year, month); }}>
        <button className="bg-brand text-white px-4 py-2 rounded">Approve all (closed) for this month</button>
      </form>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="p-2">Employee</th><th className="p-2">Clock in</th><th className="p-2">Clock out</th>
            <th className="p-2">Hours</th><th className="p-2">Status</th><th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const hours = e.clockOut ? (segmentWorkedMinutes({ clockIn: e.clockIn, clockOut: e.clockOut, breakMinutes: e.breakMinutes }) / 60).toFixed(2) : '—';
            return (
              <tr key={e.id} className="border-b">
                <td className="p-2">{e.employee.name}</td>
                <td className="p-2">{fmt(e.clockIn)}</td>
                <td className="p-2">{e.clockOut ? fmt(e.clockOut) : <span className="text-amber-600">OPEN</span>}</td>
                <td className="p-2">{hours}</td>
                <td className="p-2">{e.status}</td>
                <td className="p-2">
                  {e.clockOut && e.status !== 'APPROVED' && (
                    <form action={async () => { 'use server'; await approveTimeEntry(e.id); }}>
                      <button className="text-brand underline">Approve</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
          {entries.length === 0 && <tr><td className="p-2" colSpan={6}>No entries this month.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
```

(Editing open/forgotten clock-outs uses `updateTimeEntry` — add an inline edit form per row mirroring the approve form if needed; the "Approve all" + per-row approve cover the Phase-1 happy path.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && pnpm lint`; in dev, create a clock-in/out via `/kiosk`, confirm it shows here with computed hours and can be approved.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/timesheets/page.tsx
git commit -m "feat(payroll): admin timesheets month view + approval"
```

---

### Task B15: Payroll service (gather + compute + persist)

**Files:**
- Create: `src/app/services/payroll-service.ts`

**Interfaces:**
- Consumes: `totalWorkedHours`, `splitRegularOvertime` (B3); `computeGross` (B4); `salon-time` month bounds.
- Produces:
  - `runPayroll(year: number, month: number): Promise<{ periodId: string }>` — upsert a DRAFT `PayrollPeriod`, recompute a `PayrollLine` per active employee from **APPROVED** entries in the salon month (commission = 0 in Phase 1; adjustments preserved if a line already exists and period is DRAFT).
  - `updateAdjustment(lineId: string, amount: number, note: string): Promise<void>` — recompute that line's gross.
  - `finalizePayroll(periodId: string, adminId: string): Promise<void>` — set FINALIZED + write `snapshotJson` per line.

- [ ] **Step 1: Implement**

```ts
// src/app/services/payroll-service.ts
import 'server-only';
import prisma from '@/app/lib/prisma';
import { fromZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { totalWorkedHours, splitRegularOvertime } from '@/app/services/timesheet-calc';
import { computeGross, round2, type PayType } from '@/app/services/payroll-calc';

function monthBounds(year: number, month: number) {
  const start = fromZonedTime(`${year}-${String(month).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = fromZonedTime(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00.000`, SALON_TIMEZONE);
  return { start, end };
}

const num = (d: { toString(): string } | null): number | null => (d == null ? null : Number(d.toString()));

export async function runPayroll(year: number, month: number) {
  const { start, end } = monthBounds(year, month);

  const period = await prisma.payrollPeriod.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month, status: 'DRAFT' },
  });

  const employees = await prisma.employee.findMany({ where: { isActive: true } });

  for (const e of employees) {
    const entries = await prisma.timeEntry.findMany({
      where: { employeeId: e.id, status: 'APPROVED', clockIn: { gte: start, lt: end }, clockOut: { not: null } },
      select: { clockIn: true, clockOut: true, breakMinutes: true },
    });
    const segments = entries
      .filter((x): x is { clockIn: Date; clockOut: Date; breakMinutes: number } => x.clockOut != null)
      .map((x) => ({ clockIn: x.clockIn, clockOut: x.clockOut, breakMinutes: x.breakMinutes }));

    const totalHours = totalWorkedHours(segments);
    const { regularHours, overtimeHours } = splitRegularOvertime(totalHours, {
      enabled: e.overtimeEnabled,
      thresholdHours: num(e.overtimeThresholdHours) ?? 0,
    });

    // Phase 1: commission revenue is 0 (Phase 2 wires completed-booking revenue).
    const gross = computeGross({
      payType: e.payType as PayType,
      hourlyRate: num(e.hourlyRate),
      monthlySalary: num(e.monthlySalary),
      commissionRate: num(e.commissionRate),
      regularHours,
      overtimeHours,
      overtimeMultiplier: num(e.overtimeMultiplier),
      commissionableRevenue: 0,
      adjustments: 0,
    });

    const existing = await prisma.payrollLine.findUnique({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.id } },
    });
    const adjustments = existing ? Number(existing.adjustments.toString()) : 0;
    const adjustmentNote = existing?.adjustmentNote ?? null;
    const grossWithAdj = round2(gross.grossPay + adjustments);

    await prisma.payrollLine.upsert({
      where: { periodId_employeeId: { periodId: period.id, employeeId: e.id } },
      update: {
        totalHours, regularHours, overtimeHours,
        basePay: gross.basePay, overtimePay: gross.overtimePay,
        commissionableRevenue: 0, commissionPay: gross.commissionPay,
        adjustments, adjustmentNote, grossPay: grossWithAdj,
      },
      create: {
        periodId: period.id, employeeId: e.id,
        totalHours, regularHours, overtimeHours,
        basePay: gross.basePay, overtimePay: gross.overtimePay,
        commissionableRevenue: 0, commissionPay: gross.commissionPay,
        adjustments: 0, grossPay: gross.grossPay,
      },
    });
  }

  return { periodId: period.id };
}

export async function updateAdjustment(lineId: string, amount: number, note: string) {
  const line = await prisma.payrollLine.findUnique({ where: { id: lineId }, include: { period: true } });
  if (!line || line.period.status !== 'DRAFT') return;
  const baseGross = Number(line.basePay.toString()) + Number(line.overtimePay.toString()) + Number(line.commissionPay.toString());
  await prisma.payrollLine.update({
    where: { id: lineId },
    data: { adjustments: amount, adjustmentNote: note || null, grossPay: round2(baseGross + amount) },
  });
}

export async function finalizePayroll(periodId: string, adminId: string) {
  const lines = await prisma.payrollLine.findMany({ where: { periodId } });
  for (const l of lines) {
    await prisma.payrollLine.update({ where: { id: l.id }, data: { snapshotJson: JSON.stringify(l) } });
  }
  await prisma.payrollPeriod.update({
    where: { id: periodId },
    data: { status: 'FINALIZED', finalizedByAdminId: adminId, finalizedAt: new Date() },
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/services/payroll-service.ts
git commit -m "feat(payroll): payroll run/adjust/finalize service"
```

---

### Task B16: Payroll actions + admin page (with CSV export)

**Files:**
- Create: `src/app/actions/payroll.ts`
- Create: `src/app/admin/payroll/page.tsx`

**Interfaces:**
- Consumes: `runPayroll`, `updateAdjustment`, `finalizePayroll` (B15); `toPayrollCsv` (B6).
- Produces:
  - `runPayrollAction(year: number, month: number): Promise<void>`
  - `updateAdjustmentAction(lineId: string, amount: number, note: string): Promise<void>`
  - `finalizePayrollAction(periodId: string): Promise<void>`

- [ ] **Step 1: Actions**

```ts
// src/app/actions/payroll.ts
'use server';

import { verifySession } from '@/app/lib/session';
import { revalidatePath } from 'next/cache';
import { runPayroll, updateAdjustment, finalizePayroll } from '@/app/services/payroll-service';

async function requireAdminSession() {
  const session = await verifySession();
  if (session.role !== 'ADMIN') return null;
  return session;
}

export async function runPayrollAction(year: number, month: number) {
  if (!(await requireAdminSession())) return;
  await runPayroll(year, month);
  revalidatePath('/admin/payroll');
}

export async function updateAdjustmentAction(lineId: string, amount: number, note: string) {
  if (!(await requireAdminSession())) return;
  await updateAdjustment(lineId, amount, note);
  revalidatePath('/admin/payroll');
}

export async function finalizePayrollAction(periodId: string) {
  const session = await requireAdminSession();
  if (!session) return;
  await finalizePayroll(periodId, session.userId);
  revalidatePath('/admin/payroll');
}
```

- [ ] **Step 2: Page — run, table, adjustments, finalize, CSV download**

The page (server component, `searchParams` year/month) loads the period + lines, renders a "Run / recompute" button, a table of per-employee hours and gross, an inline adjustment form per line (DRAFT only), a Finalize button, and a CSV download link built from `toPayrollCsv`. The CSV is produced inside the page and offered via a `data:` link or a tiny client button.

```tsx
// src/app/admin/payroll/page.tsx
import prisma from '@/app/lib/prisma';
import { toZonedTime } from 'date-fns-tz';
import { SALON_TIMEZONE } from '@/app/services/salon-time';
import { toPayrollCsv } from '@/app/services/payroll-csv';
import { runPayrollAction, finalizePayrollAction } from '@/app/actions/payroll';

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = toZonedTime(new Date(), SALON_TIMEZONE);
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;

  const period = await prisma.payrollPeriod.findUnique({
    where: { year_month: { year, month } },
    include: { lines: { include: { employee: { select: { name: true, payType: true } } }, orderBy: { employee: { name: 'asc' } } } },
  });

  const csvRows = (period?.lines ?? []).map((l) => ({
    employeeName: l.employee.name,
    payType: l.employee.payType,
    totalHours: Number(l.totalHours.toString()),
    regularHours: Number(l.regularHours.toString()),
    overtimeHours: Number(l.overtimeHours.toString()),
    basePay: Number(l.basePay.toString()),
    overtimePay: Number(l.overtimePay.toString()),
    commissionPay: Number(l.commissionPay.toString()),
    adjustments: Number(l.adjustments.toString()),
    grossPay: Number(l.grossPay.toString()),
  }));
  const csv = toPayrollCsv(csvRows);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  return (
    <div className="p-6 space-y-6">
      <h1 className="font-serif text-3xl text-brand">Payroll — {year}-{String(month).padStart(2, '0')}</h1>
      <p className="text-sm text-zinc-500">Gross pay only. Phase 1: commission excluded (added in Phase 2).</p>

      <form action={async () => { 'use server'; await runPayrollAction(year, month); }}>
        <button className="bg-brand text-white px-4 py-2 rounded">Run / recompute from approved timesheets</button>
      </form>

      {period && (
        <>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b">
                <th className="p-2">Employee</th><th className="p-2">Hours</th><th className="p-2">Base</th>
                <th className="p-2">Overtime</th><th className="p-2">Commission</th><th className="p-2">Adjustments</th><th className="p-2">Gross</th>
              </tr>
            </thead>
            <tbody>
              {period.lines.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="p-2">{l.employee.name}</td>
                  <td className="p-2">{Number(l.totalHours.toString()).toFixed(2)}</td>
                  <td className="p-2">£{Number(l.basePay.toString()).toFixed(2)}</td>
                  <td className="p-2">£{Number(l.overtimePay.toString()).toFixed(2)}</td>
                  <td className="p-2">£{Number(l.commissionPay.toString()).toFixed(2)}</td>
                  <td className="p-2">£{Number(l.adjustments.toString()).toFixed(2)}</td>
                  <td className="p-2 font-bold">£{Number(l.grossPay.toString()).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex gap-4 items-center">
            <a href={csvHref} download={`payroll-${year}-${String(month).padStart(2, '0')}.csv`} className="border border-accent text-brand px-4 py-2 rounded">
              Download CSV
            </a>
            {period.status === 'DRAFT' ? (
              <form action={async () => { 'use server'; await finalizePayrollAction(period.id); }}>
                <button className="bg-accent text-black px-4 py-2 rounded font-bold">Finalize</button>
              </form>
            ) : (
              <span className="text-green-700 font-bold">Finalized</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

(Per-line adjustment editing uses `updateAdjustmentAction`; add a small client row-editor mirroring `EmployeeForm`'s submit pattern. Not required for the Phase-1 happy path but recommended.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && pnpm lint`; in dev: approve a timesheet, open `/admin/payroll`, run, confirm hours/base/gross compute and CSV downloads, then Finalize and confirm status flips.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/payroll.ts src/app/admin/payroll/page.tsx
git commit -m "feat(payroll): payroll admin page with run, finalize, CSV export"
```

---

### Task B17: Admin navigation links

**Files:**
- Modify: `src/app/admin/layout.tsx`

- [ ] **Step 1:** Add nav links to `/admin/employees`, `/admin/timesheets`, `/admin/payroll`, and an external-style link to `/kiosk`, mirroring the existing admin nav items in `src/app/admin/layout.tsx` (copy one existing `<Link>` and change `href`/label).

- [ ] **Step 2: Verify & commit**

Run: `npx tsc --noEmit && pnpm lint`
```bash
git add src/app/admin/layout.tsx
git commit -m "feat(payroll): admin nav links for employees, timesheets, payroll, kiosk"
```

---

### Task B18: Full test + lint sweep and structure registry

**Files:**
- Modify: `readme/structure.md`

- [ ] **Step 1: Run the whole suite**

Run: `pnpm test`
Expected: all `*.test.ts` pass (social-links-data, pin, timesheet-calc, payroll-calc, kiosk-state, payroll-csv + existing suites).

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 2: Register new units** in `readme/structure.md` — add entries for the new services (`timesheet-calc`, `payroll-calc`, `kiosk-state`, `payroll-csv`, `payroll-service`), libs (`pin`), actions (`employees`, `kiosk`, `timesheets`, `payroll`), pages (`/admin/employees`, `/admin/timesheets`, `/admin/payroll`, `/kiosk`), and components (`SocialLinks`, `VisitFollowBlock`, `EmployeeForm`, `KioskClock`, `KioskModeButton`), following the file's existing format.

- [ ] **Step 3: Commit**

```bash
git add readme/structure.md
git commit -m "docs: register clock-in/payroll + links units in structure.md"
```

---

## Self-Review

**Spec coverage:**
- Part A links → footer/contact/home + settings-driven + SEO (sameAs already covers it) → Tasks A1–A6. ✅
- Treatwell secondary to own CTA → A4/A5 outline styling. ✅
- Employee model + per-employee pay config → B1, B8, B9. ✅
- Kiosk PIN identify-then-PIN + rate limit + gate → B2, B7, B10, B11, B12. ✅
- TimeEntry + admin approve + forgotten clock-out edit → B13, B14. ✅
- Monthly gross, HOURLY/SALARY (full salary, no proration), commission deferred → B4, B15, B16. ✅
- Overtime split available but off by default → B3, B4 (calc), gated by `overtimeEnabled`. ✅
- CSV export + finalize/snapshot → B6, B15, B16. ✅
- Europe/London boundaries → B13/B14/B15 use `salon-time`/`fromZonedTime`. ✅
- All three Prisma schemas → B1, A6. ✅

**Placeholder scan:** No "TBD/TODO". Two tasks note optional polish (inline edit/adjustment editors) as recommended-not-required, but the required Phase-1 happy path is fully specified with code. ✅

**Type consistency:** `computeGross`/`GrossInput` fields match call sites in `payroll-service`; `ClosedSegment` shape consistent across `timesheet-calc` and its callers; `getSocialLinks` settings shape matches `SocialLinks` props; `nextClockAction` return matches `clockToggle` usage; Prisma composite-unique accessors (`year_month`, `periodId_employeeId`) match the `@@unique` definitions in B1. ✅

**Phase boundary:** Commission is wired as `0` in `payroll-service` (Phase 1) with `commissionRate` stored for Phase 2; breaks field present but no UX; overtime calc present but `overtimeEnabled` defaults false — all consistent with "Phase 1 MVP first". ✅
