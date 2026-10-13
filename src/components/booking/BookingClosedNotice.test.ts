import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  const rendered = typeof element.type === 'function' ? (element.type as (p: unknown) => unknown)(element.props) : null;
  return [element, ...elements(element.props.children), ...elements(rendered)];
}
const words = (nodes: Element[]) => nodes.flatMap((node) => [node.props.children].flat().filter((c) => typeof c === 'string')).join(' ');

const AppLink = ({ href, children }: { href: string; children: unknown }) => ({ type: 'a', props: { href, children } });
const ui = loadServerModule<typeof import('./BookingClosedNotice')>('src/components/booking/BookingClosedNotice.tsx', {
  '@/i18n/link': { __esModule: true, default: AppLink },
});
const fresha = { name: 'Fresha', url: 'https://www.fresha.com/a/harbour-hair' };

test('phone only: a call button, the hours line and a link to My Bookings', () => {
  const nodes = elements(ui.BookingClosedNotice({ t: translator('en-GB', 'booking'), phone: '0113 496 0000', marketplaces: [] }));
  const anchors = nodes.filter((node) => node.type === 'a');
  assert.deepEqual(anchors.map((node) => node.props.href), ['tel:01134960000', '/appointments']);
  const text = words(nodes);
  assert.ok(text.includes('Book by phone'));
  assert.ok(text.includes('Call 0113 496 0000'));
  assert.ok(text.includes('We answer the phone during salon hours.'));
  assert.ok(nodes.some((node) => node.type === 'h1'), 'the page heading on /book');
});

test('with a marketplace: its button opens in a new tab, safely, after the phone', () => {
  const nodes = elements(ui.BookingClosedNotice({ t: translator('en-GB', 'booking'), phone: '0113 496 0000', marketplaces: [fresha], heading: 'h2' }));
  const anchors = nodes.filter((node) => node.type === 'a');
  assert.deepEqual(anchors.map((node) => node.props.href), ['tel:01134960000', fresha.url, '/appointments']);
  const partner = anchors[1];
  assert.equal(partner.props.target, '_blank');
  assert.match(String(partner.props.rel), /noopener/);
  assert.ok(words(nodes).includes('Book on Fresha'));
  assert.ok(!words(nodes).includes('We answer the phone during salon hours.'));
  assert.ok(nodes.some((node) => node.type === 'h2') && !nodes.some((node) => node.type === 'h1'), 'a section heading inside the wizard');
});

test('the same notice in Chinese', () => {
  const text = words(elements(ui.BookingClosedNotice({ t: translator('zh-HK', 'booking'), phone: '0113 496 0000', marketplaces: [] })));
  assert.ok(text.includes('致電預約'));
  assert.ok(text.includes('致電 0113 496 0000'));
});
