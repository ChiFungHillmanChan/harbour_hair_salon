// Pure, dependency-free decision logic for the submitBooking gate stack.
//
// The DB fetches (service flags, patch-test eligibility) stay in
// src/app/actions/booking.ts::submitBooking — this module only decides,
// given the already-fetched inputs, whether the booking is allowed and (if
// not) which customer-facing message to show. Kept prisma-free so the full
// gate combinatorics can be exhaustively unit tested without a database.
//
// Decision order mirrors the CURRENT submitBooking file order exactly:
// past-date rejection (checked before the service is even fetched) → then
// consultation-only rejection (checked right after the service fetch) →
// then the colour patch-test gate (checked last, only when requiresPatchTest).
// See booking-gates.test.ts and the call site in submitBooking for the
// combinations this ordering was chosen to preserve.

// Mirrors patch-test-eligibility.ts's EligibilityReason. Redeclared locally
// (rather than imported) so this module has zero imports and stays trivially
// pure — the brief's interface lists only 4 reasons, but getValidPatchTest
// can also return 'none' (a customer with no patch-test history at all), and
// submitBooking's current inline message logic already folds 'none' into the
// same fallback message as 'not_completed'. Omitting it here would either be
// a type error at the call site or require an unsafe cast, so it's included.
export type PatchTestGateReason = 'too_soon' | 'expired' | 'not_completed' | 'none' | 'eligible';

export interface BookingGateInput {
  requiresConsultation: boolean;
  requiresPatchTest: boolean;
  patchTestEligible: boolean;
  patchTestReason: PatchTestGateReason;
  bookingInstant: Date;
  now: Date;
}

export type BookingGateResult = { ok: true } | { ok: false; error: string };

export function evaluateBookingGates(input: BookingGateInput): BookingGateResult {
  const { requiresConsultation, requiresPatchTest, patchTestEligible, patchTestReason, bookingInstant, now } = input;

  // Prevent booking in the past (matches submitBooking's `fullDate <= new Date()`).
  if (bookingInstant <= now) {
    return { ok: false, error: 'Cannot book a time in the past' };
  }

  // A gated service must never be booked directly — the client routes to a
  // consultation, but a crafted request must be rejected.
  if (requiresConsultation) {
    return { ok: false, error: 'This service is by consultation only. Please book a consultation to discuss it.' };
  }

  if (requiresPatchTest && !patchTestEligible) {
    const message =
      patchTestReason === 'too_soon'
        ? 'Your patch test must be at least 48 hours before a colour appointment.'
        : patchTestReason === 'expired'
          ? 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.'
          : 'Colour services require a completed Consultation & Patch Test first. Please book that appointment.';
    return { ok: false, error: message };
  }

  return { ok: true };
}
