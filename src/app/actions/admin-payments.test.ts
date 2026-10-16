import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { describeDepositRecheck } from '../services/deposit-recheck-copy';
import type { DepositCheckState, DepositRecheck } from '../services/payment-reconciliation';
import type { Locale } from '../../i18n/config';
import { attempt, minutes, NOW, paymentsDb, refund } from '../../test/payments-fixture';

// Admin → Schedule → "Re-check payment" (phase S4): administrators only,
// audited, answered in the admin's language.

const CHECKED: DepositRecheck = {
  kind: 'CHECKED', state: 'PAID', amountPence: 2000, reached: true,
  refunds: [{ status: 'PENDING', amountPence: 2000 }],
  before: { status: 'CAPTURED', refunds: ['UNKNOWN'] }, after: { status: 'CAPTURED', refunds: ['PENDING'] },
};

function load(options: { role?: string; locale?: Locale; result?: DepositRecheck | Error; auditFails?: boolean } = {}) {
  const rechecked: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const revalidated: string[] = [];
  const googlePushes: (string[] | undefined)[] = [];
  const action = loadServerModule<typeof import('./admin-payments')>('src/app/actions/admin-payments.ts', {
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/i18n/request': { getActionLocale: async () => options.locale ?? 'en-GB' },
    '@/app/services/stylist-ical-cache': { scheduleGoogleCalendarPush: (ids?: string[]) => { googlePushes.push(ids); } },
    '@/app/services/payment-reconciliation': {
      recheckAppointmentDeposit: async (id: string) => {
        rechecked.push(id);
        if (options.result instanceof Error) throw options.result;
        return options.result ?? CHECKED;
      },
    },
    '@/app/lib/audit': {
      appendAuditEvent: async (input: Record<string, unknown>) => {
        if (options.auditFails) throw new Error('database unavailable');
        audits.push(input);
      },
    },
    'next/cache': { revalidatePath: (path: string) => { revalidated.push(path); } },
  });
  return { action, rechecked, audits, revalidated, googlePushes };
}

test('only an administrator can re-check a payment; nothing is asked otherwise', async () => {
  const f = load({ role: 'USER' });
  assert.deepEqual(await f.action.recheckAppointmentPayment('appt-1'), { success: false, error: 'Not authorised' });
  assert.deepEqual([f.rechecked, f.audits, f.googlePushes], [[], [], []]);
  const g = load();
  for (const id of ['', 'a b', 'x'.repeat(129), 42 as unknown as string]) {
    assert.equal((await g.action.recheckAppointmentPayment(id)).success, false);
  }
  assert.deepEqual(g.rechecked, []);
});

test('a re-check is audited and answered in the admin\'s language', async () => {
  const f = load();
  const result = await f.action.recheckAppointmentPayment('appt-1');
  assert.deepEqual(result, { success: true, lines: ['The £20.00 deposit has been taken.', 'Refund of £20.00: accepted by Square, on its way to the customer'] });
  assert.deepEqual(f.rechecked, ['appt-1']);
  assert.deepEqual(f.audits, [{
    actorUserId: 'admin-1', action: 'PAYMENT.RECHECKED', targetType: 'Appointment', targetId: 'appt-1',
    metadata: { result: 'PAID', reached: true, before: 'CAPTURED', after: 'CAPTURED', refundsBefore: 'UNKNOWN', refundsAfter: 'PENDING' },
  }]);
  assert.ok(f.revalidated.includes('/en-gb/admin') && f.revalidated.includes('/zh-hk/appointments'), 'the board and My Bookings follow');
  assert.deepEqual(f.googlePushes, [['appt-1']], 'and the deposit line of its Google Calendar event');

  const zh = await load({ locale: 'zh-HK' }).action.recheckAppointmentPayment('appt-1');
  assert.deepEqual(zh, { success: true, lines: ['已收取 £20.00 訂金。', '£20.00 退款：Square 已接受，正退回給顧客'] });
});

test('a re-check that fails says so and records nothing; a failed audit write does not hide the answer', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = load({ result: new Error('database unavailable') });
  assert.deepEqual(await failing.action.recheckAppointmentPayment('appt-1'), { success: false, error: 'The payment could not be re-checked just now. Nothing was changed; try again.' });
  assert.deepEqual(failing.audits, []);
  assert.deepEqual(failing.googlePushes, []);
  const unaudited = load({ auditFails: true });
  assert.equal((await unaudited.action.recheckAppointmentPayment('appt-1')).success, true);
});

test('every re-check answer reads as a sentence in both languages', () => {
  const states: DepositCheckState[] = ['HELD', 'HOLD_ENDED', 'RELEASE_PENDING', 'RELEASED', 'PAID', 'KEPT', 'TAKEN_NOT_CONFIRMED', 'TAKEN_ON_CANCELLED', 'LATE_CAPTURE', 'IN_PROGRESS', 'UNCONFIRMED', 'MISMATCH'];
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const lines = [
      ...describeDepositRecheck({ kind: 'NONE' }, locale),
      ...describeDepositRecheck({ kind: 'UNAVAILABLE', status: 'AUTHORIZED' }, locale),
      ...states.flatMap((state) => describeDepositRecheck({
        ...CHECKED, state, reached: false,
        refunds: ['REQUESTED', 'SUBMITTING', 'PENDING', 'COMPLETED', 'FAILED', 'REJECTED', 'UNKNOWN', 'UNRESOLVED', 'SETTLED_EXTERNALLY'].map((status) => ({ status, amountPence: 500 })),
      }, locale)),
    ];
    for (const line of lines) {
      assert.doesNotMatch(line, /deposit\.recheck|\{amount\}|\{status\}|undefined/, `${locale}: ${line}`);
      assert.ok(line.trim().length > 5, line);
    }
  }
  assert.deepEqual(describeDepositRecheck({ ...CHECKED, state: 'LATE_CAPTURE', refunds: [] }, 'en-GB'), ['Square took the £20.00 deposit after this booking had closed, so a full refund has been requested.']);
  // Review I-E: what staff can still do before the daily run refunds it by itself.
  assert.match(describeDepositRecheck({ ...CHECKED, state: 'TAKEN_NOT_CONFIRMED', refunds: [] }, 'en-GB')[0], /mark it completed if the customer came \(the deposit is kept\) or decline it \(the deposit is refunded\)\. Left open, it is refunded automatically 12 hours after the appointment ends\./);
  assert.match(describeDepositRecheck({ ...CHECKED, state: 'TAKEN_NOT_CONFIRMED', refunds: [] }, 'zh-HK')[0], /如一直未處理，訂金會在預約結束 12 小時後自動退還/);
  assert.match(describeDepositRecheck({ ...CHECKED, reached: false }, 'en-GB')[0], /Square could not be reached/);
});

// Review W-C (c): Admin → Schedule → booking → "Mark refund as settled outside
// the website": staff refunded the customer themselves (Square Dashboard, or
// cash), so the website must never send that refund to Square again.
function settleStore() {
  return paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'appt-1', status: 'CANCELLED', date: minutes(-24 * 60) }, { id: 'appt-2', status: 'CANCELLED', date: minutes(-24 * 60) }],
    attempts: [attempt({ id: 'a1', appointmentId: 'appt-1', status: 'CAPTURED' }), attempt({ id: 'a2', appointmentId: 'appt-2', status: 'CAPTURED' })],
    refunds: [
      refund({ id: 'r-unresolved', attemptId: 'a1', status: 'UNRESOLVED', updatedAt: minutes(-60) }),
      refund({ id: 'r-pending', attemptId: 'a2', status: 'PENDING', squareRefundId: 'sq-2' }),
    ],
  });
}

function loadSettle(options: { role?: string; locale?: Locale; store?: ReturnType<typeof paymentsDb>; db?: unknown } = {}) {
  const store = options.store ?? settleStore();
  const revalidated: string[] = [];
  const googlePushes: (string[] | undefined)[] = [];
  const action = loadServerModule<typeof import('./admin-payments')>('src/app/actions/admin-payments.ts', {
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/i18n/request': { getActionLocale: async () => options.locale ?? 'en-GB' },
    '@/app/services/stylist-ical-cache': { scheduleGoogleCalendarPush: (ids?: string[]) => { googlePushes.push(ids); } },
    '@/app/lib/prisma': { __esModule: true, default: options.db ?? store.db },
    'next/cache': { revalidatePath: (path: string) => { revalidated.push(path); } },
  });
  return { action, store, revalidated, googlePushes };
}

test('only an administrator can mark a refund settled outside the website; malformed ids are refused before the database', async () => {
  const customer = loadSettle({ role: 'USER' });
  assert.deepEqual(await customer.action.markRefundSettledOutside('appt-1', 'r-unresolved'), { success: false, error: 'Not authorised' });
  const admin = loadSettle();
  for (const [appointmentId, refundId] of [['', 'r-unresolved'], ['appt-1', 'a b'], ['appt-1', 'x'.repeat(129)], ['appt-1', 42 as unknown as string]]) {
    assert.equal((await admin.action.markRefundSettledOutside(appointmentId, refundId)).success, false);
  }
  assert.deepEqual([customer.store.calls, admin.store.calls, customer.googlePushes, admin.googlePushes], [[], [], [], []]);
  assert.equal(customer.store.tables.paymentRefund[0].status, 'UNRESOLVED');
});

test('marking a refund settled outside the website is audited, refreshes the board and My Bookings, and answers in the admin\'s language', async () => {
  const f = loadSettle();
  assert.deepEqual(await f.action.markRefundSettledOutside('appt-1', 'r-unresolved'), {
    success: true, message: 'The £20.00 refund is recorded as settled outside the website. The website will not ask Square for it again.',
  });
  assert.equal(f.store.tables.paymentRefund[0].status, 'SETTLED_EXTERNALLY');
  assert.deepEqual(f.store.tables.audit.map((row) => [row.action, row.actorUserId, row.targetId, row.metadata.from]), [['PAYMENT.REFUND_SETTLED_OUTSIDE', 'admin-1', 'r-unresolved', 'UNRESOLVED']]);
  assert.ok(f.revalidated.includes('/en-gb/admin') && f.revalidated.includes('/zh-hk/appointments'));
  assert.deepEqual(f.googlePushes, [['appt-1']], 'the deposit line of its Google Calendar event follows');
  const zh = await loadSettle({ locale: 'zh-HK' }).action.markRefundSettledOutside('appt-1', 'r-unresolved');
  assert.deepEqual(zh, { success: true, message: '這筆 £20.00 退款已記錄為已在網站以外處理。網站不會再就此向 Square 查詢。' });
});

test('a refund Square has answered, one being sent, another booking\'s, or a failure is refused and explained; nothing changes', async (t) => {
  t.mock.method(console, 'error', () => {});
  const f = loadSettle();
  assert.deepEqual(await f.action.markRefundSettledOutside('appt-2', 'r-pending'), {
    success: false, error: 'Square has already answered for this refund (accepted by Square, on its way to the customer), so it cannot be marked as settled outside the website.',
  });
  assert.deepEqual(await f.action.markRefundSettledOutside('appt-2', 'r-unresolved'), {
    success: false, error: 'This refund is not on this booking any more. Close the booking and open it again.',
  });
  const sending = paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'appt-1', status: 'CANCELLED', date: minutes(-60) }],
    attempts: [attempt({ id: 'a1', appointmentId: 'appt-1', status: 'CAPTURED' })],
    refunds: [refund({ id: 'r-sending', attemptId: 'a1', status: 'SUBMITTING', updatedAt: minutes(-1) })],
  });
  assert.match((await loadSettle({ store: sending }).action.markRefundSettledOutside('appt-1', 'r-sending') as { error: string }).error, /being sent to Square right now/);
  const broken = loadSettle({ db: { $transaction: async () => { throw new Error('database unavailable'); } } });
  assert.deepEqual(await broken.action.markRefundSettledOutside('appt-1', 'r-unresolved'), { success: false, error: 'The refund could not be marked just now. Nothing was changed; try again.' });
  assert.deepEqual([f.store.tables.paymentRefund.map((row) => row.status), f.store.tables.audit, f.revalidated, f.googlePushes], [['UNRESOLVED', 'PENDING'], [], [], []]);
});
