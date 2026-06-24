import test from 'node:test';
import assert from 'node:assert/strict';
import { toPayrollCsv } from './payroll-csv';

const row = {
  employeeName: 'Jane Doe',
  payType: 'HOURLY',
  totalHours: 40,
  regularHours: 40,
  overtimeHours: 0,
  basePay: 480,
  overtimePay: 0,
  commissionPay: 0,
  adjustments: 0,
  grossPay: 480,
};

test('first line is the header row', () => {
  const csv = toPayrollCsv([row]);
  const lines = csv.split('\n');
  assert.equal(
    lines[0],
    'Employee,Pay Type,Total Hours,Regular Hours,Overtime Hours,Base Pay,Overtime Pay,Commission,Adjustments,Gross Pay',
  );
});

test('data rows follow the header', () => {
  const csv = toPayrollCsv([row]);
  const lines = csv.split('\n');
  assert.equal(lines[1], 'Jane Doe,HOURLY,40,40,0,480,0,0,0,480');
});

test('names containing commas are quoted', () => {
  const csv = toPayrollCsv([{ ...row, employeeName: 'Doe, Jane' }]);
  assert.ok(csv.includes('"Doe, Jane"'));
});

test('values with embedded double-quotes are escaped by doubling', () => {
  const csv = toPayrollCsv([{ ...row, employeeName: 'She said "hi"' }]);
  assert.ok(csv.includes('"She said ""hi"""'));
});

test('empty rows still emit the header', () => {
  assert.equal(toPayrollCsv([]).split('\n').length, 1);
});
