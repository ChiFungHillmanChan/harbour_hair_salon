import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBookingGates } from './booking-gates';

const NOW = new Date('2026-07-10T12:00:00Z');
const FUTURE = new Date('2026-07-15T10:00:00Z');
const PAST = new Date('2026-07-01T10:00:00Z');

// Baseline input for a plain service with no gates and a valid future booking.
// Individual tests override only the fields relevant to the branch under test.
function baseInput(overrides: Partial<Parameters<typeof evaluateBookingGates>[0]> = {}) {
  return {
    requiresConsultation: false,
    requiresPatchTest: false,
    patchTestEligible: true,
    patchTestReason: 'eligible' as const,
    bookingInstant: FUTURE,
    now: NOW,
    ...overrides,
  };
}

test('normal service, future booking, no gates → ok', () => {
  const result = evaluateBookingGates(baseInput());
  assert.deepEqual(result, { ok: true });
});

test('consultation-only service is rejected regardless of date/patch-test state', () => {
  const result = evaluateBookingGates(baseInput({ requiresConsultation: true }));
  assert.deepEqual(result, {
    ok: false,
    code: 'CONSULTATION_ONLY', error: 'This service is by consultation only. Please book a consultation to discuss it.',
  });
});

test('past bookingInstant is rejected', () => {
  const result = evaluateBookingGates(baseInput({ bookingInstant: PAST }));
  assert.deepEqual(result, { ok: false, code: 'PAST_TIME', error: 'Cannot book a time in the past' });
});

test('bookingInstant exactly equal to now is rejected (boundary, not strictly in the future)', () => {
  const result = evaluateBookingGates(baseInput({ bookingInstant: NOW }));
  assert.deepEqual(result, { ok: false, code: 'PAST_TIME', error: 'Cannot book a time in the past' });
});

test('past bookingInstant takes priority over consultation-only (matches file order: past-date checked first)', () => {
  const result = evaluateBookingGates(
    baseInput({ bookingInstant: PAST, requiresConsultation: true }),
  );
  assert.deepEqual(result, { ok: false, code: 'PAST_TIME', error: 'Cannot book a time in the past' });
});

test('patch-test service, eligible → ok', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: true, patchTestEligible: true, patchTestReason: 'eligible' }),
  );
  assert.deepEqual(result, { ok: true });
});

test('patch-test service, ineligible reason "too_soon" → the 48-hour-lead message', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: true, patchTestEligible: false, patchTestReason: 'too_soon' }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'PATCH_TEST_TOO_SOON', error: 'Your patch test must be at least 48 hours before a colour appointment.',
  });
});

test('patch-test service, ineligible reason "expired" → the 6-month-validity message', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: true, patchTestEligible: false, patchTestReason: 'expired' }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'PATCH_TEST_EXPIRED', error: 'Your patch test has expired (valid for 6 months). Please book a new Consultation & Patch Test.',
  });
});

test('patch-test service, ineligible reason "not_completed" → the "book a consultation" message', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: true, patchTestEligible: false, patchTestReason: 'not_completed' }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'PATCH_TEST_REQUIRED', error: 'Colour services require a completed Consultation & Patch Test first. Please book that appointment.',
  });
});

test('patch-test service, ineligible reason "none" (no patch test on file) → falls back to the same "book a consultation" message', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: true, patchTestEligible: false, patchTestReason: 'none' }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'PATCH_TEST_REQUIRED', error: 'Colour services require a completed Consultation & Patch Test first. Please book that appointment.',
  });
});

test('patch-test flag set but patchTestEligible true (e.g. pass-through for a non-gated service) → ok, reason ignored', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: true, patchTestEligible: true, patchTestReason: 'too_soon' }),
  );
  assert.deepEqual(result, { ok: true });
});

test('non-patch-test service ignores an ineligible patch-test reason (patch-test gate only applies when requiresPatchTest)', () => {
  const result = evaluateBookingGates(
    baseInput({ requiresPatchTest: false, patchTestEligible: false, patchTestReason: 'too_soon' }),
  );
  assert.deepEqual(result, { ok: true });
});

test('consultation-only takes priority over an ineligible patch-test gate', () => {
  const result = evaluateBookingGates(
    baseInput({
      requiresConsultation: true,
      requiresPatchTest: true,
      patchTestEligible: false,
      patchTestReason: 'too_soon',
    }),
  );
  assert.deepEqual(result, {
    ok: false,
    code: 'CONSULTATION_ONLY', error: 'This service is by consultation only. Please book a consultation to discuss it.',
  });
});
