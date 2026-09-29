// STATUS: NOT WIRED. Square deposit foundation only — nothing in the booking
// flow calls this yet, and production online booking is locked closed until it
// does. See lib/online-booking-lock.ts (SQUARE_DEPOSITS_WIRED).

/** Policy inputs must come from trusted server pricing/settings before payment. */
export type DepositPolicyInput = {
  enabled: boolean;
  /** Net payable price after all offers and discounts, in integer GBP pence. */
  servicePricePence: number;
  depositPercent: number;
  minimumServicePence: number;
  /** Null uses the percentage policy; zero explicitly waives the deposit. */
  overridePence: number | null;
};

function assertPence(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a nonnegative safe integer in pence`);
  }
}

/** No salon policy is implicit here: callers must supply the approved settings. */
export function calculateDepositPence(input: DepositPolicyInput): number {
  assertPence(input.servicePricePence, 'servicePricePence');
  assertPence(input.minimumServicePence, 'minimumServicePence');
  if (input.overridePence !== null) assertPence(input.overridePence, 'overridePence');
  if (!Number.isFinite(input.depositPercent) || input.depositPercent < 0 || input.depositPercent > 100) {
    throw new RangeError('depositPercent must be between 0 and 100');
  }

  if (!input.enabled || input.servicePricePence === 0) return 0;
  if (input.overridePence !== null) return Math.min(input.overridePence, input.servicePricePence);
  if (input.servicePricePence < input.minimumServicePence) return 0;

  // Represent the percentage's decimal spelling exactly, including very small
  // percentages. Float multiplication can lose a penny at a half-penny boundary
  // (for example, 0.29% of 5000p) or overflow safe integer precision.
  const [coefficient, exponent = '0'] = String(input.depositPercent).split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const numerator = BigInt(whole + fraction);
  const denominator = BigInt(100) * BigInt(10) ** BigInt(fraction.length - Number(exponent));
  const rounded = (BigInt(input.servicePricePence) * numerator + denominator / BigInt(2)) / denominator;
  return Number(rounded);
}

export function poundsFromPence(pence: number): string {
  assertPence(pence, 'pence');
  const amount = BigInt(pence);
  return `${amount / BigInt(100)}.${String(amount % BigInt(100)).padStart(2, '0')}`;
}
