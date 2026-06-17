// Pure, dependency-free eligibility logic for the colour-booking patch-test gate.
export const PATCH_TEST_MIN_LEAD_HOURS = 48;
export const PATCH_TEST_VALIDITY_DAYS = 183; // ~6 months

export interface PatchTestRecord {
  date: Date;
  status: string; // appointment status
}

export type EligibilityReason =
  | 'eligible' | 'none' | 'not_completed' | 'too_soon' | 'expired';

export interface EligibilityResult {
  ok: boolean;
  testDate: Date | null;
  reason: EligibilityReason;
}

export function evaluatePatchTestEligibility(
  tests: PatchTestRecord[],
  colourDate: Date,
): EligibilityResult {
  if (tests.length === 0) return { ok: false, testDate: null, reason: 'none' };

  const completed = tests
    .filter((t) => t.status === 'COMPLETED')
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // most recent first

  if (completed.length === 0) return { ok: false, testDate: null, reason: 'not_completed' };

  const minLeadMs = PATCH_TEST_MIN_LEAD_HOURS * 3600_000;
  const validityMs = PATCH_TEST_VALIDITY_DAYS * 24 * 3600_000;
  const target = colourDate.getTime();

  let sawTooSoon = false;
  let sawExpired = false;

  for (const t of completed) {
    const lead = target - t.date.getTime();
    if (lead < minLeadMs) { sawTooSoon = true; continue; }   // test too close to (or after) colour date
    if (lead > validityMs) { sawExpired = true; continue; }  // test older than validity window
    return { ok: true, testDate: t.date, reason: 'eligible' };
  }

  if (sawTooSoon) return { ok: false, testDate: null, reason: 'too_soon' };
  if (sawExpired) return { ok: false, testDate: null, reason: 'expired' };
  return { ok: false, testDate: null, reason: 'none' };
}
