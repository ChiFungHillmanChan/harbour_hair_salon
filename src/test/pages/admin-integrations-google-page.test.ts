import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';

// The Integrations page around the Google Calendar panel (task G9 fix round 1):
// "Sync now" runs under the page's route limit, and the ?gcal= redirect
// codes are worded in the admin's language.

function loadPage(locale: Locale = 'en-GB') {
  const readiness = {
    treatwell: { syncCoverage: { blockers: [], issues: [], safeToEnableOnlineBooking: true }, outbound: { pending: 0, failed: 0, synced: 0 } },
    resend: { apiKeyConfigured: true, fromAddressConfigured: true, replyToConfigured: true, audienceConfigured: true },
    cdn: { homeRevalidateSeconds: 3600, siteUrlConfigured: true },
  };
  return loadServerModule<typeof import('../../app/[locale]/admin/integrations/page')>('src/app/[locale]/admin/integrations/page.tsx', {
    '@/app/lib/session': { requireAdmin: async () => ({}), verifySession: async () => ({ userId: 'a', role: 'ADMIN' }) },
    '@/i18n/link': { default: () => null },
    '@/app/actions/admin-integrations': { retryFailedTreatwellBookingsAction: async () => {} },
    '@/app/services/integration-readiness': { getIntegrationReadiness: async () => readiness, listCalendarConnectionsForAdmin: async () => [] },
    '@/components/admin/CalendarConnectionsSetup': { CalendarConnectionsSetup: () => null },
    '@/components/admin/GoogleCalendarStatus': { GoogleCalendarStatus: () => null },
    '@/app/services/google-calendar-status': { getGoogleCalendarStatus: async () => ({ enabled: false }) },
    '@/app/lib/site-url': { SITE_URL: 'https://example.test' },
    '@/i18n/server': { getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
}

type Node = { props?: { children?: unknown; role?: string } };
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Node).props?.children);
}
function banners(node: unknown, found: { role: string; text: string }[] = []) {
  if (Array.isArray(node)) { node.forEach((child) => banners(child, found)); return found; }
  if (!node || typeof node !== 'object' || !('props' in node)) return found;
  const props = (node as Node).props;
  if (props?.role === 'status' || props?.role === 'alert') found.push({ role: props.role, text: text(props.children) });
  banners(props?.children, found);
  return found;
}

test('the page allows 300 seconds, as long as the housekeeping job Sync now runs', () => {
  assert.equal(loadPage().maxDuration, 300);
});

test('?gcal= codes show a status or alert banner in English and Chinese; no code shows none', async () => {
  const expected = {
    en: { 'en-GB': { done: 'Google Calendar sync finished.', disabled: 'Google Calendar sync is off, so nothing was done.', error: 'did not finish cleanly' } },
    zh: { 'zh-HK': { done: 'Google 日曆同步已完成', disabled: 'Google 日曆同步未啟用，因此沒有執行任何動作', error: '未能順利完成' } },
  };
  for (const group of Object.values(expected)) {
    for (const [locale, words] of Object.entries(group) as [Locale, Record<string, string>][]) {
      for (const [code, wording] of Object.entries(words)) {
        const tree = await loadPage(locale).default({ searchParams: Promise.resolve({ gcal: code }) });
        const found = banners(tree).filter((banner) => banner.text.includes(wording));
        assert.equal(found.length, 1, `${locale} ${code}`);
        assert.equal(found[0].role, code === 'error' ? 'alert' : 'status');
      }
    }
  }
  const none = await loadPage().default({ searchParams: Promise.resolve({}) });
  assert.deepEqual(banners(none), []);
  const unknown = await loadPage().default({ searchParams: Promise.resolve({ gcal: 'bogus' }) });
  assert.deepEqual(banners(unknown), []);
});
