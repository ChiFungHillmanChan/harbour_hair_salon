import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';

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

const { CalendarSetupNotice } = loadServerModule<typeof import('./CalendarSetupNotice')>(
  'src/components/admin/CalendarSetupNotice.tsx',
  { 'next/link': () => null },
);

test('calendar setup stays compact while preserving every check grouped by connection', () => {
  const blockers = Array.from({ length: 7 }, (_, i) => [
    `Stylist ${i} / FRESHA: test the inbound feed.`,
    `Stylist ${i} / FRESHA: confirm the outbound subscription.`,
  ]).flat();
  const rendered = CalendarSetupNotice({ coverage: { blockers }, bookingEnabled: false, scheduledSyncEnabled: false });
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

test('the notice distinguishes booking switched off from booking blocked by setup', () => {
  const coverage = { blockers: ['Ava / FRESHA: test the inbound feed.'] };
  const off = text(CalendarSetupNotice({ coverage, bookingEnabled: false, scheduledSyncEnabled: false }));
  assert.match(off, /Website booking is switched off/);
  assert.match(off, /Scheduled sync is off/);
  assert.match(off, /missing or outdated setup evidence/);
  assert.match(off, /Appointment conflicts are checked separately/);
  const blocked = text(CalendarSetupNotice({ coverage, bookingEnabled: true, scheduledSyncEnabled: true }));
  assert.match(blocked, /Website bookings are blocked by these calendar checks/);
  assert.doesNotMatch(blocked, /Website booking is switched off|Scheduled sync is off/);
});

test('unlabelled setup blockers remain visible and passing checks do not claim full readiness', () => {
  const rendered = CalendarSetupNotice({
    coverage: { blockers: ['No stylists are set up yet.'] }, bookingEnabled: false, scheduledSyncEnabled: false,
  });
  assert.match(text(rendered), /General setup/);
  assert.match(text(rendered), /No stylists are set up yet/);
  assert.match(text(rendered), /View 1 setup check/);
  assert.equal(CalendarSetupNotice({ coverage: { blockers: [] }, bookingEnabled: true, scheduledSyncEnabled: true }), null);
});
