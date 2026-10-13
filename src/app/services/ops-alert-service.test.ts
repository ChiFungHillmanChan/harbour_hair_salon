import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectOpsFindings, opsAlertContent, sendDailyOpsAlert, type OpsFinding } from './ops-alert-service';
import { renderPlainText } from './email-content';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { attempt, paymentsDb, refund } from '../../test/payments-fixture';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

type Rows = {
  failed?: number;
  jobs?: { name: string; lastFailedAt: Date | null; lastSucceededAt: Date | null }[];
  connections?: { provider: string; lastSuccessAt: Date | null; lastError: string | null; stylist: { name: string } }[];
  pending?: { createdAt: Date }[];
  salonLocale?: string;
  /** Card deposits (payment-attention.ts); none by default. */
  payments?: ReturnType<typeof paymentsDb>;
};

function fakeDb(rows: Rows) {
  const calls: string[] = [];
  const payments = (rows.payments ?? paymentsDb({ now: () => NOW })).db;
  const db = {
    notificationDelivery: { count: async (args: unknown) => { calls.push(`deliveries ${JSON.stringify(args)}`); return rows.failed ?? 0; } },
    backgroundJobState: { findMany: async () => rows.jobs ?? [] },
    calendarConnection: { findMany: async () => { calls.push('connections'); return rows.connections ?? []; } },
    appointment: { findMany: async () => rows.pending ?? [] },
    siteSettings: { findUnique: async () => ({ salonNotificationLocale: rows.salonLocale ?? 'zh-HK' }) },
    paymentAttempt: payments.paymentAttempt,
    paymentRefund: payments.paymentRefund,
    squareWebhookEvent: payments.squareWebhookEvent,
  };
  return { db: db as never, calls };
}

test('a quiet day finds nothing and sends nothing', async () => {
  const { db } = fakeDb({
    jobs: [{ name: 'calendar-sync', lastFailedAt: hoursAgo(30), lastSucceededAt: hoursAgo(2) }],
    connections: [{ provider: 'FRESHA', lastSuccessAt: hoursAgo(12), lastError: null, stylist: { name: 'Ivan' } }],
  });
  let sent = 0;
  const result = await sendDailyOpsAlert({ db, now: NOW, calendarSyncEnabled: true, housekeepingEnabled: true, send: async () => { sent += 1; } });
  assert.deepEqual(result, { sent: false, findings: 0 });
  assert.equal(sent, 0);
});

test('failures, a failing job, broken or stale feeds and waiting requests are all reported', async () => {
  const { db } = fakeDb({
    failed: 2,
    jobs: [
      { name: 'housekeeping', lastFailedAt: hoursAgo(5), lastSucceededAt: hoursAgo(29) },
      { name: 'operations-readiness', lastFailedAt: hoursAgo(1), lastSucceededAt: null },
      { name: 'reminders', lastFailedAt: hoursAgo(80), lastSucceededAt: null },
    ],
    connections: [
      { provider: 'FRESHA', lastSuccessAt: hoursAgo(3), lastError: 'HTTP 404', stylist: { name: 'Lox' } },
      { provider: 'FRESHA', lastSuccessAt: hoursAgo(30), lastError: null, stylist: { name: 'Shania' } },
    ],
    pending: [{ createdAt: hoursAgo(20) }, { createdAt: hoursAgo(3) }],
  });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  assert.deepEqual(findings.map((f) => f.kind), ['DELIVERIES_FAILED', 'JOB_FAILING', 'CALENDAR_ERROR', 'CALENDAR_STALE', 'REQUESTS_WAITING']);
  const job = findings.find((f) => f.kind === 'JOB_FAILING') as Extract<OpsFinding, { kind: 'JOB_FAILING' }>;
  assert.equal(job.job, 'housekeeping', 'the readiness diagnostic and failures older than two days are left out');
  const waiting = findings.find((f) => f.kind === 'REQUESTS_WAITING') as Extract<OpsFinding, { kind: 'REQUESTS_WAITING' }>;
  assert.equal(waiting.count, 2);
});

test('feeds are not judged while calendar sync is switched off', async () => {
  const { db, calls } = fakeDb({ connections: [{ provider: 'FRESHA', lastSuccessAt: null, lastError: null, stylist: { name: 'Ivan' } }] });
  assert.deepEqual(await collectOpsFindings(db, NOW, { calendarSyncEnabled: false, housekeepingEnabled: true }), []);
  assert.ok(!calls.includes('connections'));
});

test('the alert goes once per London day, in the salon language, linking to Operations', async () => {
  const { db } = fakeDb({ failed: 1 });
  const sent: { subject: string; key: string; text: string }[] = [];
  const result = await sendDailyOpsAlert({ db, now: NOW, calendarSyncEnabled: true, housekeepingEnabled: true, send: async (content, key) => { sent.push({ subject: content.subject, key, text: renderPlainText(content) }); } });
  assert.deepEqual(result, { sent: true, findings: 1 });
  assert.equal(sent[0].key, 'ops-alert/2026-11-03');
  assert.match(sent[0].subject, /需要處理/);
  assert.match(sent[0].text, /\/zh-hk\/admin\/operations/);
});

test('English copy renders every finding without leaking raw keys', () => {
  const content = opsAlertContent([
    { kind: 'DELIVERIES_FAILED', count: 1 },
    { kind: 'JOB_FAILING', job: 'housekeeping', since: hoursAgo(5) },
    { kind: 'CALENDAR_ERROR', stylist: 'Lox', provider: 'FRESHA' },
    { kind: 'CALENDAR_STALE', stylist: 'Shania', provider: 'FRESHA', lastSuccessAt: null },
    { kind: 'REQUESTS_WAITING', count: 3, oldestCreatedAt: hoursAgo(20) },
  ], 'en-GB');
  const text = renderPlainText(content);
  assert.equal(content.subject, 'Harbour Hair: 5 things need attention');
  assert.match(text, /1 email could not be sent/);
  assert.match(text, /Lox’s Fresha calendar/);
  assert.match(text, /3 booking requests are waiting/);
  assert.doesNotMatch(text, /opsAlert\.|findings\./);
});

test('mail going out without housekeeping is itself something to fix', async () => {
  const { db } = fakeDb({});
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: false });
  assert.deepEqual(findings, [{ kind: 'HOUSEKEEPING_OFF' }]);
  assert.match(renderPlainText(opsAlertContent(findings, 'en-GB')), /HOUSEKEEPING_ENABLED/);
});

// Card deposits (phase S4, services/payment-attention.ts).
function depositRows() {
  const at = (hours: number) => ({ createdAt: hoursAgo(hours + 24), updatedAt: hoursAgo(hours) });
  const date = new Date(NOW.getTime() + 3 * 24 * 3_600_000);
  return paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'pending', status: 'PENDING', date }, { id: 'declined', status: 'CANCELLED', date }, { id: 'kept', status: 'CANCELLED', date }],
    attempts: [
      attempt({ id: 'taken', appointmentId: 'pending', status: 'CAPTURED', ...at(30) }),
      attempt({ id: 'unclear', status: 'CAPTURE_UNKNOWN', ...at(3) }),
      // Being cancelled by its key every day: handled, not flagged.
      attempt({ id: 'retrying', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_UNKNOWN_CANCELLING, ...at(3) }),
      // Too young: it may still settle by itself.
      attempt({ id: 'recent', status: 'UNKNOWN', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_OUTCOME_UNKNOWN, ...at(0.2) }),
      attempt({ id: 'stuck-hold', appointmentId: 'declined', status: 'AUTHORIZED', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED, ...at(2) }),
      // Taken on a cancelled booking with no refund and no record of keeping it.
      attempt({ id: 'unexplained', appointmentId: 'kept', status: 'CAPTURED', ...at(40) }),
      attempt({ id: 'refunded', status: 'CAPTURED', ...at(50) }),
    ],
    refunds: [
      refund({ id: 'failed', attemptId: 'refunded', status: 'FAILED', ...at(5) }),
      refund({ id: 'unanswered', attemptId: 'refunded', status: 'UNKNOWN', amountPence: 1, ...at(2) }),
      // Requested by last night's reconciliation: reported once.
      refund({ id: 'late', attemptId: 'refunded', status: 'PENDING', reason: 'LATE_CAPTURE', createdAt: hoursAgo(4), updatedAt: hoursAgo(4) }),
      // A failure from last month is no longer in the daily email.
      refund({ id: 'old-failure', attemptId: 'refunded', status: 'REJECTED', ...at(24 * 30) }),
    ],
    events: [
      { eventId: 'stranger', type: 'payment.created', objectId: 'pay-stranger', receivedAt: hoursAgo(3), processedAt: null },
      { eventId: 'settled', type: 'payment.updated', objectId: 'pay-taken', receivedAt: hoursAgo(3), processedAt: hoursAgo(3) },
    ],
  });
}

test('card deposits and refunds that need a person are one finding, counted by kind', async () => {
  const { db } = fakeDb({ payments: depositRows() });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  assert.deepEqual(findings, [{
    kind: 'PAYMENTS_NEED_ATTENTION', squareSetupRefused: 0, awaitingSquare: 1, takenNotConfirmed: 1, takenOnCancelled: 1, holdsNotReleased: 1,
    refundsFailed: 1, refundsUnresolved: 0, refundsUnconfirmed: 1, lateCaptures: 1, cardDeclines: 0, unmatchedNotifications: 1,
  }]);
});

// Review W-C: a refund Square never confirmed within 7 days is handed to staff.
test('a refund handed to staff (UNRESOLVED) is raised every day until it is settled, in both languages', async () => {
  const payments = paymentsDb({
    now: () => NOW,
    attempts: [attempt({ id: 'taken', status: 'CAPTURED' })],
    refunds: [refund({ id: 'given-up', attemptId: 'taken', status: 'UNRESOLVED', updatedAt: hoursAgo(24 * 20) })],
  });
  const { db } = fakeDb({ payments });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  assert.equal(findings[0]?.kind === 'PAYMENTS_NEED_ATTENTION' && findings[0].refundsUnresolved, 1);
  const english = renderPlainText(opsAlertContent(findings, 'en-GB'));
  assert.match(english, /1 refund was not confirmed by Square within 7 days, so the website stopped asking/);
  assert.match(english, /mark it settled outside the website/);
  const chinese = renderPlainText(opsAlertContent(findings, 'zh-HK'));
  assert.match(chinese, /有 1 筆退款在 7 日內仍未獲 Square 確認/);
  assert.doesNotMatch(chinese, /refundsUnresolved/);
});

// Review W-A: a 401/403/404 from Square is the website's Square setup. It is
// raised (first, from a single one) as a configuration problem — never counted
// among card declines or read as card testing.
test('Square refusing the website’s own setup is raised first, as a configuration problem, in both languages', async () => {
  const refused = attempt({ id: 'refused', status: 'FAILED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED, updatedAt: hoursAgo(2) });
  const { db } = fakeDb({ payments: paymentsDb({ now: () => NOW, attempts: [refused] }) });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind === 'PAYMENTS_NEED_ATTENTION' && findings[0].squareSetupRefused, 1);
  assert.equal(findings[0].kind === 'PAYMENTS_NEED_ATTENTION' && findings[0].cardDeclines, 0);
  const english = renderPlainText(opsAlertContent(findings, 'en-GB'));
  assert.match(english, /Square refused 1 deposit payment in the last 24 hours because of this website’s Square setup/);
  assert.doesNotMatch(english, /declined|stolen/);
  const chinese = renderPlainText(opsAlertContent(findings, 'zh-HK'));
  assert.match(chinese, /過去 24 小時 Square 因本網站的 Square 設定而拒絕了 1 筆訂金付款/);
  assert.doesNotMatch(chinese, /PAYMENTS_NEED_ATTENTION|squareSetupRefused/);
});

test('the payment lines read well in English and in Chinese, most urgent first', async () => {
  const { db } = fakeDb({ payments: depositRows() });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  const english = opsAlertContent(findings, 'en-GB');
  assert.equal(english.subject, 'Harbour Hair: 1 thing needs attention');
  assert.deepEqual(english.details.map((row) => row.label), Array(8).fill('Card deposits'));
  assert.match(english.details[0].value, /^1 deposit was taken for a booking request that is not confirmed/);
  // Review I-E: mark it completed (kept) or decline it (refunded) before the daily run refunds it.
  assert.match(english.details[0].value, /mark it completed if the customer came \(the deposit is kept\) or decline it \(the deposit is refunded\)\. If nobody does, it is refunded automatically 12 hours after the appointment ends\./);
  const text = renderPlainText(english);
  assert.match(text, /1 refund failed or was rejected in the last 7 days/);
  assert.match(text, /Square took 1 deposit after its booking had closed; a full refund was requested automatically/);
  assert.match(text, /1 Square notification in the last day matched no booking deposit or refund/);
  assert.doesNotMatch(text, /opsAlert\.|PAYMENTS_NEED_ATTENTION|findings\./);
  const chinese = renderPlainText(opsAlertContent(findings, 'zh-HK'));
  assert.match(chinese, /信用卡訂金/);
  assert.match(chinese, /有 1 筆訂金已經收取，但相關預約申請尚未確認/);
  assert.match(chinese, /如顧客已到店，請標示為已完成（保留訂金），否則請拒絕申請（退還訂金）。如無人處理，訂金會在預約結束 12 小時後自動退還/);
  assert.match(chinese, /過去 7 日有 1 筆退款失敗或被拒絕/);
  assert.doesNotMatch(chinese, /opsAlert\.|PAYMENTS_NEED_ATTENTION/);
});

test('settled deposits raise nothing', async () => {
  const date = new Date(NOW.getTime() + 3 * 24 * 3_600_000);
  const payments = paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'held', status: 'PENDING', date }, { id: 'paid', status: 'CONFIRMED', date }, { id: 'kept', status: 'CANCELLED', date }],
    attempts: [
      attempt({ id: 'held', appointmentId: 'held', updatedAt: hoursAgo(30) }),
      attempt({ id: 'paid', appointmentId: 'paid', status: 'CAPTURED', updatedAt: hoursAgo(30) }),
      attempt({ id: 'released', status: 'VOIDED', updatedAt: hoursAgo(30) }),
      attempt({ id: 'refunded', appointmentId: 'kept', status: 'CAPTURED', updatedAt: hoursAgo(30) }),
    ],
    refunds: [refund({ id: 'done', attemptId: 'refunded', status: 'COMPLETED', updatedAt: hoursAgo(20) })],
  });
  const { db } = fakeDb({ payments });
  assert.deepEqual(await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true }), []);
});

// Money-safety review I4: card testing shows up as a run of declines.
test('more card declines than usual in a day are raised in the daily email, in both languages', async () => {
  const declines = Array.from({ length: 6 }, (_, n) => attempt({
    id: `declined-${n}`, status: 'FAILED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED, updatedAt: hoursAgo(n + 1),
  }));
  const { db } = fakeDb({ payments: paymentsDb({ now: () => NOW, attempts: declines }) });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind === 'PAYMENTS_NEED_ATTENTION' && findings[0].cardDeclines, 6);
  assert.match(renderPlainText(opsAlertContent(findings, 'en-GB')), /6 card payments were declined in the last 24 hours/);
  assert.match(renderPlainText(opsAlertContent(findings, 'zh-HK')), /過去 24 小時有 6 筆信用卡付款被拒絕/);
  // Two declines are an ordinary day: no email for them alone.
  const { db: quiet } = fakeDb({ payments: paymentsDb({ now: () => NOW, attempts: declines.slice(0, 2) }) });
  assert.deepEqual(await collectOpsFindings(quiet, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true }), []);
});
