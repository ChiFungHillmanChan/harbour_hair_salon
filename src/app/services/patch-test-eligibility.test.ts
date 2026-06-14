import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePatchTestEligibility, PATCH_TEST_MIN_LEAD_HOURS } from './patch-test-eligibility';

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
