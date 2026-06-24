# Design: Site Links + Employee Clock-In & Payroll

**Date:** 2026-06-24
**Status:** Approved (design) — pending spec review
**Author:** Brainstormed with Claude Code

This document covers two **independent** workstreams:

- **Part A — Social & review links** (small; ship first)
- **Part B — Employee clock-in & gross payroll** (the main system; build Phase 1 first)

They share no code and can be implemented in either order. Part A is a quick win; Part B is phased.

---

## Part A — Social & review links

### Goal
Surface the salon's three external profiles across the site:

- **Treatwell:** `https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/`
- **Instagram:** `https://www.instagram.com/harbourhair_leeds/` (`@harbourhair_leeds`)
- **Google Maps:** `https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111`

### Key finding
The settings infrastructure already exists and is **not** rendered:

- `src/app/services/site-settings-service.ts` defines `treatwellUrl`, `instagramUrl`, Google Business Profile, Facebook, Fresha, Booksy, plus `buildSameAsArray()` for JSON-LD.
- `src/components/admin/SiteSettingsForm.tsx` + `src/app/actions/admin-settings.ts` already persist these.
- Only Instagram is rendered today, hardcoded in the footer (`src/components/layout/Layout.tsx`).

So this is **populate settings + render**, not hardcode.

### Approach
1. **Seed the three URLs** into `SiteSettings` (Treatwell, Instagram already present, Google Maps → the Google Business Profile field). Remain editable at `/admin/settings`.
2. **Render in three places** using the existing inline-SVG + brand-color conventions (`--brand #174F7F`, `--accent #C9A96E`, `text-zinc-500 hover:text-accent transition-colors`). No new icon library — hand-coded SVGs like the existing Instagram icon.
   - **Footer** (`Layout.tsx`, every page): Treatwell + Google Maps icons beside the existing Instagram icon, all pulled from `SiteSettings` (render each only if its URL is set).
   - **Contact page** (`src/app/contact/page.tsx`): a "Find & follow us" row — Instagram, a "Book on Treatwell" button, and a "Get directions / read our Google reviews" link. Keep the existing Google Maps iframe embed.
   - **Home page** (`src/app/page.tsx`): a new compact "Visit & follow us" block inserted before the footer (there is no such section today). Shows the three links and can reuse the existing Google rating from `SocialProofBar`.
3. **SEO:** include all three in `buildSameAsArray()` so the JSON-LD `sameAs` connects the site to the Treatwell/Instagram/Maps profiles.

### Design decision
Treatwell is a competing booking funnel that takes commission. The salon's **own** "Book appointment" remains the primary CTA; Treatwell is presented as a **secondary** option (smaller/secondary styling). Confirmed acceptable.

### Non-goals (Part A)
- No live Treatwell/Instagram feed embeds (just links).
- No second map embed on Contact (keep the existing iframe).

---

## Part B — Employee clock-in & gross payroll

### Goals
- Employees clock in/out on a **shared salon kiosk** using a **PIN**.
- The system totals hours per month and computes **gross monthly pay** per employee.
- Admin **reviews and approves** timesheets before pay is calculated.
- Support **all pay models per-employee**: hourly, fixed salary, commission-only, hybrid.

### Scope boundary / non-goals
- **Gross pay only.** No PAYE income tax, National Insurance, pension auto-enrolment, or net pay. Those totals are handed to the salon's accountant. This keeps the system clear of HMRC compliance liability.
- No biometric clock-in; PIN on a shared device only.
- No employee self-service portal in Phase 1 (admin + kiosk only).

### Resolved decisions
- **Pay models:** all four available, configurable per employee.
- **Clock-in device:** shared reception kiosk, PIN-based.
- **Approval:** admin reviews & approves each period before payroll calc (audit trail; admin can correct entries).
- **Commission basis:** completed bookings only — from existing `Appointment` data.
- **Who clocks in:** all staff. `Employee` optionally links to an existing `Stylist` (the link feeds commission). Non-stylist staff (e.g. receptionist) stand alone.
- **Hour rules:** raw hours is the baseline default; unpaid breaks, overtime multiplier, and lateness/early-leave flags are **optional, admin-configurable layers**.
- **Salary rule:** SALARY employees get the **full fixed monthly amount** regardless of clocked hours; clock-in is attendance/record-keeping only (no proration).
- **Pay period:** calendar month.
- **Build order:** **Phase 1 MVP first**, then Phase 2 commission, then Phase 3 optional layers.

### Identity: new `Employee` model
Employees aren't customers and authenticate by PIN on a shared device, so they get a dedicated model, separate from the `USER`/`ADMIN` customer JWT auth. An `Employee` may link 1:1 to an existing `Stylist` (for commission); the `Stylist` content model is unchanged.

### Data model (new tables — add to **all three** Prisma schemas: `dev/`, `vercel/`, `prod/`)

**`Employee`**
- `id` (cuid)
- `name`, `title` (e.g. "Senior Stylist", "Receptionist")
- `pinHash` (bcrypt-hashed PIN; never store plaintext)
- `stylistId` (FK → `Stylist`, nullable, unique) — commission link
- `payType` — `HOURLY` | `SALARY` | `COMMISSION` | `HYBRID`
- `hourlyRate` (Decimal, nullable)
- `monthlySalary` (Decimal, nullable)
- `commissionRate` (Decimal, nullable — percent, e.g. 0.40)
- `overtimeEnabled` (Boolean, default false), `overtimeThresholdHours` (Decimal, per week, nullable), `overtimeMultiplier` (Decimal, nullable, e.g. 1.5)
- `unpaidBreakMinutes` (Int, nullable — fixed auto-deduct rule, if used)
- `isActive` (Boolean, default true)
- `hireDate` (DateTime)
- `createdAt`, `updatedAt`
- Relations: `timeEntries[]`, `shifts[]`, `payrollLines[]`

**`TimeEntry`** — one clock-in→clock-out worked segment (raw attendance)
- `id`
- `employeeId` (FK → `Employee`)
- `clockIn` (DateTime, UTC), `clockOut` (DateTime, UTC, nullable while OPEN)
- `breakMinutes` (Int, default 0)
- `source` — `KIOSK` | `ADMIN`
- `status` — `OPEN` → `PENDING` → `APPROVED` (admin edits can set `EDITED`/note)
- `note` (String, nullable), `editedByAdminId` (String, nullable)
- `createdAt`, `updatedAt`
- Index: `[employeeId, clockIn]`

Breaks: handled two configurable ways — (a) fixed `unpaidBreakMinutes` auto-deducted, or (b) employee clocks out for break and back in (natural multi-segment day). No separate Break table in Phase 1/3 unless needed.

**`Shift`** *(optional — only when lateness flagging is on; Phase 3)*
- `id`, `employeeId` (FK)
- `date` (DateTime), `startTime`/`endTime` ("HH:mm")
- `createdAt`, `updatedAt`
- May be generated from the existing weekly `Availability` templates.

**`PayrollPeriod`**
- `id`, `year` (Int), `month` (Int 1–12)
- `status` — `DRAFT` | `FINALIZED`
- `finalizedByAdminId` (nullable), `finalizedAt` (nullable)
- `createdAt`, `updatedAt`
- Unique: `[year, month]`

**`PayrollLine`** — per-employee frozen breakdown for a period
- `id`, `periodId` (FK), `employeeId` (FK)
- `totalHours`, `regularHours`, `overtimeHours` (Decimal)
- `basePay`, `overtimePay`, `commissionableRevenue`, `commissionPay`, `adjustments` (Decimal), `adjustmentNote` (String, nullable)
- `grossPay` (Decimal)
- `snapshotJson` (String — frozen calc breakdown at finalize)
- `createdAt`, `updatedAt`
- Unique: `[periodId, employeeId]`

Finalizing snapshots numbers so later rate changes never rewrite history.

### Kiosk clock-in flow
- A single `/kiosk` screen runs on the reception tablet. **Gating mechanism:** an admin authenticates once on the device and toggles it into "kiosk mode," which sets a long-lived, httpOnly **kiosk cookie/token** (separate from the customer JWT). `middleware.ts` allows `/kiosk` only with a valid kiosk token; the page itself exposes **only** PIN clock actions (no ADMIN capabilities). The token can be revoked from `/admin/settings`.
- **Identify-then-PIN** (defeats PIN guessing and avoids PIN collisions): tap your name/photo from the active-staff roster, then enter your PIN.
- Each tap drives a state machine: **Clocked out → Clock in → (optional Start break / End break) → Clock out**, writing/closing `TimeEntry` rows with `source = KIOSK`, `status = PENDING`.
- PIN attempts are **rate-limited** and lock after repeated failures, reusing the existing Upstash limiter (`src/app/...` rate-limit util). PINs stored as bcrypt hashes.
- Server action `clockToggle(employeeId, pin)` validates the PIN, toggles state, returns a greeting + current status.

### Payroll calculation (per employee, per month)
1. Sum **APPROVED** `TimeEntry` hours in the period, minus breaks → split into regular vs overtime if `overtimeEnabled`.
2. **Base pay** by `payType`:
   - `HOURLY`: regularHours × hourlyRate + overtimeHours × hourlyRate × overtimeMultiplier
   - `SALARY`: full `monthlySalary` (no proration)
   - `COMMISSION`: 0
   - `HYBRID`: base (hourly or salary) + commission
3. **Commission** (`COMMISSION`/`HYBRID`): Σ `price` of the linked stylist's `COMPLETED` `Appointment`s in the period × `commissionRate`. Reads existing booking data — no extra entry.
4. **+ manual adjustments**: admin bonus/deduction with a note.
5. **= grossPay**, shown as a per-employee breakdown, exportable to **CSV**, then admin **finalizes** (writes `PayrollLine` + `snapshotJson`).

All period boundaries computed in **`Europe/London`** via the existing `src/app/services/salon-time.ts` helpers (DST-safe).

### Admin UI (new pages, ADMIN-only)
- `/admin/employees` — CRUD; set pay model/rates/PIN, link to a `Stylist`, activate/deactivate.
- `/admin/timesheets` — review/edit/approve `TimeEntry` rows per period; fix forgotten clock-outs.
- `/admin/payroll` — run a month, view breakdowns, export CSV, finalize.
- `/kiosk` — the clock-in screen (kiosk-mode access, not ADMIN session).

### Conventions & integration (follow existing patterns)
- Server actions in `src/app/actions/` (`employees.ts`, `timesheets.ts`, `payroll.ts`, `kiosk.ts`) with `'use server'`, **Zod** validation, and `requireAdmin()` (except kiosk actions, which use PIN auth).
- Business logic in `src/app/services/` (`payroll-service.ts`, `timesheet-service.ts`); reuse `salon-time.ts`.
- Use **Prisma generated types**; never hand-write model interfaces.
- **Decimal** for all money/rates.
- `middleware.ts`: protect `/admin/employees|timesheets|payroll` (ADMIN) and gate `/kiosk` (kiosk mode).
- Edit all three Prisma schemas + generate migrations (`pnpm db:dev:migrate`, `pnpm db:vercel:deploy`).
- Update `readme/structure.md` with the new functions/components.

### Phasing
- **Phase 1 — MVP (build first):** `Employee` + kiosk PIN clock-in/out + `/admin/employees` + `/admin/timesheets` approve + monthly hours + HOURLY/SALARY gross + CSV export + `PayrollPeriod`/`PayrollLine`.
- **Phase 2:** Commission from completed bookings (enables COMMISSION/HYBRID).
- **Phase 3:** Optional layers — unpaid breaks, overtime multiplier, `Shift` scheduling + lateness/early-leave flags.

### Testing strategy
- Unit tests for `payroll-service` calc across all four pay types, overtime split, break deduction, and month-boundary/DST edges (BST↔GMT).
- Unit tests for the kiosk state machine (toggle transitions, open-entry handling, PIN rate-limit/lockout).
- Verify with `pnpm test` / `tsc` / `pnpm lint` (local `pnpm build` fails on DB — per project memory, don't rely on it for verification).

### Security notes
- PINs: bcrypt-hashed, identify-then-PIN, rate-limited + lockout.
- Kiosk route must not expose ADMIN capabilities; clock actions only.
- Payroll/timesheet actions strictly `requireAdmin()`.

---

## Open items confirmed during brainstorming
- Salary = full fixed amount (no proration). ✅
- Build Phase 1 MVP first. ✅
- Treatwell secondary to own booking CTA. ✅
