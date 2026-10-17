import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'string' || typeof node === 'number' ? String(node)
  : node && typeof node === 'object' && 'props' in node ? text((node as Element).props.children) : '';

const booking = (id: string, status: string, date: string, deposit?: Record<string, unknown>) => ({
  id, status, date, user: { name: `Customer ${id}` }, service: { name: 'Cut' }, stylist: { name: 'Lox' }, ...(deposit ? { deposit } : {}),
});
// 20 October 2026 is a Tuesday (BST): 16:00Z is 17:00 in London.
const ROWS = [
  booking('late', 'CANCELLED', '2026-10-20T16:00:00Z', { state: 'REFUND_PENDING', amountPence: 440 }),
  booking('kept', 'CONFIRMED', '2026-10-20T13:00:00Z'),
  booking('early', 'CANCELLED', '2026-10-20T09:00:00Z'),
];

function render(locale: Locale, rows: unknown[], showDay: boolean, opened: unknown[] = []) {
  const list = loadServerModule<typeof import('./ScheduleCancelledList')>('src/components/admin/ScheduleCancelledList.tsx', {
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale },
  });
  return list.ScheduleCancelledList({ appointments: rows as never, showDay, onEdit: (appt) => opened.push(appt) });
}

test('nothing cancelled: no list at all', () => {
  assert.equal(render('en-GB', [ROWS[1]], false), null);
});

test('the day lists its cancelled bookings in time order, each with its deposit and an Edit button that opens it', () => {
  const opened: unknown[] = [];
  const nodes = elements(render('en-GB', ROWS, false, opened));
  const section = nodes.find((node) => node.type === 'section')!;
  assert.equal(section.props['aria-label'], 'Cancelled bookings');
  const items = nodes.filter((node) => node.type === 'li');
  assert.deepEqual(items.map((item) => text(item).slice(0, 5)), ['10:00', '17:00'], 'cancelled only, earliest first, London time');
  assert.match(text(items[1]), /Customer late/);
  assert.match(text(items[1]), /Cut with Lox/);
  // The refund still pending shows on the row (DepositChip), so staff can see which one needs them.
  const chip = elements(items[1]).find((node) => node.props.deposit);
  assert.deepEqual(chip?.props.deposit, { state: 'REFUND_PENDING', amountPence: 440 });
  assert.ok(!elements(items[0]).some((node) => node.props.deposit), 'no deposit, no chip');
  const edit = elements(items[1]).find((node) => node.type === 'button')!;
  assert.equal(text(edit), 'Edit booking');
  (edit.props.onClick as () => void)();
  assert.deepEqual(opened.map((appt) => (appt as { id: string }).id), ['late']);
});

test('the week names each row’s day; the list reads in Chinese too', () => {
  const week = elements(render('en-GB', ROWS, true)).filter((node) => node.type === 'li');
  assert.match(text(week[0]), /^Tue.*20.*Oct.*10:00/);
  const chinese = elements(render('zh-HK', ROWS, false));
  assert.equal(chinese.find((node) => node.type === 'section')!.props['aria-label'], '已取消的預約');
  assert.ok(chinese.some((node) => node.type === 'button' && text(node) === translator('zh-HK', 'adminSchedule')('appointment.edit')));
});
