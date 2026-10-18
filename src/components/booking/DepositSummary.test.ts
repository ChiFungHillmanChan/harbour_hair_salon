import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import { formatGBP } from '../../app/services/pricing/money';
import type { Locale } from '../../i18n/config';
import { DEPOSIT_REFUND_NOTICE_HOURS } from '../../app/lib/booking-constants';

type Element = { type: unknown; props: Record<string, unknown> };

/** Every element in a tree (our components here have no hooks, so nothing needs rendering). */
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

const Link = (props: unknown) => props;
const ui = loadServerModule<typeof import('./DepositSummary')>('src/components/booking/DepositSummary.tsx', {
  '@/i18n/link': { __esModule: true, default: Link },
});
const t = (locale: Locale) => translator(locale, 'booking');
const price = (locale: Locale) => (pence: number) => formatGBP(pence, locale);

test('the summary shows the deposit taken if confirmed and the rest to pay in the salon', () => {
  const rows = elements(ui.DepositRows({ t: t('en-GB'), formatPrice: price('en-GB'), depositPence: 1250, remainderPence: 3750 }));
  const pairs = rows.filter((row) => row.type === 'dt').map((dt, index) => [text(dt), text(rows.filter((row) => row.type === 'dd')[index])]);
  assert.deepEqual(pairs, [['Deposit, taken if we confirm', '£12.50'], ['Pay the rest in the salon', '£37.50']]);
  const zh = elements(ui.DepositRows({ t: t('zh-HK'), formatPrice: price('zh-HK'), depositPence: 1250, remainderPence: 3750 }));
  assert.deepEqual(zh.filter((row) => row.type === 'dt').map(text), ['訂金（本店確認後才收取）', '餘款（於店內支付）']);
});

test('the rest carries the price’s own fine print when it is not exact', () => {
  const rest = (locale: Locale, facts: { vatDisplay?: string | null; priceNature?: string | null }) => {
    const rows = elements(ui.DepositRows({ t: t(locale), formatPrice: price(locale), depositPence: 1250, remainderPence: 3750, price: facts }));
    return text(rows.filter((row) => row.type === 'dd')[1]);
  };
  assert.equal(rest('en-GB', { vatDisplay: 'UNSPECIFIED', priceNature: 'LISTED' }), '£37.50', 'an exact price: no fine print');
  assert.equal(rest('en-GB', {}), '£37.50');
  assert.equal(rest('en-GB', { priceNature: 'SUBJECT_TO_CONSULTATION' }), '£37.50Final price confirmed at your consultation');
  assert.equal(rest('en-GB', { vatDisplay: 'EXCLUDED' }), '£37.50VAT excluded');
  assert.equal(rest('en-GB', { vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION' }), '£37.50VAT excluded · Final price confirmed at your consultation');
  assert.equal(rest('zh-HK', { vatDisplay: 'EXCLUDED', priceNature: 'SUBJECT_TO_CONSULTATION' }), '£37.50未含 VAT · 最終價錢於諮詢時確定');
});

// Owner decision 2026-10-18: a full refund 48 hours or more ahead; later, kept.
const DISCLOSURE = {
  'en-GB': [
    'You pay nothing now. We place a hold on your card and take the £12.50 deposit only when we confirm your booking; if we decline or don’t confirm your request, the hold is released.',
    `Cancel at least ${DEPOSIT_REFUND_NOTICE_HOURS} hours before your appointment for a full refund.`,
    'If you cancel less than 48 hours before your appointment, miss it, or are more than 15 minutes late without letting us know, we keep the deposit.',
  ],
  'zh-HK': [
    '你現在毋須付款。我們會先在你的信用卡預留款項，只有在本店確認你的預約後，才會收取 £12.50 訂金；如本店拒絕或未有確認你的申請，預留款項會被解除。',
    `於預約前最少 ${DEPOSIT_REFUND_NOTICE_HOURS} 小時取消可獲全數退款。`,
    '如你在預約前不足 48 小時取消、缺席預約，或遲到超過 15 分鐘而沒有通知本店，本店會保留訂金。',
  ],
} as const;
/** Less than 24 hours away: no online cancelling at all, and the deposit is kept. */
const SOON = {
  'en-GB': 'Your appointment is less than 24 hours away: once we confirm it, it can’t be cancelled online, and if you cancel, the deposit is kept.',
  'zh-HK': '你的預約距今不足 24 小時：本店確認後，預約將無法於網上取消；如你取消預約，訂金不予退還。',
} as const;
/** Less than 48 hours away: cancelling once confirmed keeps the deposit. */
const WITHIN_REFUND = {
  'en-GB': 'Your appointment is less than 48 hours away: once we confirm it, the deposit is kept if you cancel.',
  'zh-HK': '你的預約距今不足 48 小時：本店確認後，如你取消預約，訂金不予退還。',
} as const;

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`before the card form: nothing paid now, when it is taken, the 48-hour refund rule and when it is kept (${locale})`, () => {
    const tree = ui.DepositTerms({ t: t(locale), amount: '£12.50' });
    const nodes = elements(tree);
    const lines = nodes.filter((node) => node.type === 'p' || node.type === 'li').map(text);
    for (const line of DISCLOSURE[locale]) assert.ok(lines.includes(line), `${locale}: ${line}`);
    assert.ok(!text(tree).includes(SOON[locale]) && !text(tree).includes(WITHIN_REFUND[locale]), 'no short-notice warning for a time 48 hours or more away');
    assert.doesNotMatch(text(tree), /may keep|可能會保留/, 'no "may keep": the rule is decided');
  });

  test(`a time less than 48 hours away warns that the deposit is kept if cancelled once confirmed (${locale})`, () => {
    const nodes = elements(ui.DepositTerms({ t: t(locale), amount: '£12.50', startsWithinRefundNotice: true }));
    const warning = nodes.find((node) => text(node) === WITHIN_REFUND[locale]);
    assert.ok(warning, WITHIN_REFUND[locale]);
    assert.equal(warning.props.role, 'note');
    assert.ok(!nodes.some((node) => text(node) === SOON[locale]));
    for (const line of DISCLOSURE[locale]) assert.ok(nodes.some((node) => text(node) === line), line);
  });

  test(`a time less than 24 hours away says it can’t then be cancelled online and the deposit is kept (${locale})`, () => {
    const nodes = elements(ui.DepositTerms({ t: t(locale), amount: '£12.50', startsWithin24Hours: true, startsWithinRefundNotice: true }));
    const warning = nodes.find((node) => text(node) === SOON[locale]);
    assert.ok(warning, SOON[locale]);
    assert.equal(warning.props.role, 'note');
    assert.equal(nodes.filter((node) => node.props.role === 'note').length, 1, 'one warning, the stronger one');
    // The rules are still all there.
    for (const line of DISCLOSURE[locale]) assert.ok(nodes.some((node) => text(node) === line), line);
  });

  test(`the full booking terms open in a new tab, so the booking in progress is kept (${locale})`, () => {
    const link = elements(ui.DepositTerms({ t: t(locale), amount: '£12.50' })).find((element) => element.type === Link);
    assert.equal(link?.props.href, '/booking-terms');
    assert.equal(link?.props.target, '_blank');
    assert.equal(link?.props.rel, 'noopener noreferrer');
    const hint = elements(link).find((element) => element.type === 'span');
    assert.equal(hint?.props.className, 'sr-only', 'screen readers are told it opens a new tab');
    assert.equal(text(link), locale === 'en-GB' ? 'booking terms (opens in a new tab)' : '預約條款 （於新分頁開啟）');
  });
}

test('no card payments here: the salon phone instead of a card form', () => {
  const tree = ui.PaymentUnavailableNotice({ t: t('en-GB'), phone: '0113 496 0000' });
  assert.match(text(tree), /^Online payment isn’t available right now, so this booking can’t be made online\. Please call the salon on 0113 496 0000 to book\.$/);
  const call = elements(tree).find((element) => element.type === 'a');
  assert.equal(call?.props.href, 'tel:01134960000');
  assert.equal((tree as Element).props.role, 'status');
  assert.match(text(ui.PaymentUnavailableNotice({ t: t('zh-HK'), phone: '0113 496 0000' })), /請致電本店 0113 496 0000 預約/);
});
