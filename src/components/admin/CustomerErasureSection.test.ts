import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import { ERASED_CUSTOMER_NAME, erasedEmailFor } from '../../app/lib/customer-erasure';
import { placeholderEmailFor } from '../../app/lib/walk-in-customer';

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

const customers = [
  { id: 'amy', name: 'Amy Lee', email: 'amy@example.com', phone: '07000 000001', _count: { appointments: 3 } },
  { id: 'walk-in', name: 'Phone Customer', email: placeholderEmailFor('walk-in'), phone: '07000 000002', _count: { appointments: 1 } },
  { id: 'gone', name: ERASED_CUSTOMER_NAME, email: erasedEmailFor('gone'), phone: null, _count: { appointments: 2 } },
];

function load() {
  const queries: Record<string, unknown>[] = [];
  const Button = () => null;
  const { CustomerErasureSection } = loadServerModule<typeof import('./CustomerErasureSection')>('src/components/admin/CustomerErasureSection.tsx', {
    '@/app/lib/prisma': { user: { findMany: async (query: Record<string, unknown>) => { queries.push(query); return customers; } } },
    '@/i18n/server': { getLocale: async () => 'en-GB', getT: async () => translator('en-GB', 'adminOps') },
    './EraseCustomerButton': { EraseCustomerButton: Button },
  });
  return { CustomerErasureSection, queries, Button };
}

test('the erasure search reads nothing until at least two characters are typed', async () => {
  const f = load();
  for (const query of ['', 'a']) {
    const rendered = await f.CustomerErasureSection({ query });
    assert.equal(elements(rendered).filter((element) => element.type === 'li').length, 0);
  }
  assert.deepEqual(f.queries, []);
});

test('customers are found by name, lower-cased email or phone, ten at most, customers only', async () => {
  const f = load();
  await f.CustomerErasureSection({ query: 'Amy@Example' });
  assert.deepEqual(f.queries[0].where, {
    role: 'USER',
    OR: [{ name: { contains: 'Amy@Example' } }, { email: { contains: 'amy@example' } }, { phone: { contains: 'Amy@Example' } }],
  });
  assert.equal(f.queries[0].take, 10);
});

test('each match offers erasure with the confirmation it needs; an erased account is only labelled', async () => {
  const f = load();
  const rendered = await f.CustomerErasureSection({ query: 'customer' });
  const buttons = elements(rendered).filter((element) => element.type === f.Button);
  assert.deepEqual(buttons.map((element) => [element.props.userId, element.props.expected, element.props.name]), [
    ['amy', 'amy@example.com', 'Amy Lee'],
    ['walk-in', 'ERASE', 'Phone Customer'],
  ]);
  const rows = elements(rendered).filter((element) => element.type === 'li').map(text);
  assert.match(rows[0], /amy@example\.com · 07000 000001 · 3 appointments/);
  assert.match(rows[1], /No email \(phone booking\) · 07000 000002 · 1 appointment$/);
  assert.match(rows[2], /^Erased customer2 appointmentsErased$/, 'no placeholder address, no button');
  assert.doesNotMatch(text(rendered), /walk-in\.harbourhair\.invalid|erased\.invalid/, 'synthetic addresses are never shown');
});
