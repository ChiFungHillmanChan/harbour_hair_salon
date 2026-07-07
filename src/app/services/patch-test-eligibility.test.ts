import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePatchTestEligibility,
  PATCH_TEST_MIN_LEAD_HOURS,
  PATCH_TEST_VALIDITY_DAYS,
} from './patch-test-eligibility';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const colour = new Date('2026-07-01T10:00:00Z');

test('no tests → not eligible (none)', () => {
  const r = evaluatePatchTestEligibility([], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'none');
});

test('completed test 3 days before, within 6 months → eligible', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 3 * DAY), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'eligible');
});

test('completed test only 24h before (<48h lead) → too_soon', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 24 * HOUR), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_soon');
});

test('exactly 48h before → eligible (boundary inclusive)', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - PATCH_TEST_MIN_LEAD_HOURS * HOUR), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, true);
});

test('completed test 200 days before → expired', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 200 * DAY), status: 'COMPLETED' }], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('confirmed-but-not-completed test → not_completed', () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - 3 * DAY), status: 'CONFIRMED' }], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_completed');
});

test('picks the most recent qualifying test', () => {
  const r = evaluatePatchTestEligibility([
    { date: new Date(colour.getTime() - 150 * DAY), status: 'COMPLETED' },
    { date: new Date(colour.getTime() - 5 * DAY), status: 'COMPLETED' },
  ], colour);
  assert.equal(r.ok, true);
  assert.equal(r.testDate?.toISOString(), new Date(colour.getTime() - 5 * DAY).toISOString());
});

test('most-recent too_soon but older test is valid → eligible via older test', () => {
  const r = evaluatePatchTestEligibility([
    { date: new Date(colour.getTime() - 24 * HOUR), status: 'COMPLETED' }, // too_soon
    { date: new Date(colour.getTime() - 5 * DAY), status: 'COMPLETED' }, // valid
  ], colour);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'eligible');
  assert.equal(r.testDate?.toISOString(), new Date(colour.getTime() - 5 * DAY).toISOString());
});

// --- 183-day (6-month) validity boundary ---------------------------------
// The implementation's exact edge (see patch-test-eligibility.ts): a test
// qualifies while `lead <= validityMs` (`lead > validityMs` is the only
// expiry check), where `validityMs = PATCH_TEST_VALIDITY_DAYS * DAY`. So the
// boundary is inclusive at exactly `PATCH_TEST_VALIDITY_DAYS` days, and the
// very next millisecond past it expires.

test(`completed test exactly ${PATCH_TEST_VALIDITY_DAYS} days before → eligible (validity boundary inclusive)`, () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - PATCH_TEST_VALIDITY_DAYS * DAY), status: 'COMPLETED' }],
    colour,
  );
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'eligible');
});

test('completed test 1ms past the validity boundary → expired', () => {
  const r = evaluatePatchTestEligibility(
    [
      {
        date: new Date(colour.getTime() - (PATCH_TEST_VALIDITY_DAYS * DAY + 1)),
        status: 'COMPLETED',
      },
    ],
    colour,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test(`completed test ${PATCH_TEST_VALIDITY_DAYS + 1} days before → expired (past validity boundary)`, () => {
  const r = evaluatePatchTestEligibility(
    [{ date: new Date(colour.getTime() - (PATCH_TEST_VALIDITY_DAYS + 1) * DAY), status: 'COMPLETED' }],
    colour,
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
});

test('mixed too_soon + expired (none qualifying) → too_soon takes precedence', () => {
  const r = evaluatePatchTestEligibility([
    { date: new Date(colour.getTime() - 24 * HOUR), status: 'COMPLETED' }, // too_soon
    { date: new Date(colour.getTime() - 200 * DAY), status: 'COMPLETED' }, // expired
  ], colour);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_soon');
});
