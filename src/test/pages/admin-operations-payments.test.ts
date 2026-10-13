import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { OPERATIONS_MESSAGES } from '../../app/services/operations-messages';
import { attempt, minutes, NOW, paymentsDb, refund } from '../payments-fixture';

// Admin → Operations, "Payments needing attention" (phase S4,
// services/payment-attention.ts): what the website could not settle by itself,
// as metadata only — booking ids and times, amounts, states, ages — in the
// admin's language.

function rows() {
  const date = minutes(3 * 24 * 60);
  return paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'appt-pending', status: 'PENDING', date }, { id: 'appt-declined', status: 'CANCELLED', date }],
    attempts: [
      attempt({ id: 'taken', appointmentId: 'appt-pending', status: 'CAPTURED', updatedAt: minutes(-3 * 60) }),
      attempt({ id: 'held', appointmentId: 'appt-declined', status: 'AUTHORIZED', lastError: OPERATIONS_MESSAGES.PAYMENT_RELEASE_FAILED, updatedAt: minutes(-3 * 24 * 60) }),
      attempt({ id: 'unbooked', status: 'CAPTURED', amountPence: 1500 }),
    ],
    refunds: [refund({ id: 'r1', attemptId: 'unbooked', amountPence: 1500, status: 'FAILED', reason: 'LATE_CAPTURE', updatedAt: minutes(-5 * 60) })],
    events: [{ eventId: 'evt-1', type: 'payment.created', objectId: 'sq-payment-stranger', receivedAt: minutes(-2 * 60), processedAt: null }],
  });
}

async function render(locale: Locale, store = rows()) {
  const page = loadServerModule<typeof import('../../app/[locale]/admin/operations/page')>('src/app/[locale]/admin/operations/page.tsx', {
    '@/app/lib/session': { requireAdmin: async () => ({ userId: 'admin-1', role: 'ADMIN' }) },
    '@/app/lib/prisma': {
      backgroundJobState: { findMany: async () => [] },
      notificationDelivery: { findMany: async () => [] },
      auditEvent: { findMany: async () => [] },
      paymentAttempt: store.db.paymentAttempt,
      paymentRefund: store.db.paymentRefund,
      squareWebhookEvent: store.db.squareWebhookEvent,
    },
    '@/app/services/operations-readiness': { OPERATIONS_READINESS_JOB: 'operations-readiness', parseOperationsChecks: () => [] },
    '@/components/admin/OperationsControls': { OperationsControls: () => null },
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/i18n/link': { default: () => null },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  const tree = await page.default({ searchParams: Promise.resolve({}) });
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    if (!node || typeof node !== 'object' || !('props' in node)) return '';
    return text((node as { props: { children?: unknown } }).props.children);
  };
  const sections: { id?: string; text: string }[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { children?: unknown; 'aria-labelledby'?: string } };
    if (element.type === 'section') sections.push({ id: element.props['aria-labelledby'], text: text(element) });
    walk(element.props.children);
  };
  walk(tree);
  return { section: sections.find((entry) => entry.id === 'payments-attention')?.text ?? '', store };
}

test('payments needing attention are listed in English: what, how much, what to do, how long', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { section, store } = await render('en-GB');
  assert.match(section, /Payments needing attention/);
  assert.match(section, /Deposits/);
  assert.match(section, /appt-pending/);
  assert.match(section, /£20\.00/);
  // Review I-E: what to do before the daily run refunds it by itself.
  assert.match(section, /Taken, request not confirmed: confirm it, mark it completed if the customer came \(the deposit is kept\), or decline it \(refunded\)\. Still open 12 hours after the appointment ends: refunded automatically/);
  assert.match(section, /Hold not released yet/);
  assert.match(section, /3 hours ago/);
  assert.match(section, /3 days ago/);
  assert.match(section, /Releasing this deposit hold failed\./, 'its catalogued last error, translated');
  assert.match(section, /Refunds/);
  assert.match(section, /£15\.00/);
  assert.match(section, /Taken after the booking closed/);
  assert.match(section, /Refund failed: refund the customer another way/);
  assert.match(section, /No booking/);
  assert.match(section, /Square notifications that matched nothing/);
  assert.match(section, /sq-payment-stranger/);
  // Metadata only: never the customer, never card or user fields.
  for (const call of store.calls.filter((entry) => entry.method === 'findMany')) {
    const select = JSON.stringify((call.args as { select?: unknown }).select);
    assert.doesNotMatch(select, /user|email|name|phone|idempotencyKey|requestJson|policyJson/, select);
  }
});

test('the same section in Chinese, with nothing left in English but raw identifiers', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { section } = await render('zh-HK');
  assert.match(section, /需要處理的付款/);
  assert.match(section, /已收取，但申請未確認：請確認申請；如顧客已到店，請標示為已完成（保留訂金）；或拒絕申請（退還訂金）。預約結束 12 小時後仍未處理：會自動退款/);
  assert.match(section, /預留款項尚未解除/);
  assert.match(section, /3 小時前/);
  assert.match(section, /退款失敗：請以其他方式退款給顧客/);
  assert.match(section, /解除此訂金預留款項失敗/);
  assert.match(section, /未能對應的 Square 通知/);
  assert.doesNotMatch(section, /operations\.payments\.|Needs|Deposits|Refunds/);
});

test('card declines in the last 24 hours are counted on the page, in both languages', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const declined = paymentsDb({
    now: () => NOW,
    attempts: [1, 2].map((n) => attempt({ id: `declined-${n}`, status: 'FAILED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_DECLINED, updatedAt: minutes(-n * 60) })),
  });
  const english = await render('en-GB', declined);
  assert.match(english.section, /2 card payments were declined in the last 24 hours/);
  assert.match(english.section, /3 declines from one account, or 5 from one address/);
  const chinese = await render('zh-HK', declined);
  assert.match(chinese.section, /過去 24 小時有 2 筆信用卡付款被拒絕/);
  // None: no line at all.
  const { section } = await render('en-GB', paymentsDb({ now: () => NOW }));
  assert.doesNotMatch(section, /declined/);
});

// Review W-C: a refund handed to staff after 7 days of retries says what to do.
test('a refund the website stopped retrying (UNRESOLVED) is listed with what to do, in both languages', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const store = paymentsDb({
    now: () => NOW,
    appointments: [{ id: 'appt-cancelled', status: 'CANCELLED', date: minutes(-9 * 24 * 60) }],
    attempts: [attempt({ id: 'taken', appointmentId: 'appt-cancelled', status: 'CAPTURED' })],
    refunds: [refund({ id: 'given-up', attemptId: 'taken', status: 'UNRESOLVED', updatedAt: minutes(-2 * 24 * 60) })],
  });
  const english = await render('en-GB', store);
  assert.match(english.section, /Not confirmed by Square after 7 days/);
  assert.match(english.section, /Not confirmed after 7 days: refund by hand if needed, then mark it settled outside the website/);
  const chinese = await render('zh-HK', store);
  assert.match(chinese.section, /7 日後仍未獲 Square 確認/);
  assert.doesNotMatch(chinese.section, /operations\.payments\.|UNRESOLVED/);
});

// Review W-A: Square refusing the website's own access token, permissions or
// location is shown as a setup problem, apart from card declines.
test('Square refusing the website’s setup is shown as a configuration problem, never as declines, in both languages', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const refused = paymentsDb({
    now: () => NOW,
    attempts: [1, 2, 3].map((n) => attempt({ id: `refused-${n}`, status: 'FAILED', squarePaymentId: null, lastError: OPERATIONS_MESSAGES.PAYMENT_SETUP_REFUSED, updatedAt: minutes(-n * 60) })),
  });
  const english = await render('en-GB', refused);
  assert.match(english.section, /Square refused 3 deposit payments in the last 24 hours because of this website’s Square setup/);
  assert.doesNotMatch(english.section, /declined|Nothing needs attention/);
  const chinese = await render('zh-HK', refused);
  assert.match(chinese.section, /過去 24 小時 Square 因本網站的 Square 設定而拒絕了 3 筆訂金付款/);
});

test('a quiet day says so', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { section } = await render('en-GB', paymentsDb({ now: () => NOW }));
  assert.match(section, /Nothing needs attention\./);
  assert.doesNotMatch(section, /Deposits|Refunds/);
});
