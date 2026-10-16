import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../load-server-module';
import { translator, type Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import { OPERATIONS_MESSAGES } from '../../app/services/operations-messages';
import type { GoogleCalendarStatus as Status } from '../../app/services/google-calendar-status';

// Admin → Integrations, the Google Calendar panel (task G9): state, masked
// calendar id, last check and Sync now, in the admin's language.

const ON: Status = {
  enabled: true, calendarId: 'abcdef…', channelExpiresAt: new Date('2026-10-20T10:00:00Z'),
  lastPullAt: new Date('2026-10-16T12:00:00Z'), lastPullSuccessAt: new Date('2026-10-16T11:00:00Z'),
  lastPullError: OPERATIONS_MESSAGES.GOOGLE_PULL_FAILED, failedEvents: 2,
};

type Node = { type?: unknown; props?: { children?: unknown; disabled?: boolean } };

async function render(locale: Locale, status: Status) {
  const component = loadServerModule<typeof import('../../components/admin/GoogleCalendarStatus')>('src/components/admin/GoogleCalendarStatus.tsx', {
    '@/app/actions/admin-google-calendar': { syncGoogleCalendarNow: async () => {} },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  const tree = await component.GoogleCalendarStatus({ status });
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    if (!node || typeof node !== 'object' || !('props' in node)) return '';
    return text((node as Node).props?.children);
  };
  const buttons: Node[] = [];
  const find = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(find);
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    if ((node as Node).type === 'button') buttons.push(node as Node);
    find((node as Node).props?.children);
  };
  find(tree);
  return { text: text(tree), buttons };
}

test('on: shows the masked calendar, check times, translated problem, failed count and an enabled Sync now', async () => {
  const en = await render('en-GB', ON);
  for (const expected of ['Google Calendar sync is on.', 'abcdef…', 'Bookings Google would not take', 'Sync now', 'The Google Calendar check could not complete']) {
    assert.ok(en.text.includes(expected), expected);
  }
  assert.ok(!en.text.includes('abcdef1234'));
  assert.equal(en.buttons.length, 1);
  assert.equal(en.buttons[0].props?.disabled, false);

  const zh = await render('zh-HK', ON);
  assert.ok(zh.text.includes('Google 日曆同步已啟用'));
  assert.ok(zh.text.includes('立即同步'));
  assert.ok(!zh.text.includes('The Google Calendar check could not complete'), 'the stored sentence is shown in Chinese');
});

test('off: says so, shows no calendar details and disables Sync now', async () => {
  for (const [locale, expected] of [['en-GB', 'Google Calendar sync is off'], ['zh-HK', 'Google 日曆同步未啟用']] as const) {
    const off = await render(locale, { enabled: false });
    assert.ok(off.text.includes(expected));
    assert.ok(!off.text.includes('abcdef'));
    assert.equal(off.buttons[0].props?.disabled, true);
  }
});

test('a problem that is not one of our sentences is shown as recorded, marked English', async () => {
  const { text } = await render('zh-HK', { ...ON, lastPullError: 'Something older' });
  assert.ok(text.includes('Something older'));
});
