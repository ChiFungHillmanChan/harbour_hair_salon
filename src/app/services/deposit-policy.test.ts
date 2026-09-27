import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDepositPence, poundsFromPence, type DepositPolicyInput } from './deposit-policy';

function policy(overrides: Partial<DepositPolicyInput> = {}): DepositPolicyInput {
  return {
    enabled: true,
    servicePricePence: 10000,
    depositPercent: 20,
    minimumServicePence: 5000,
    overridePence: null,
    ...overrides,
  };
}

test('disabled deposits and a free service never require payment', () => {
  assert.equal(calculateDepositPence(policy({ enabled: false, overridePence: 2000 })), 0);
  assert.equal(calculateDepositPence(policy({ servicePricePence: 0, overridePence: 2000 })), 0);
});

test('percentage applies to net price only at or above the minimum service price', () => {
  assert.equal(calculateDepositPence(policy({ servicePricePence: 4999 })), 0);
  assert.equal(calculateDepositPence(policy({ servicePricePence: 5000 })), 1000);
  assert.equal(calculateDepositPence(policy({ servicePricePence: 8000 })), 1600);
});

test('an explicit fixed override takes precedence over the percentage and threshold', () => {
  assert.equal(calculateDepositPence(policy({ overridePence: 2500 })), 2500);
  assert.equal(calculateDepositPence(policy({ overridePence: 0 })), 0);
  assert.equal(calculateDepositPence(policy({ servicePricePence: 3000, overridePence: 1000 })), 1000);
});

test('fixed deposits are capped at the net amount the customer owes', () => {
  assert.equal(calculateDepositPence(policy({ servicePricePence: 1500, overridePence: 5000 })), 1500);
});

test('percentage deposits round half a penny up and accept fractional percentages', () => {
  assert.equal(calculateDepositPence(policy({ servicePricePence: 999, minimumServicePence: 0, depositPercent: 33 })), 330);
  assert.equal(calculateDepositPence(policy({ servicePricePence: 5000, depositPercent: 0.29 })), 15);
  assert.equal(calculateDepositPence(policy({ servicePricePence: 1500, minimumServicePence: 0, depositPercent: 12.5 })), 188);
  assert.equal(calculateDepositPence(policy({ depositPercent: 0 })), 0);
  assert.equal(calculateDepositPence(policy({ depositPercent: 100 })), 10000);
});

test('valid safe-integer prices keep exact rounding without overflowing intermediate arithmetic', () => {
  assert.equal(calculateDepositPence(policy({ servicePricePence: Number.MAX_SAFE_INTEGER, depositPercent: 100 })), Number.MAX_SAFE_INTEGER);
  assert.equal(calculateDepositPence(policy({ servicePricePence: Number.MAX_SAFE_INTEGER, depositPercent: 50 })), 4503599627370496);
  assert.equal(calculateDepositPence(policy({ servicePricePence: Number.MAX_SAFE_INTEGER, depositPercent: 0.0000001 })), 9007199);
});

test('every money input rejects negative, fractional, nonfinite and unsafe pence', () => {
  for (const field of ['servicePricePence', 'minimumServicePence', 'overridePence'] as const) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => calculateDepositPence(policy({ [field]: value })), new RegExp(field));
    }
  }
});

test('percentage validation rejects values outside zero to one hundred', () => {
  for (const value of [-0.01, 100.01, NaN, Infinity]) {
    assert.throws(() => calculateDepositPence(policy({ depositPercent: value })), /depositPercent/);
  }
});

test('invalid policy values cannot be hidden behind disabled deposits or a fixed override', () => {
  assert.throws(() => calculateDepositPence(policy({ enabled: false, servicePricePence: -1 })), /servicePricePence/);
  assert.throws(() => calculateDepositPence(policy({ overridePence: 1000, depositPercent: 101 })), /depositPercent/);
});

test('pound display preserves exactly two decimals for every valid pence input', () => {
  assert.equal(poundsFromPence(0), '0.00');
  assert.equal(poundsFromPence(1), '0.01');
  assert.equal(poundsFromPence(1500), '15.00');
  assert.equal(poundsFromPence(6780), '67.80');
  assert.equal(poundsFromPence(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => poundsFromPence(value), /pence/);
  }
});
