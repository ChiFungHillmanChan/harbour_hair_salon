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
const destinations = ['/admin', '/admin/opening-hours', '/admin/services', '/admin/categories', '/admin/stylists', '/admin/faqs', '/admin/discounts', '/admin/offers', '/admin/reviews', '/admin/blog', '/admin/users', '/admin/settings', '/admin/integrations', '/admin/operations', '/admin/employees', '/admin/timesheets', '/admin/shifts', '/admin/payroll', '/kiosk'];

for (const locale of ['en-GB', 'zh-HK'] as const) {
  test(`admin navigation retains every section and POST sign-out in ${locale}`, () => {
    const Link = () => null;
    const LanguageSwitcher = () => null;
    const path = `${locale === 'zh-HK' ? '/zh-hk' : ''}/admin/services/service-id/edit`;
    const { AdminSidebar } = loadServerModule<typeof import('./AdminSidebar')>('src/components/admin/AdminSidebar.tsx', {
      react: { useState: (value: unknown) => [value, () => {}], useEffect: () => {}, useRef: (value: unknown) => ({ current: value }) },
      'next/navigation': { usePathname: () => path },
      '@/i18n/link': { __esModule: true, default: Link },
      '@/i18n/client': { useT: () => translator(locale as Locale, 'admin') },
      '@/i18n/LanguageSwitcher': { LanguageSwitcher },
      '@/app/lib/sign-out': { clearLocalAccountState: () => {} },
    });
    const nodes = elements(AdminSidebar({ userId: 'admin-fixture' }));
    const links = nodes.filter(node => node.type === Link);
    assert.deepEqual(links.map(node => node.props.href), destinations);
    assert.deepEqual(links.filter(node => node.props['aria-current'] === 'page').map(node => node.props.href), ['/admin/services']);
    assert.equal(nodes.filter(node => node.type === LanguageSwitcher).length, 2, 'language switching remains in the mobile bar and drawer');
    const form = nodes.find(node => node.type === 'form')!;
    assert.equal(form.props.method, 'post');
    assert.equal(form.props.action, '/api/auth/signout');
    assert.equal(nodes.find(node => node.type === 'input' && node.props.name === 'locale')?.props.value, locale);
    const trigger = nodes.find(node => node.props['aria-label'] === translator(locale, 'admin')('sidebar.openMenu'))!;
    const aside = nodes.find(node => node.type === 'aside')!;
    assert.equal(trigger.props['aria-controls'], aside.props.id, 'drawer trigger identifies its controlled navigation');
    assert.ok(aside.props.id, 'controlled drawer has an accessible identity');
  });
}
