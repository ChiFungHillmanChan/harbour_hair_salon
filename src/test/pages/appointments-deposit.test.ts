import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import { formatGBP } from '../../app/services/pricing/money';
import type { Locale } from '../../i18n/config';
import { publicGateStub } from '../booking-gate-stub';

// My Bookings shows each booking's card deposit by what happened to the money
// (lib/deposit-display.ts): held, paid, refund pending, refunded, released or
// kept. Only that state and amount reach the browser — never Square ids.

type Card = { id: string; deposit: unknown } & Record<string, unknown>;

async function cards(rows: Record<string, unknown>[]) {
  const card = () => null;
  const selects: unknown[] = [];
  const page = loadServerModule<typeof import('../../app/[locale]/appointments/page')>('src/app/[locale]/appointments/page.tsx', {
    '@/components/admin/Pagination': { Pagination: () => null },
    '@/app/lib/prisma': {
      user: { findUnique: async () => ({ email: 'customer@example.com', emailVerifiedAt: new Date('2026-01-01T00:00:00Z'), oauthAccounts: [] }) }, 
      appointment: { findMany: async ({ where, select }: { where: { OR?: unknown }; select: unknown }) => { selects.push(select); return where.OR ? [] : rows; } },
    },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'user-1' }) },
    '@/app/lib/booking-maintenance': publicGateStub({ isBookingEnabled: async () => true }),
    '@/components/appointments/AppointmentCard': { AppointmentCard: card },
    '@/components/auth/VerifyEmailResendForm': { VerifyEmailResendForm: () => null },
    '@/i18n/ClientMessages': { ClientMessages: ({ children }: { children: unknown }) => children },
    '@/i18n/server': { getLocale: async () => 'en-GB', getT: async (namespace: Namespace) => translator('en-GB', namespace) },
  });
  const found: Card[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: { appointment?: Card; children?: unknown } };
    if (element.type === card && element.props.appointment) found.push(element.props.appointment);
    visit(element.props.children);
  };
  visit(await page.default({}));
  return { cards: found, selects };
}

const row = (id: string, status: string, paymentAttempt: unknown) => ({
  id, status, date: new Date('2099-09-14T12:00:00Z'), stylistId: 'stylist-1', stylist: { name: 'Ivan' }, serviceId: 'service-1',
  service: { name: 'Cut', duration: 60 }, review: null, priceAtBooking: 100, quoteJson: null, durationAtBooking: 60,
  rescheduleRequestedDate: null, rescheduleRequestedAt: null, notificationVersion: 1, paymentAttempt,
});
const taken = (refunds: { status: string; amountPence: number }[] = []) => ({ status: 'CAPTURED', amountPence: 2000, refunds, squarePaymentId: 'square-secret' });

test('each booking’s deposit reaches My Bookings as a state and an amount only', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const { cards: shown, selects } = await cards([
    row('held', 'PENDING', { status: 'AUTHORIZED', amountPence: 2000, refunds: [], squarePaymentId: 'square-secret' }),
    row('paid', 'CONFIRMED', taken()),
    row('refunding', 'CANCELLED', taken([{ status: 'PENDING', amountPence: 2000 }])),
    row('refunded', 'CANCELLED', taken([{ status: 'COMPLETED', amountPence: 2000 }])),
    // Staff kept it when they cancelled: recorded on the deposit (KEPT).
    row('kept', 'CANCELLED', { ...taken(), status: 'KEPT' }),
    row('released', 'CANCELLED', { status: 'VOIDED', amountPence: 2000, refunds: [] }),
    row('none', 'CONFIRMED', null),
  ]);
  assert.deepEqual(Object.fromEntries(shown.map((card) => [card.id, card.deposit])), {
    held: { state: 'HELD', amountPence: 2000 },
    paid: { state: 'PAID', amountPence: 2000 },
    refunding: { state: 'REFUND_PENDING', amountPence: 2000 },
    refunded: { state: 'REFUNDED', amountPence: 2000 },
    kept: { state: 'KEPT', amountPence: 2000 },
    released: { state: 'RELEASED', amountPence: 2000 },
    none: null,
  });
  assert.ok(!JSON.stringify(shown).includes('square-secret'), 'no Square id reaches the page');
  // The query asks for the deposit's state and refunds, never its Square ids.
  for (const select of selects as { paymentAttempt: { select: Record<string, unknown> } }[]) {
    assert.deepEqual(Object.keys(select.paymentAttempt.select).sort(), ['amountPence', 'refunds', 'status']);
  }
});

/** The card itself, with its hooks replaced; `confirmations` records what window.confirm asked. */
function renderCard(appointment: Record<string, unknown>, locale: Locale = 'en-GB', options: { agree?: boolean; answer?: Record<string, unknown> } = {}) {
  const confirmations: string[] = [];
  const cancelled: string[] = [];
  const cancelOptions: unknown[] = [];
  const stateUpdates: unknown[] = [];
  const { AppointmentCard } = loadServerModule<typeof import('../../components/appointments/AppointmentCard')>('src/components/appointments/AppointmentCard.tsx', {
    react: { useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, (next: unknown) => { stateUpdates.push(next); }] },
    'next/navigation': { useRouter: () => ({ refresh: () => undefined }) },
    '@/app/actions/booking': {
      cancelAppointment: async (id: string, cancelWith?: unknown) => { cancelled.push(id); cancelOptions.push(cancelWith); return options.answer ?? { success: true }; },
      withdrawRescheduleRequest: async () => ({ success: true }),
    },
    '@/components/pricing/PriceParts': { useFormatPrice: () => (pence: number) => formatGBP(pence, locale === 'zh-HK' ? 'zh-HK' : 'en-GB') },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale },
    '@/i18n/draft-store': { useDraftState: (_key: string, initial: unknown) => [initial, () => undefined] },
    '@/i18n/link': { default: () => null },
    './RescheduleModal': { RescheduleModal: () => null },
  });
  const tree = AppointmentCard({
    appointment: {
      id: 'appointment-1', date: '2099-09-14T12:00:00.000Z', status: 'CONFIRMED', stylist: { name: 'Ivan' }, stylistId: 'stylist-1',
      service: { name: 'Cut', duration: 60 }, serviceId: 'service-1', price: { known: true, amountPence: 10000, priceType: null, vatDisplay: null, priceNature: null },
      request: { state: 'none' }, calendar: null, ...appointment,
    } as never,
    isUpcoming: true,
    bookingEnabled: true,
  });
  const nodes: { type: unknown; props: Record<string, unknown> }[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as { type: unknown; props: Record<string, unknown> };
    nodes.push(element);
    walk(element.props.children);
  };
  walk(tree);
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    if (!node || typeof node !== 'object' || !('props' in node)) return '';
    return text((node as { props: { children?: unknown } }).props.children);
  };
  const cancel = async () => {
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { confirm: (message: string) => { confirmations.push(message); return options.agree ?? false; } };
    try {
      const button = nodes.find((node) => node.type === 'button' && /Cancel|Withdraw|取消|撤回/.test(text(node)));
      await (button!.props.onClick as () => Promise<void>)();
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  };
  return { all: text(tree), confirmations, cancelled, cancelOptions, stateUpdates, cancel };
}

test('the card says what happened to the deposit, and cancelling says what will happen to it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const paid = renderCard({ deposit: { state: 'PAID', amountPence: 2000 } });
  assert.match(paid.all, /Deposit paid: £20\.00\./);
  await paid.cancel();
  assert.deepEqual(paid.confirmations, ['Cancel this appointment? Your £20.00 deposit will be refunded in full.']);
  assert.deepEqual(paid.cancelled, [], 'nothing happens until the customer agrees');

  const held = renderCard({ status: 'PENDING', deposit: { state: 'HELD', amountPence: 2000 } });
  assert.match(held.all, /Deposit: £20\.00 held on your card, not taken yet\./);
  await held.cancel();
  assert.deepEqual(held.confirmations, ['Withdraw this request? The £20.00 hold on your card will be released.']);

  const refunding = renderCard({ status: 'CANCELLED', deposit: { state: 'REFUND_PENDING', amountPence: 2000 } });
  assert.match(refunding.all, /Most banks show refunds within 5–10 working days; some take up to 14\./);

  const none = renderCard({});
  assert.doesNotMatch(none.all, /Deposit/);
  await none.cancel();
  assert.deepEqual(none.confirmations, ['Are you sure you want to cancel this appointment?']);

  const kept = renderCard({ status: 'CANCELLED', deposit: { state: 'KEPT', amountPence: 2000 } });
  assert.match(kept.all, /Deposit: £20\.00 kept under our booking terms\./, 'under the terms — never "as agreed"');
  const chinese = renderCard({ deposit: { state: 'KEPT', amountPence: 2000 } }, 'zh-HK');
  assert.match(chinese.all, /訂金：根據我們的預約條款，£20\.00 不予退還。/);
});

// A booking the salon cancelled because the customer was late (Admin →
// Settings switch): My Bookings says so, instead of a plain "Cancelled".
test('My Bookings labels a late-arrival cancellation, and only that', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-01T12:00:00Z') });
  const { cards: shown, selects } = await cards([
    { ...row('late', 'CANCELLED', null), lateCancelledAt: new Date('2099-09-14T12:20:00Z') },
    row('plain', 'CANCELLED', null),
  ]);
  const byId = Object.fromEntries(shown.map((card) => [card.id, card]));
  assert.equal(byId.late.lateCancelled, true);
  assert.equal(byId.plain.lateCancelled, false);
  for (const select of selects as { lateCancelledAt?: boolean }[]) assert.equal(select.lateCancelledAt, true);

  const label = { 'en-GB': ['Cancelled — more than 15 minutes late', 'Cancelled'], 'zh-HK': ['已取消 — 遲到超過 15 分鐘', '已取消'] } as const;
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    assert.ok(renderCard({ status: 'CANCELLED', lateCancelled: true }, locale).all.includes(label[locale][0]), locale);
    const plain = renderCard({ status: 'CANCELLED' }, locale).all;
    assert.ok(plain.includes(label[locale][1]) && !plain.includes(label[locale][0]), locale);
    // A restored booking is CONFIRMED again; a stale flag never labels it.
    assert.ok(!renderCard({ status: 'CONFIRMED', lateCancelled: true }, locale).all.includes(label[locale][0]), locale);
  }
});

// Owner decision 2026-10-18: a taken deposit is refunded in full for a
// cancellation 48 hours or more ahead and kept after that. The confirm step
// says which before the customer agrees, and tells the server what it said.
test('cancelling inside 48 hours says plainly that the deposit is kept, and the server is told it was said', async (t) => {
  // The card's booking starts 2099-09-14T12:00Z.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-12T13:00:00Z') }); // 47 hours ahead
  const kept = renderCard({ deposit: { state: 'PAID', amountPence: 2000 } }, 'en-GB', { agree: true });
  assert.match(kept.all, /Your appointment is less than 48 hours away: if you cancel now, your deposit is kept\./);
  await kept.cancel();
  assert.deepEqual(kept.confirmations, ['Cancel this appointment? It is less than 48 hours away: cancelling now, your £20.00 deposit is kept and not refunded.']);
  assert.deepEqual(kept.cancelOptions, [{ depositKept: true }]);

  const chinese = renderCard({ deposit: { state: 'PAID', amountPence: 2000 } }, 'zh-HK');
  await chinese.cancel();
  assert.deepEqual(chinese.confirmations, ['確定要取消此預約嗎？距離預約已不足 48 小時：現在取消，你的 £20.00 訂金將不予退還。']);
});

test('cancelling 48 hours or more ahead promises the full refund, and says until when', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-12T12:00:00Z') }); // exactly 48 hours ahead
  const refund = renderCard({ deposit: { state: 'PAID', amountPence: 2000 } }, 'en-GB', { agree: true });
  // 2099-09-12T12:00Z is 13:00 in London (BST).
  assert.match(refund.all, /Cancel by .*12 September 2099, 13:00 for a full refund of your deposit\. After that, the deposit is kept if you cancel\./);
  await refund.cancel();
  assert.deepEqual(refund.confirmations, ['Cancel this appointment? Your £20.00 deposit will be refunded in full.']);
  assert.deepEqual(refund.cancelOptions, [{ depositKept: false }]);
  const chinese = renderCard({ deposit: { state: 'PAID', amountPence: 2000 } }, 'zh-HK');
  assert.match(chinese.all, /於.+13:00或之前取消，訂金可全數退還；其後取消，訂金不予退還。/);
});

test('if the 48-hour deadline passed while the confirm step was open, the refusal switches the card to the kept wording', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-12T11:00:00Z') });
  const late = renderCard({ deposit: { state: 'PAID', amountPence: 2000 } }, 'en-GB', {
    agree: true, answer: { success: false, code: 'DEPOSIT_NOW_KEPT', error: 'It is now less than 48 hours before your appointment…' },
  });
  await late.cancel();
  assert.deepEqual(late.cancelOptions, [{ depositKept: false }]);
  assert.ok(late.stateUpdates.includes(true), 'refundDeadlinePassed is set, so the next confirm says "kept"');
});

test('a request\'s hold and a booking without a deposit are unaffected by the 48-hour rule', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-09-13T12:00:00Z') }); // 24 hours ahead
  const held = renderCard({ status: 'PENDING', deposit: { state: 'HELD', amountPence: 2000 } }, 'en-GB', { agree: true });
  assert.doesNotMatch(held.all, /less than 48 hours|Cancel by/);
  await held.cancel();
  assert.deepEqual(held.confirmations, ['Withdraw this request? The £20.00 hold on your card will be released.']);
  assert.deepEqual(held.cancelOptions, [{ depositKept: false }]);
  const none = renderCard({}, 'en-GB', { agree: true });
  await none.cancel();
  assert.deepEqual(none.confirmations, ['Are you sure you want to cancel this appointment?']);
});
