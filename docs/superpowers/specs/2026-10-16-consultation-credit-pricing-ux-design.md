# Consultation credit, "price after consultation", move confirmation and eligibility notices — design

**Status:** approved in conversation 2026-10-16 ("please continue on everything")
**Origin:** owner requests 2026-10-16 (B, C, D, E; A was a data change, done the same day)
**Builds on:** `2026-07-04-consultation-gated-booking-design.md`, `2026-10-16-late-arrival-auto-cancel-design.md`

## 0. Already done (A)

Chemical services (all Colouring, Perms incl. Keratin and Hair Correction) keep
`requiresConsultation = true`; the server refuses them online
(`evaluateBookingGates`). The 7 Styling services were switched to
`requiresConsultation = false` in production (audited `SERVICE.UPDATE`, backup in
the session scratchpad), so blow-dries book directly.

## 1. Decisions (owner, 2026-10-16)

| # | Decision |
|---|---|
| B1 | The £15 consultation is **credit** against the treatment it was for: a consultation-required treatment booked within **6 months** of the consultation has the consultation's price deducted. |
| B2 | **Tracked by the website and applied automatically**: when staff enter the treatment booking in Admin, the dialog offers the available credit, ticked by default; customers see "Consultation credit −£15" on their booking and emails. One consultation's credit is used once; a cancelled treatment gives it back. |
| B3 | Written clearly when booking (the consultation gate), on the services page, in the booking terms and on the consultation's confirmation email. |
| C1 | Dragging or resizing a booking on the admin calendar asks for confirmation before anything is saved. |
| D1 | Every consultation-required service shows its price as "**From £X** — final price confirmed at your consultation". A code rule, not per-service data. |
| E1 | NHS / Student prices: "please bring proof (a valid NHS staff ID or student card); without it the standard price applies" — services page, the option chooser, confirmation email, My Bookings. |
| E2 | Discount codes: general terms (one per booking, not with NHS/Student or other offers, no cash value, proof may be required, the salon may withdraw an offer) on the booking terms and offers page; the wizard's code field shows them when codes are on again (they are paused in code today). |

## 2. B — Consultation credit

### 2.1 Data

All three schemas, one migration each (preview DB by hand):

```prisma
model Appointment {
  /// The consultation whose fee is credited against this booking (B1).
  consultationCreditFromId String?
  consultationCreditFrom   Appointment?  @relation("ConsultationCredit", fields: [consultationCreditFromId], references: [id], onDelete: SetNull, onUpdate: NoAction)
  consultationCreditUsedBy Appointment[] @relation("ConsultationCredit")
  /// The amount credited, frozen when it was applied (pence).
  consultationCreditPence  Int?
  @@index([consultationCreditFromId])
}
```

(SQL Server needs `onDelete: NoAction` on a self-relation; use the provider's
accepted actions — appointments are never deleted, so the action never fires.)

The treatment's own `priceAtBooking` / `quoteJson` are unchanged: the credit is a
separate, recorded deduction. "To pay in the salon" = price − deposit − credit.

### 2.2 Which consultation gives credit

`services/consultation-credit.ts`, mirroring `getValidPatchTest`:

- a booking for this customer (`userId`) whose service `isConsultation` or
  `isPatchTest`;
- that took place: `status = 'COMPLETED'`, or `status = 'CONFIRMED'` with its
  start passed and `lateCancelledAt` null;
- dated within the last 6 months (`CONSULTATION_CREDIT_MONTHS = 6`, salon-local
  calendar months) of the treatment's start;
- its recorded price (`priceAtBooking`) > 0;
- not already used: no other non-CANCELLED appointment has
  `consultationCreditFromId` = its id.
- The most recent qualifying consultation is offered.

Amount = the consultation's `priceAtBooking` (pence), capped at the treatment's
recorded price.

### 2.3 Applying it (staff only)

Online customers cannot book consultation-required treatments (the gate), so
credit is applied only in Admin:

- `createAppointmentByAdmin` / `editAppointmentByAdmin` take
  `applyConsultationCredit?: boolean`. For a `requiresConsultation` service the
  dialog asks the server for the available credit
  (`findConsultationCredit(customerId, serviceId, date)` server action, admin-only)
  and shows "Consultation credit available: £15 (consultation on 12 Oct) —
  deduct from this booking", ticked by default.
- Inside the booking's Serializable transaction the credit is looked up again
  (never trusted from the browser) and written:
  `consultationCreditFromId`, `consultationCreditPence`.
- Changing the service to one that does not require a consultation, or unticking,
  clears both fields. Cancelling the treatment keeps the fields (history) but the
  "not already used" rule ignores CANCELLED bookings, so the credit is free again.
- Audit metadata carries `consultationCreditPence` and the consultation id.

### 2.4 Showing it

- Admin board and dialog: "Consultation credit −£15".
- Customer: confirmation/reminder email details and My Bookings card get a row
  "Consultation credit −£15" and "To pay in the salon £X" (price − deposit −
  credit, never below 0). The notification snapshot gains
  `consultationCreditPence`.
- Booking wizard gate panel (`gate.byConsultation`): "This service needs a
  {fee} consultation first. If you go ahead with the treatment within 6 months,
  the {fee} is taken off its price." (Free consultation: unchanged wording.)
- Services page / service detail for consultation-required services: one line
  under the price with the same promise.
- Consultation confirmation email: a footnote with the same promise.
- `/booking-terms` → "Patch tests and consultations": the credit rule, the
  6 months, used once, not refunded if the treatment does not go ahead or the
  consultation is missed.

## 3. C — Confirm before moving

- `ScheduleDayGrid` and `ScheduleWeekGrid`: a drop or resize that would change a
  booking opens a confirmation modal (in-page, not `window.confirm`):
  "Move this booking?" + customer · service + `from → to` (day, time, stylist,
  minutes; only what changed) + **Move** / **Cancel**. Focus starts on Cancel;
  Esc cancels; Enter on Move confirms.
- Cancel (or closing) snaps the block back; nothing is sent to the server.
- Move calls the existing `onMove`; the existing clash dialog and refusals work
  as today.
- A drop that changes nothing opens nothing.

## 4. D — Price after consultation

- Rule (pure, `services/pricing/policy.ts`): `effectivePriceNature(service) =
  service.requiresConsultation ? 'SUBJECT_TO_CONSULTATION' : service.priceNature`.
  Every customer-facing price render uses it.
- Wording (en/zh): the amount is prefixed "From" (`pricing.from`), and the note
  becomes "Final price confirmed at your consultation" (replacing "May be
  adjusted after consultation" everywhere it shows).
- Structured data (JSON-LD) for these services: the offer's price is a minimum
  (`priceSpecification.minPrice`), not a fixed price.
- Staff-entered bookings record whatever price staff set, as today.

## 5. E — Eligibility and discount-code notices

- A service option is "eligibility-priced" when its `priceType` is the NHS type
  (covers "NHS" and "Student & NHS" names). Pure helper
  `requiresEligibilityProof(service)`.
- Notice text (en/zh): "NHS and student prices: please bring a valid NHS staff ID
  or student card to your appointment. Without one, the standard price applies."
  Shown: services page (once, near the price list), the wizard's option chooser
  when such an option is shown, the confirmation email (footnote) and My Bookings
  (card note) for such bookings.
- `/booking-terms`: new section "Offers, discount codes and NHS/student prices":
  one code per booking; codes cannot be combined with NHS/student prices or
  other offers; no cash value; a code or price may require proof of eligibility;
  the salon may withdraw an offer; the code applies to the listed price.
- `/offers`: the same terms under active offers. The wizard's discount field
  (when `DISCOUNTS_PAUSED` is false) shows a one-line summary with a link to the
  terms.

## 6. Testing

- Credit: lookup rules (statuses, late-cancelled, 6-month boundary, used once,
  freed by a cancelled treatment, most recent first, capped at price); server
  re-check ignores a forged amount; edit/clear; snapshot and email rows; terms
  text; page tests for the wizard gate copy.
- Move confirmation: component tests that a drop calls `onMove` only after Move,
  Cancel restores position, unchanged drop opens nothing.
- Price rule: `effectivePriceNature` table; PriceParts renders "From" and the new
  note; JSON-LD minPrice.
- Eligibility: helper table; notice rendered for NHS options only; email
  footnote; terms page.
- i18n completeness; brand monochrome.
