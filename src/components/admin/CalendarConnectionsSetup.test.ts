import test from 'node:test';
import assert from 'node:assert/strict';
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
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

const actions = {
  saveCalendarConnectionAction: async () => {},
  runCalendarIcalSyncAction: async () => {},
  confirmCalendarOutboundAction: async () => {},
  generateStylistIcalFeedTokenAction: async () => {},
};
const DraftForm = () => null;

async function render(locale: Locale) {
  const { CalendarConnectionsSetup } = loadServerModule<typeof import('./CalendarConnectionsSetup')>('src/components/admin/CalendarConnectionsSetup.tsx', {
    '@/app/actions/admin-integrations': actions,
    '@/components/admin/DraftForm': { DraftForm },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  return CalendarConnectionsSetup({ stylists: [{
    id: 'stylist-1', name: 'Example stylist', feedToken: 'example-token',
    feedUrl: 'https://example.test/api/ical/stylist-1?token=example-token',
    treatwellFeedUrl: 'https://example.test/api/ical/stylist-1?token=example-token&for=treatwell',
    connections: [{
      id: 'connection-1', provider: 'FRESHA', receivesBookings: true, inboundEnabled: true,
      inboundUrlConfigured: true, outboundConfirmedAt: null, lastAttemptAt: null,
      lastSuccessAt: null, lastError: 'Example feed problem',
    }],
  }] });
}

test('collapsed stylist connections keep their problem count visible in both languages', async () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const nodes = elements(await render(locale));
    const details = nodes.find((node) => node.type === 'details');
    assert.ok(details);
    assert.ok(!details.props.open);
    const summary = nodes.find((node) => node.type === 'summary');
    assert.ok(summary);
    assert.match(text(summary), /Example stylist/);
    assert.ok(text(summary).includes(translator(locale, 'adminOps')('integrations.google.lastError')));
    assert.match(text(summary), /1/);
    const error = nodes.find((node) => node.props.role === 'alert');
    assert.equal(text(error), 'Example feed problem');
  }
});

test('expanding connections retains each independent save, sync and required confirmation form', async () => {
  const nodes = elements(await render('en-GB'));
  for (const [action, expected] of [
    [actions.generateStylistIcalFeedTokenAction, 1],
    [actions.saveCalendarConnectionAction, 2],
    [actions.runCalendarIcalSyncAction, 2],
    [actions.confirmCalendarOutboundAction, 2],
  ] as const) {
    assert.equal(nodes.filter((node) => node.props.action === action).length, expected);
  }
  const confirmations = nodes.filter((node) => node.props.name === 'confirmed');
  assert.equal(confirmations.length, 2);
  assert.ok(confirmations.every((node) => node.props.required && !node.props.disabled));
  const urls = nodes.filter((node) => node.props.name === 'inboundUrl');
  assert.equal(urls.length, 2);
  assert.ok(urls.every((node) => node.props['data-no-preserve'] && node.props.value === undefined));
});

test('both feed URLs are shown, each labelled with the provider it is for, in both languages', async () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    const t = translator(locale, 'adminOps');
    const nodes = elements(await render(locale));
    const codes = nodes.filter((node) => node.type === 'code').map((node) => text(node));
    assert.deepEqual(codes, [
      'https://example.test/api/ical/stylist-1?token=example-token',
      'https://example.test/api/ical/stylist-1?token=example-token&for=treatwell',
    ]);
    const labels = nodes.filter((node) => node.type === 'p').map((node) => text(node));
    const standard = labels.indexOf(t('integrations.connections.outboundStandard'));
    const treatwell = labels.indexOf(t('integrations.connections.outboundTreatwell'));
    assert.ok(standard >= 0 && treatwell > standard, `${locale}: the Fresha label comes first, then Treatwell's`);
  }
});
