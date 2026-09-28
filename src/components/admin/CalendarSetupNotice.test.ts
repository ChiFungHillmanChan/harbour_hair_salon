import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
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
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

function loadNotice(locale: Locale = 'en-GB') {
  return loadServerModule<typeof import('./CalendarSetupNotice')>(
    'src/components/admin/CalendarSetupNotice.tsx',
    {
      '@/i18n/link': () => null,
      '@/i18n/server': { getT: async (namespace: 'adminSchedule' | 'adminOps') => translator(locale, namespace) },
    },
  ).CalendarSetupNotice;
}
const CalendarSetupNotice = loadNotice();

test('calendar setup stays compact while preserving every check grouped by connection', async () => {
  const blockers = Array.from({ length: 7 }, (_, i) => [
    `Stylist ${i} / FRESHA: test the inbound feed.`,
    `Stylist ${i} / FRESHA: confirm the outbound subscription.`,
  ]).flat();
  const rendered = await CalendarSetupNotice({ coverage: { blockers }, bookingEnabled: false, scheduledSyncEnabled: false });
  const nodes = elements(rendered);
  const details = nodes.find((node) => node.type === 'details');
  assert.ok(details);
  assert.ok(!details.props.open, 'setup checks start collapsed');
  const summary = elements(details).find((node) => node.type === 'summary');
  assert.match(text(summary), /View 14 setup checks/);
  assert.equal(nodes.filter((node) => node.type === 'h3').length, 7);
  assert.equal(nodes.filter((node) => node.type === 'li').length, 14);
  for (let i = 0; i < 7; i++) {
    const group = nodes.find((node) => node.type === 'div' &&
      elements(node.props.children).some((child) => child.type === 'h3' && text(child) === `Stylist ${i} / FRESHA`));
    assert.ok(group);
    assert.match(text(group), /test the inbound feed/);
    assert.match(text(group), /confirm the outbound subscription/);
  }
  assert.ok(nodes.some((node) => node.props.href === '/admin/integrations'));
});

test('the notice distinguishes booking switched off from booking blocked by setup', async () => {
  const coverage = { blockers: ['Ava / FRESHA: test the inbound feed.'] };
  const off = text(await CalendarSetupNotice({ coverage, bookingEnabled: false, scheduledSyncEnabled: false }));
  assert.match(off, /Website booking is switched off/);
  assert.match(off, /Scheduled sync is off/);
  assert.match(off, /missing or outdated setup evidence/);
  assert.match(off, /Appointment conflicts are checked separately/);
  const blocked = text(await CalendarSetupNotice({ coverage, bookingEnabled: true, scheduledSyncEnabled: true }));
  assert.match(blocked, /Website bookings are blocked by these calendar checks/);
  assert.doesNotMatch(blocked, /Website booking is switched off|Scheduled sync is off/);
});

test('unlabelled setup blockers remain visible and passing checks do not claim full readiness', async () => {
  const rendered = await CalendarSetupNotice({
    coverage: { blockers: ['No stylists are set up yet.'] }, bookingEnabled: false, scheduledSyncEnabled: false,
  });
  assert.match(text(rendered), /General setup/);
  assert.match(text(rendered), /No stylists are set up yet/);
  assert.match(text(rendered), /View 1 setup check/);
  assert.equal(await CalendarSetupNotice({ coverage: { blockers: [] }, bookingEnabled: true, scheduledSyncEnabled: true }), null);
});

test('on a Chinese page the labels are translated while the generated checks stay as written', async () => {
  const rendered = await loadNotice('zh-HK')({
    coverage: { blockers: ['Ava / FRESHA: test the inbound feed.', 'No stylists are set up yet.'] }, bookingEnabled: false, scheduledSyncEnabled: false,
  });
  const content = text(rendered);
  assert.match(content, /日曆設定需要處理/);
  assert.match(content, /查看 2 項設定檢查/);
  assert.match(content, /一般設定/);
  assert.match(content, /test the inbound feed/);
  const checks = elements(rendered).filter((node) => node.type === 'li');
  assert.ok(checks.every((node) => node.props.lang === 'en'), 'untranslated diagnostics are marked as English for screen readers');
});

test('coded checks are translated and grouped by stylist and platform; unknown codes fall back to the generated text', async () => {
  const blockers = [
    'Ava / FRESHA: enable and successfully test its inbound feed; the last success must be within 90 minutes and its latest attempt must not have failed.',
    'Ava: opening hours are incomplete or invalid.',
    'Ben / FRESHA: something new.',
  ];
  const issues = [
    { code: 'INBOUND_NOT_FRESH' as const, params: { stylist: 'Ava', provider: 'FRESHA', minutes: 90 } },
    { code: 'HOURS_INVALID' as const, params: { stylist: 'Ava' } },
    { code: 'NOT_A_REAL_CODE' as unknown as 'NO_STYLISTS', params: { stylist: 'Ben', provider: 'FRESHA' } },
  ];
  const rendered = await loadNotice('zh-HK')({ coverage: { blockers, issues }, bookingEnabled: false, scheduledSyncEnabled: true });
  const nodes = elements(rendered);
  assert.deepEqual(nodes.filter((node) => node.type === 'h3').map(text), ['Ava / FRESHA', 'Ava', 'Ben / FRESHA']);
  const checks = nodes.filter((node) => node.type === 'li');
  assert.deepEqual(checks.map(text), [
    '請啟用並成功測試其匯入來源；最近一次成功同步須在 90 分鐘內，而且最近一次嘗試不可失敗。',
    '營業時間不完整或無效。',
    'something new.',
  ], 'the heading already names the stylist and platform');
  assert.deepEqual(checks.map((node) => node.props.lang), [undefined, undefined, 'en']);

  const english = elements(await CalendarSetupNotice({ coverage: { blockers, issues }, bookingEnabled: false, scheduledSyncEnabled: true }));
  assert.match(text(english.find((node) => node.type === 'li')), /^enable and successfully test its inbound feed; the last success must be within 90 minutes/i);
});
