import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// Admin → Stylists: each row carries the two switches, "Show on website" and
// "Takes walk-ins", as one-click buttons (owner, 2026-10-17). A hidden stylist
// is still listed, and has no "View" link (their public page is gone).

type Element = { type: unknown; props: Record<string, unknown> };
/** Found by type in the tree (the page renders it, the test never calls it). */
const RowActionButton = () => null;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

const row = (id: string, name: string, showOnWebsite: boolean, takesWalkIns: boolean) => ({
  id, name, slug: id, role: 'Stylist', tagline: null, showOnWebsite, takesWalkIns,
});

function loadPage(locale: Locale = 'en-GB') {
  const calls: unknown[][] = [];
  const page = loadServerModule<typeof import('../../app/[locale]/admin/stylists/page')>('src/app/[locale]/admin/stylists/page.tsx', {
    '@/app/lib/session': { requireAdmin: async () => ({}) },
    'next/navigation': { unstable_rethrow: () => undefined },
    '@/i18n/link': { default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/app/lib/prisma': { appointment: { groupBy: async () => [] } },
    '@/app/stylists/slug': { getStylistsForAdmin: async () => [row('ivan', 'Ivan', true, true), row('shania', 'Shania', false, false)] },
    '@/app/actions/admin-stylists': {
      deleteStylist: async () => undefined,
      setStylistSwitch: async (...args: unknown[]) => { calls.push(args); return { success: true }; },
    },
    '@/components/admin/RowActionButton': { RowActionButton },
    '@/components/admin/ContentStatusBadges': { ContentStatusBadges: () => null },
    '@/app/services/admin-content-status': { loadContentStatus: async () => new Map() },
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/server': { getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  return { page, calls };
}

test('each row shows both switches with its current state, and a click flips just that one', async () => {
  const { page, calls } = loadPage();
  const nodes = elements(await page.default());
  const buttons = nodes.filter((node) => node.type === RowActionButton && node.props.label !== 'Delete');
  assert.deepEqual(buttons.map((node) => node.props.label), ['Shown', 'Takes walk-ins', 'Hidden', 'No walk-ins']);
  for (const button of buttons) await (button.props.action as () => Promise<unknown>)();
  assert.deepEqual(calls, [
    ['ivan', 'showOnWebsite', false], ['ivan', 'takesWalkIns', false],
    ['shania', 'showOnWebsite', true], ['shania', 'takesWalkIns', true],
  ]);
  const views = nodes.filter((node) => String(node.props.href ?? '').startsWith('/stylists/'));
  assert.deepEqual(views.map((node) => node.props.href), ['/stylists/ivan'], 'no public link for a hidden stylist');
});

test('the switches read in Chinese too', async () => {
  const nodes = elements(await loadPage('zh-HK').page.default());
  const labels = nodes.filter((node) => node.type === RowActionButton).map((node) => node.props.label);
  for (const label of ['已顯示', '接 walk-in', '已隱藏', '不接 walk-in']) assert.ok(labels.includes(label), label);
});
