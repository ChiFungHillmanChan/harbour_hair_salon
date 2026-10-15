import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// "Mark refund as settled outside the website", next to Re-check payment in the
// booking dialog (review W-C): staff who refunded the customer themselves —
// in the Square Dashboard, or in cash — record it, so the website never sends
// that refund to Square again.

type Element = { type: unknown; props: Record<string, unknown> };
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

/** The component with React's state kept between renders, as React would; window.confirm answers `confirmed`. */
function mount(answer: () => Promise<unknown>, options: { locale?: Locale; confirmed?: boolean } = {}) {
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let refCursor = 0;
  const asked: [string, string][] = [];
  const questions: string[] = [];
  let refreshes = 0;
  const locale = options.locale ?? 'en-GB';
  const { DepositSettleRefundButton } = loadServerModule<typeof import('./DepositSettleRefundButton')>('src/components/admin/DepositSettleRefundButton.tsx', {
    react: {
      useState: (initial: unknown) => {
        const slot = cursor++;
        if (!(slot in state)) state[slot] = initial;
        return [state[slot], (next: unknown) => { state[slot] = next; }];
      },
      useRef: (initial: unknown) => {
        const slot = refCursor++;
        refs[slot] ??= { current: initial };
        return refs[slot];
      },
    },
    'next/navigation': { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    '@/i18n/client': { useT: () => translator(locale, 'adminSchedule') },
    '@/app/actions/admin-payments': { markRefundSettledOutside: async (appointmentId: string, refundId: string) => { asked.push([appointmentId, refundId]); return answer(); } },
  });
  // The refund the dialog offers: null once the refreshed deposit no longer has one to settle.
  let refund: { id: string; amountPence: number } | null = { id: 'refund-1', amountPence: 2000 };
  const render = () => {
    cursor = 0;
    refCursor = 0;
    return elements(DepositSettleRefundButton({ appointmentId: 'appt-1', refund }));
  };
  const click = async () => {
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { confirm: (message: string) => { questions.push(message); return options.confirmed ?? true; } };
    try {
      await (render().find((node) => node.type === 'button')!.props.onClick as () => Promise<void>)();
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  };
  return { render, click, asked, questions, refreshes: () => refreshes, offer: (next: typeof refund) => { refund = next; } };
}

test('asks first, with the amount; then records it, says so and refreshes the board', async () => {
  const m = mount(async () => ({ success: true, message: 'The £20.00 refund is recorded as settled outside the website. The website will not ask Square for it again.' }));
  let nodes = m.render();
  assert.equal(text(nodes.find((node) => node.type === 'button')), 'Mark refund as settled outside the website');
  assert.match(text(nodes), /£20\.00 refund/, 'what it is for, before anyone presses it');
  await m.click();
  assert.deepEqual(m.questions, ['Mark the £20.00 refund as settled outside the website? Do this only once the customer has the money back — refunded in the Square Dashboard or in cash. The website will never send this refund to Square again, and this cannot be undone here.']);
  assert.deepEqual(m.asked, [['appt-1', 'refund-1']]);
  assert.equal(m.refreshes(), 1);
  nodes = m.render();
  assert.match(text(nodes.find((node) => node.props.role === 'status')), /recorded as settled outside the website/);
});

test('saying no to the question changes nothing', async () => {
  const m = mount(async () => ({ success: true, message: 'never' }), { confirmed: false });
  await m.click();
  assert.equal(m.questions.length, 1);
  assert.deepEqual([m.asked, m.refreshes()], [[], 0]);
});

test('a refusal or a failure is shown, in the admin’s language, and nothing is refreshed', async () => {
  const refused = mount(async () => ({ success: false, error: 'This refund is being sent to Square right now.' }));
  await refused.click();
  assert.match(text(refused.render()), /being sent to Square right now/);
  assert.equal(refused.refreshes(), 0);
  const failed = mount(async () => { throw new Error('network'); }, { locale: 'zh-HK' });
  await failed.click();
  assert.match(failed.questions[0], /確定將這筆 £20\.00 退款標示為已在網站以外處理/);
  assert.match(text(failed.render()), /暫時未能標示這筆退款/);
});

// Sandbox acceptance, 15 October 2026: the open dialog kept the settle button
// beside the success line. The dialog keeps this control mounted (its answer
// with it) and the refreshed deposit passes no refund once it is recorded.
test('once recorded, the button goes and the answer stays — also after the board refresh drops the refund', async () => {
  const m = mount(async () => ({ success: true, message: 'The £20.00 refund is recorded as settled outside the website.' }));
  await m.click();
  let nodes = m.render();
  assert.equal(nodes.find((node) => node.type === 'button'), undefined, 'nothing left to press');
  assert.match(text(nodes), /recorded as settled outside the website/);
  m.offer(null);
  nodes = m.render();
  assert.equal(nodes.find((node) => node.type === 'button'), undefined);
  assert.match(text(nodes.find((node) => node.props.role === 'status')), /recorded as settled outside the website/);
});

test('with no refund to settle and nothing said, it shows nothing', () => {
  const m = mount(async () => ({ success: true, message: 'never' }));
  m.offer(null);
  assert.deepEqual(m.render(), []);
});
