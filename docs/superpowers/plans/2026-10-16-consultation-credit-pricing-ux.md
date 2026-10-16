# Consultation credit, price-after-consultation, move confirmation, eligibility notices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (D) consultation-required services read "From £X — final price confirmed at your consultation"; (E) NHS/student proof notice and discount-code terms; (C) admin calendar drag/resize asks before saving; (B) a £15 consultation is credited against a consultation-required treatment staff book within 6 months, shown to the customer.

**Architecture:** D is a pure price-nature rule applied where public services are mapped. E is a pure eligibility helper plus text. C adds a pending-move confirmation state to the two grids before their existing `send()`. B adds two nullable `Appointment` columns, a credit lookup service mirroring `getValidPatchTest`, an admin-only apply path in the staff create/edit actions (re-checked in the transaction), and rows in emails / My Bookings / board.

**Tech Stack:** Next.js 16, Prisma (3 schemas), node:test + tsx, Tailwind monochrome, en + zh-HK.

**Spec:** `docs/superpowers/specs/2026-10-16-consultation-credit-pricing-ux-design.md`

## Global Constraints

- Branch `feat/consultation-credit-pricing-ux`, stacked on `feat/late-arrival-auto-cancel` (worktree `.claude/worktrees/consultation-ux`).
- `CONSULTATION_CREDIT_MONTHS = 6` in `src/app/lib/booking-constants.ts`.
- Credit applies only to services with `requiresConsultation = true`; credit sources are appointments whose service `isConsultation || isPatchTest`.
- The treatment's `priceAtBooking`/`quoteJson` NEVER change because of credit (`recordedPrice` requires `quote.amountPence === priceAtBooking`).
- Every string en + zh-HK (customer-facing zh uses 「本店」 for the salon, written register like neighbouring strings); monochrome only.
- Migration folder name `20261016140000_consultation_credit` in all three providers; preview DB by hand after merge.
- Commit trailers: `Co-Authored-By: Claude <Model> 5.5 <noreply@anthropic.com>` (the model that wrote it) + `Claude-Session: https://claude.ai/code/session_013BvsbrNhsU6DAgfot6sXbx`; never a bracketed skip-ci marker.

## Review Focus

1. A forged/stale credit from the browser — the server re-looks-up the credit inside the booking transaction and ignores client amounts (P5 test).
2. Two treatments racing for one consultation's credit — Serializable transaction + "not already used" re-check; second gets none (P5 test).
3. A cancelled treatment frees its credit; a late-cancelled or no-show consultation never gives one (P4 tests).
4. "To pay in the salon" never goes negative when deposit + credit exceed the price (P6 test).
5. A drop that changes nothing must not open the move confirmation; Cancel sends nothing (P3 test).

---

### Task 1 (D): Price after consultation

**Files:** `src/app/services/pricing/policy.ts` (add `effectivePriceNature`), `src/app/services/public-service-select.ts` (map `priceNature` through it for every public service), `src/components/pricing/PriceParts.tsx` / `src/components/booking/BookingWizard.tsx` single-card + option chooser + `src/components/services/ServiceList.tsx` + `OfferingPrices.tsx` + `CategoryPriceList.tsx` + `MenuPrice.tsx` (prefix "From" for consultation-required services), `src/app/services/pricing/json-ld.ts` (`priceSpecification.minPrice` for these), `src/i18n/messages/{en,zh}/pricing.ts` (`subjectToConsultation` → en "Final price confirmed at your consultation", zh 「最終價錢於諮詢時確定」), `src/i18n/messages/{en,zh}/emails.ts` (`values.subjectToConsultation` → en "final price confirmed at your consultation", zh 「最終價錢於諮詢時確定」).

**Interfaces — Produces:** `effectivePriceNature(service: { requiresConsultation: boolean; priceNature: string }): PriceNature`.

- [ ] Step 1 — failing tests: `src/app/services/pricing/pricing.test.ts`: table (`requiresConsultation` true → `SUBJECT_TO_CONSULTATION` whatever stored; false → stored value). New `src/components/pricing/PriceParts.test.ts`: SUBJECT_TO_CONSULTATION renders the new note (en + zh). `json-ld` test: a consultation-required service's offer has `priceSpecification: { '@type': 'PriceSpecification', minPrice, priceCurrency: 'GBP' }` and no fixed `price`; a listed service keeps `price`. Public-service mapping test: a `requiresConsultation` row maps to `priceNature: 'SUBJECT_TO_CONSULTATION'`.
- [ ] Step 2 — run → FAIL.
- [ ] Step 3 — implement:

```ts
/**
 * A consultation-required service's price is a starting point: the stylist
 * confirms the final price at the consultation (owner, 2026-10-16). The rule
 * lives here, not in each service row, so a service switched to "consultation
 * required" reads right everywhere at once.
 */
export function effectivePriceNature(service: { requiresConsultation: boolean; priceNature: string }): PriceNature {
  return service.requiresConsultation ? 'SUBJECT_TO_CONSULTATION' : (service.priceNature as PriceNature);
}
```

  Apply it where `ClientPublicService` is built; prefix amounts with `tp('from')` for `requiresConsultation` services in the single-price renders (ServiceList single entries, OfferingPrices cells, CategoryPriceList, wizard single card and option chooser). MenuPrice already shows "From" for ranges — also show it for a single consultation-required price.
- [ ] Step 4 — fix the wording pins this moves (email-content tests that assert "may be adjusted after consultation"); run `pnpm test`, `tsc`, lint → green.
- [ ] Step 5 — commit `feat(pricing): consultation-required services read "From £X — final price confirmed at your consultation"`.

### Task 2 (E): Eligibility proof and discount-code terms

**Files:** create `src/app/services/pricing/eligibility.ts` (`requiresEligibilityProof(service: { priceType: string }): boolean` → `priceType === 'NHS'`); messages `pricing.eligibilityProof` en "NHS and student prices: please bring a valid NHS staff ID or student card to your appointment. Without one, the standard price applies." zh 「NHS 及學生價：到店時請出示有效的 NHS 員工證或學生證，否則按標準價收費。」; render on: `ServiceList.tsx` (once near the NHS note), wizard option chooser when any NHS option is listed, `email-content.ts` CONFIRMATION + REMINDER + REQUEST_RECEIVED footnote when the booked option is NHS (needs `priceType` in the snapshot — the snapshot's `price` already carries `priceType`), `AppointmentCard.tsx` note for NHS bookings. Booking terms: new section `offers` in `legal.bookingTerms` (en/zh) between "changes" and "patchTests", rendered in `booking-terms/page.tsx` with id `offers`:
  - en title "Offers, discount codes and NHS or student prices"; items: "One discount code per booking." / "A discount code can't be combined with NHS or student prices or with another offer." / "Discount codes have no cash value and apply to the listed price." / "NHS and student prices, and some offers, need proof of eligibility at your appointment, such as a valid NHS staff ID or student card. Without it, the standard price applies." / "We may change or withdraw an offer; a booking already confirmed keeps the price it was confirmed at."
  - zh equivalents in the same order.
  Update `LAST_UPDATED` in `booking-terms/page.tsx` to `'2026-10-16'` and the page test's date + section list. `/offers`: render the same items under the offers list when offers are active (not while paused).
- [ ] TDD: helper table; booking-terms page test (section present en/zh, date); email footnote only for NHS; card note only for NHS; wizard renders the notice when an NHS option is shown (BookingWizard test mocks PriceParts — follow its pattern).
- [ ] Commit `feat(pricing): proof-of-eligibility notice for NHS/student prices; offer and discount-code terms`.

### Task 3 (C): Confirm before moving

**Files:** `src/components/admin/ScheduleDayGrid.tsx`, `ScheduleWeekGrid.tsx`, new `src/components/admin/MoveConfirmDialog.tsx`, messages `adminSchedule.moveConfirm.{title,from,to,stylist,minutes,move,cancel}` en/zh; tests `src/components/admin/ScheduleMoveConfirm.test.ts`.

Behaviour: in each grid's `commit(state)`, after the "unchanged press → onSelect" early return, instead of `send(false)` set `pendingMove = { appt, payload, summary }` and render `MoveConfirmDialog` (role="dialog", aria-modal, focus starts on Cancel, Esc = cancel, Enter on Move). **Move** → `send(false)` (existing clash flow unchanged). **Cancel** → clear `pendingMove` (the block is already back at its stored position because `endDrag` cleared the drag state). The summary lists only what changed: day/time `Fri 17 Oct 10:00 → Fri 17 Oct 11:30`, stylist `Ivan → Lox` (day grid only), length `45 → 60 min`. Disable new drags while a confirmation is open.

- [ ] TDD: render a grid with one booking (follow ScheduleExternalBusy.test.ts / admin grid tests for rendering and pointer simulation); drag → dialog shown, `onMove` not called; Cancel → `onMove` never called; Move → `onMove` called once with the payload; a press without movement → no dialog, `onSelect` called.
- [ ] Commit `feat(admin): confirm before a dragged or resized booking is saved`.

### Task 4 (B1): Credit data and lookup

**Files:** three schemas + migrations `20261016140000_consultation_credit` (fields exactly as spec §2.1; for SQL Server use `onDelete: NoAction, onUpdate: NoAction` on the self-relation in all three schemas so they stay identical), `src/app/lib/booking-constants.ts` (`CONSULTATION_CREDIT_MONTHS = 6`), create `src/app/services/consultation-credit.ts`; test alongside; schema test like `src/app/lib/late-arrival-schema.test.ts`.

**Interfaces — Produces:**

```ts
export type ConsultationCredit = { fromAppointmentId: string; amountPence: number; consultationDate: Date };
/** The most recent unused consultation credit this customer can put towards a consultation-required booking starting at `at`. */
export async function findConsultationCredit(
  db: Pick<PrismaClient, 'appointment'> | Prisma.TransactionClient,
  input: { userId: string; at: Date; excludeAppointmentId?: string },
): Promise<ConsultationCredit | null>;
export function creditFor(credit: ConsultationCredit | null, treatmentPricePence: number): number; // min(credit, price), 0 when null
```

Rules (spec §2.2): service `isConsultation || isPatchTest`; `status = 'COMPLETED'` OR (`status = 'CONFIRMED'` AND `date <= now` AND `lateCancelledAt = null`); consultation `date` ≥ `at` minus 6 calendar months (salon-local, `date-fns` `subMonths` on the London wall time via the repo's salon-time helpers) and `date <= at`; `priceAtBooking > 0`; no other appointment with `status != 'CANCELLED'` and `consultationCreditFromId = id` (excluding `excludeAppointmentId`, the booking being edited). Most recent first. Amount = `toPence(priceAtBooking)`.

- [ ] TDD (fake db via `loadServerModule` or a pure core + thin query): COMPLETED consultation → credit; CONFIRMED past → credit; CONFIRMED future → none; late-cancelled → none; CANCELLED → none; 6-month boundary (exactly 6 months → credit, 6 months + 1 day → none); used by a CONFIRMED treatment → none; used by a CANCELLED treatment → credit; editing the treatment that holds it (`excludeAppointmentId`) → credit; free (£0) consultation → none; two consultations → the most recent; `creditFor` caps at the price.
- [ ] Commit `feat(consultation-credit): data model and credit lookup`.

### Task 5 (B2): Staff apply the credit

**Files:** `src/app/actions/admin-schedule.ts` (`createSchema`/`editSchema` gain `applyConsultationCredit: z.boolean().optional()`; inside the existing Serializable transaction, when the (new) service `requiresConsultation` and the flag is true: `findConsultationCredit(tx, { userId, at: date, excludeAppointmentId })` → write `consultationCreditFromId` + `consultationCreditPence = creditFor(credit, quote.amountPence or the recorded price)`; flag false or service not consultation-required → write both null; audit metadata/notification untouched otherwise), new admin-only server action `previewConsultationCredit({ customerId?, email?, serviceId, dateStr, time, appointmentId? })` in a new `src/app/actions/admin-consultation-credit.ts` (returns `{ available: false } | { available: true; amountPence; consultationDate: string }`, NO writes), `src/components/admin/AppointmentDialog.tsx` (for a selected `requiresConsultation` service: fetch the preview when customer/service/date change; show "Consultation credit available: £15 (consultation on 12 Oct) — deduct from this booking" checkbox, ticked by default; send `applyConsultationCredit`; in edit mode show the recorded credit), `DialogService` + `dialogServiceSelect` gain `requiresConsultation`, messages `adminSchedule.credit.*` en/zh.

- [ ] TDD: create with flag + available credit → columns written from the SERVER lookup (a client cannot pass an amount — the schema has no amount field); create with flag but none available → null; flag false → null; edit switching to a non-consultation service clears; two concurrent creates for the same customer → only one gets the credit (simulate with the fake tx: second re-check sees the first's row); preview action is admin-only and writes nothing; dialog test: checkbox shown only for consultation-required services when available.
- [ ] Commit `feat(consultation-credit): staff apply a consultation's credit to the treatment booking`.

### Task 6 (B3): Showing the credit and the promise

**Files:** `notification-outbox-service.ts` (snapshot gains `consultationCreditPence: number | null` — read from the appointment; old payloads without it render as before), `email-content.ts` (CONFIRMATION/REMINDER/RESCHEDULE details: row "Consultation credit" `−£15.00`; "To pay in the salon" = max(0, price − captured deposit − credit) in `remainderText`), `AppointmentCard.tsx` + `appointments/page.tsx` (same rows), `admin-calendar-data.ts` + `board-price.ts`/dialog (show "Consultation credit −£15"), wizard gate copy `booking.gate.byConsultation` en "This service needs a {fee} consultation first. If you go ahead with the treatment within 6 months, the {fee} is taken off its price." zh 「此服務需要先預約 {fee} 諮詢。如你在 6 個月內進行療程，{fee} 會在療程價錢中扣除。」 (free-fee wording unchanged), services pages one-line note under consultation-required prices `services.consultationCreditNote` (en "Consultation £15, taken off your treatment if you go ahead within 6 months." — use the consultation's actual price via a prop, not a literal), consultation confirmation email footnote (CONFIRMATION for an `isConsultation || isPatchTest` booking: `emails.confirmation.consultationCredit` en "If you go ahead with your treatment within 6 months, this consultation's {amount} is taken off its price." zh 「如你在 6 個月內進行療程，此諮詢的 {amount} 會在療程價錢中扣除。」; the snapshot needs a boolean `isConsultation`), booking terms `legal.bookingTerms.patchTests.credit` en "The consultation fee counts towards your treatment: if you go ahead within 6 months, we take it off the treatment's price, once. It isn't refunded if you decide not to go ahead or miss the consultation." + zh, rendered after `patchTests.body`; `docs/data-erasure.md` (credit columns are not personal data — note only).
- [ ] TDD: email rows/remainder incl. never-negative; old snapshot without the field renders as before; card rows; terms page; wizard gate text with £15 and with a free consultation; consultation confirmation footnote only for consultation bookings.
- [ ] Commit `feat(consultation-credit): show the credit to customers and say so when booking`.

### Task P7: Docs, verification, PR

- [ ] CLAUDE.md: a "Consultation credit" bullet and the price-after-consultation rule under Key Conventions; `readme/structure.md`; LAUNCH.md owner note (the Styling change is live; credit applies automatically for staff bookings).
- [ ] Full gate: `pnpm run lint && pnpm run test && pnpm run build` (prod DB env exported), `pnpm exec tsc --noEmit`.
- [ ] Push branch, PR with base `feat/late-arrival-auto-cancel` (retarget to main after that merges).
