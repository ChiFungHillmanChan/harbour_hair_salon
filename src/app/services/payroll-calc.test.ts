import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGross, round2 } from './payroll-calc';

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
