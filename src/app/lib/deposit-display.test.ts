import test from 'node:test';
import assert from 'node:assert/strict';
import { adminDepositView, depositView, SETTLEABLE_REFUND_STATUSES } from './deposit-display';
import { translator } from '../../i18n/messages';

const attempt = (status: string, refunds: { status: string; amountPence: number }[] = []) => ({ status, amountPence: 2000, refunds });

test('a deposit is shown by what happened to the money', () => {
  assert.deepEqual(depositView(attempt('AUTHORIZED')), { state: 'HELD', amountPence: 2000 });
  for (const status of ['CAPTURING', 'CAPTURE_UNKNOWN']) assert.deepEqual(depositView(attempt(status)), { state: 'PROCESSING', amountPence: 2000 }, status);
  assert.deepEqual(depositView(attempt('CAPTURED')), { state: 'PAID', amountPence: 2000 });
  assert.deepEqual(depositView(attempt('CAPTURED')), { state: 'PAID', amountPence: 2000 }, 'kept toward the bill');
  assert.deepEqual(depositView(attempt('KEPT')), { state: 'KEPT', amountPence: 2000 }, 'staff kept it when they cancelled');
  // Taken on a cancelled booking with neither a refund nor a keep recorded:
  // nobody decided to keep it (Operations flags it), so it is not called kept.
  assert.deepEqual(depositView(attempt('CAPTURED')), { state: 'PAID', amountPence: 2000 });
  for (const status of ['VOIDED', 'EXPIRED']) assert.deepEqual(depositView(attempt(status)), { state: 'RELEASED', amountPence: 2000 }, status);
});

test('refunds are shown honestly: on the way, back, or stuck', () => {
  for (const status of ['REQUESTED', 'SUBMITTING', 'PENDING', 'UNKNOWN']) {
    assert.deepEqual(depositView(attempt('CAPTURED', [{ status, amountPence: 2000 }])), { state: 'REFUND_PENDING', amountPence: 2000 }, status);
  }
  assert.deepEqual(depositView(attempt('CAPTURED', [{ status: 'COMPLETED', amountPence: 2000 }])), { state: 'REFUNDED', amountPence: 2000 });
  for (const status of ['FAILED', 'REJECTED']) {
    assert.deepEqual(depositView(attempt('CAPTURED', [{ status, amountPence: 2000 }])), { state: 'REFUND_FAILED', amountPence: 2000 }, status);
  }
  // A failed refund that was retried shows the retry.
  assert.deepEqual(depositView(attempt('CAPTURED', [{ status: 'FAILED', amountPence: 2000 }, { status: 'PENDING', amountPence: 2000 }])), { state: 'REFUND_PENDING', amountPence: 2000 });
  // Review W-C: one the website stopped retrying is still on its way as far as
  // anyone can tell; one staff settled outside the website is back.
  assert.deepEqual(depositView(attempt('CAPTURED', [{ status: 'UNRESOLVED', amountPence: 2000 }])), { state: 'REFUND_PENDING', amountPence: 2000 });
  assert.deepEqual(depositView(attempt('CAPTURED', [{ status: 'SETTLED_EXTERNALLY', amountPence: 2000 }])), { state: 'REFUNDED', amountPence: 2000 });
});

test('the admin board also names the refund staff may mark settled outside the website — and only such a refund', () => {
  const withRefund = (status: string) => ({ status: 'CAPTURED', amountPence: 2000, refunds: [{ id: `refund-${status}`, status, amountPence: 2000 }] });
  for (const status of ['REQUESTED', 'SUBMITTING', 'UNKNOWN', 'UNRESOLVED']) {
    assert.deepEqual(adminDepositView(withRefund(status)), { state: 'REFUND_PENDING', amountPence: 2000, refundToSettle: { id: `refund-${status}`, amountPence: 2000 } }, status);
  }
  for (const status of ['PENDING', 'COMPLETED', 'FAILED', 'REJECTED', 'SETTLED_EXTERNALLY']) {
    assert.equal(adminDepositView(withRefund(status))?.refundToSettle, undefined, status);
  }
  assert.equal(adminDepositView(null), null);
  assert.deepEqual(adminDepositView({ status: 'AUTHORIZED', amountPence: 2000, refunds: [] }), { state: 'HELD', amountPence: 2000 });
  // The customer's own view never carries it.
  assert.equal('refundToSettle' in (depositView(withRefund('UNKNOWN')) ?? {}), false);
  assert.deepEqual(SETTLEABLE_REFUND_STATUSES, ['REQUESTED', 'SUBMITTING', 'UNKNOWN', 'UNRESOLVED']);
});

test('nothing is shown for no deposit, or for an attempt that never held money', () => {
  for (const value of [null, undefined, attempt('FAILED'), attempt('UNKNOWN'), attempt('INITIATED'), { status: 'AUTHORIZED', amountPence: 0 }]) {
    assert.equal(depositView(value), null, JSON.stringify(value));
  }
});

test('every state has words for customers and staff, in both languages', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const customer = translator(locale, 'appointments');
    const staff = translator(locale, 'adminSchedule');
    for (const state of ['HELD', 'PROCESSING', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED', 'RELEASED', 'KEPT']) {
      assert.match(customer.dynamic(`deposit.${state}`, { amount: '£20.00' }), /£20\.00/, `${locale} customer ${state}`);
      assert.match(staff.dynamic(`deposit.chip.${state}`, { amount: '£20.00' }), /£20\.00/, `${locale} staff ${state}`);
    }
  }
});
