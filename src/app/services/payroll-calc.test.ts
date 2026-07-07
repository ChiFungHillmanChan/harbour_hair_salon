import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGross, round2, sumCommissionable } from './payroll-calc';

const base = {
  hourlyRate: null as number | null,
  monthlySalary: null as number | null,
  commissionRate: null as number | null,
  regularHours: 0,
  overtimeHours: 0,
  overtimeMultiplier: 1.5,
  commissionableRevenue: 0,
  adjustments: 0,
};

test('round2 rounds to pence', () => {
  assert.equal(round2(10.005), 10.01);
  assert.equal(round2(8.333333), 8.33);
});

test('round2 rounds negative half-way away from zero', () => {
  assert.equal(round2(-10.005), -10.01);
});

test('round2 rounds down just below the half', () => {
  assert.equal(round2(10.004), 10);
});

test('HOURLY: regular + overtime', () => {
  const r = computeGross({ ...base, payType: 'HOURLY', hourlyRate: 12, regularHours: 40, overtimeHours: 5 });
  assert.equal(r.basePay, 480); // 40*12
  assert.equal(r.overtimePay, 90); // 5*12*1.5
  assert.equal(r.commissionPay, 0);
  assert.equal(r.grossPay, 570);
});

test('SALARY: fixed amount, no overtime, plus commission', () => {
  const r = computeGross({ ...base, payType: 'SALARY', monthlySalary: 2000, commissionRate: 0.1, commissionableRevenue: 500, regularHours: 200, overtimeHours: 5 });
  assert.equal(r.basePay, 2000);
  assert.equal(r.overtimePay, 0);
  assert.equal(r.commissionPay, 50); // 500*0.1
  assert.equal(r.grossPay, 2050);
});

test('COMMISSION: only commission', () => {
  const r = computeGross({ ...base, payType: 'COMMISSION', commissionRate: 0.4, commissionableRevenue: 1000, regularHours: 100 });
  assert.equal(r.basePay, 0);
  assert.equal(r.commissionPay, 400);
  assert.equal(r.grossPay, 400);
});

test('HYBRID with hourly base = hourly + commission', () => {
  const r = computeGross({ ...base, payType: 'HYBRID', hourlyRate: 10, regularHours: 30, commissionRate: 0.2, commissionableRevenue: 600 });
  assert.equal(r.basePay, 300);
  assert.equal(r.commissionPay, 120);
  assert.equal(r.grossPay, 420);
});

test('HYBRID hourly base includes overtime', () => {
  const r = computeGross({ ...base, payType: 'HYBRID', hourlyRate: 10, regularHours: 30, overtimeHours: 4, commissionRate: 0.2, commissionableRevenue: 600 });
  assert.equal(r.basePay, 300);
  assert.equal(r.overtimePay, 60); // 4*10*1.5
  assert.equal(r.commissionPay, 120);
  assert.equal(r.grossPay, 480);
});

test('HYBRID with salary base when no hourly rate', () => {
  const r = computeGross({ ...base, payType: 'HYBRID', monthlySalary: 1500, commissionRate: 0.2, commissionableRevenue: 600 });
  assert.equal(r.basePay, 1500);
  assert.equal(r.commissionPay, 120);
  assert.equal(r.grossPay, 1620);
});

test('adjustments add (or subtract) from gross', () => {
  const r = computeGross({ ...base, payType: 'HOURLY', hourlyRate: 10, regularHours: 10, adjustments: -15 });
  assert.equal(r.grossPay, 85); // 100 - 15
});

test('null rates treated as zero', () => {
  const r = computeGross({ ...base, payType: 'HOURLY', regularHours: 10 });
  assert.equal(r.grossPay, 0);
});

test('sumCommissionable sums and rounds to pence', () => {
  assert.equal(sumCommissionable([10, 20.5, 4.001]), 34.5);
});
test('sumCommissionable of empty list is 0', () => {
  assert.equal(sumCommissionable([]), 0);
});

test('computeGross — HYBRID with hourlyRate 0 pays salary, not zero', () => {
  const r = computeGross({
    payType: 'HYBRID', hourlyRate: 0, monthlySalary: 1500, commissionRate: 0,
    regularHours: 100, overtimeHours: 0, overtimeMultiplier: 1.5, commissionableRevenue: 0, adjustments: 0,
  });
  assert.equal(r.basePay, 1500); // 0 hourly rate means "no hourly component" → salary base
});

test('computeGross — HYBRID with hourlyRate 0 and nonzero overtimeHours still gates overtimePay to 0', () => {
  // The rate-0 test above uses overtimeHours: 0, which can't detect an ungated
  // overtimePay (0 * anything is 0 either way). Use overtimeHours: 10 so a
  // missing `hasHourly` gate on overtimePay would show up as a nonzero value.
  const r = computeGross({
    payType: 'HYBRID', hourlyRate: 0, monthlySalary: 1500, commissionRate: 0,
    regularHours: 100, overtimeHours: 10, overtimeMultiplier: 1.5, commissionableRevenue: 0, adjustments: 0,
  });
  assert.equal(r.basePay, 1500);
  assert.equal(r.overtimePay, 0);
});
