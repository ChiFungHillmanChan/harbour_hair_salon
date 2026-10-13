import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// "Re-check payment" next to a booking's deposit chip (phase S4).

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

/** The component with React's state kept between renders, as React would. */
function mount(answer: (id: string) => Promise<unknown>, locale: Locale = 'en-GB') {
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let refCursor = 0;
  const asked: string[] = [];
  let refreshes = 0;
  const { DepositRecheckButton } = loadServerModule<typeof import('./DepositRecheckButton')>('src/components/admin/DepositRecheckButton.tsx', {
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
    '@/app/actions/admin-payments': { recheckAppointmentPayment: async (id: string) => { asked.push(id); return answer(id); } },
  });
  const render = () => {
    cursor = 0;
    refCursor = 0;
    return elements(DepositRecheckButton({ appointmentId: 'appt-1' }));
  };
  const click = () => (render().find((node) => node.type === 'button')!.props.onClick as () => Promise<void>)();
  return { render, click, asked, refreshes: () => refreshes };
}

test('asks Square about this booking, shows what is true and refreshes the board', async () => {
  const m = mount(async () => ({ success: true, lines: ['The £20.00 hold is released. Nothing was taken.', 'Refund of £20.00: completed'] }));
  let nodes = m.render();
  assert.equal(text(nodes.find((node) => node.type === 'button')), 'Re-check payment');
  assert.equal(nodes.find((node) => node.props.role === 'status'), undefined);
  await m.click();
  nodes = m.render();
  assert.deepEqual(m.asked, ['appt-1']);
  assert.equal(m.refreshes(), 1);
  const status = nodes.find((node) => node.props.role === 'status');
  assert.deepEqual(elements(status).filter((node) => node.type === 'p').map(text), ['The £20.00 hold is released. Nothing was taken.', 'Refund of £20.00: completed']);
  assert.equal(nodes.find((node) => node.type === 'button')!.props.disabled, false);
});

test('a refusal or a failure is shown, and nothing is refreshed', async () => {
  const refused = mount(async () => ({ success: false, error: 'Not authorised' }));
  await refused.click();
  assert.match(text(refused.render()), /Not authorised/);
  assert.equal(refused.refreshes(), 0);
  const failed = mount(async () => { throw new Error('network'); }, 'zh-HK');
  await failed.click();
  assert.match(text(failed.render()), /暫時未能重新檢查此付款/);
});

test('a double click asks once', async () => {
  let release!: () => void;
  const m = mount(() => new Promise((resolve) => { release = () => resolve({ success: true, lines: ['ok'] }); }));
  const first = m.click();
  const second = m.click();
  // Let the first click reach the server action, then answer it.
  while (m.asked.length === 0) await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(m.asked, ['appt-1']);
});
