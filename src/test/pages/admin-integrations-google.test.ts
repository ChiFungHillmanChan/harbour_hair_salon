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

type Node = { type?: unknown; props?: { name?: string; initial?: string | null; allowNone?: boolean; children?: unknown; disabled?: boolean; label?: string; busy?: string; confirm?: string; action?: unknown; onClick?: (event: unknown) => void } };
const SyncButton = () => null;
const ClearButton = () => null;
const ColourPicker = () => null;
const syncAction = async () => {};
const coloursAction = async () => {};
const clearAction = async () => {};

const COLOURS = { stylists: [{ id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' }, { id: 'shania', name: 'Shania', googleColorId: null, googleAliases: '天' }], unassignedColorId: '11', leaveColorId: '8' };

async function render(locale: Locale, status: Status) {
  const component = loadServerModule<typeof import('../../components/admin/GoogleCalendarStatus')>('src/components/admin/GoogleCalendarStatus.tsx', {
    '@/components/admin/GoogleSyncButton': { GoogleSyncButton: SyncButton },
    '@/components/admin/GoogleClearBusyButton': { GoogleClearBusyButton: ClearButton },
    '@/components/admin/GoogleColorPicker': { GoogleColorPicker: ColourPicker },
    '@/app/actions/admin-google-calendar': { syncGoogleCalendarNow: syncAction, clearGoogleBusyTime: clearAction, saveGoogleDiaryColours: coloursAction },
    '@/i18n/server': { getLocale: async () => locale, getT: async (namespace: Namespace) => translator(locale, namespace) },
  });
  const tree = await component.GoogleCalendarStatus({ status, colours: COLOURS });
  const text = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    if (!node || typeof node !== 'object' || !('props' in node)) return '';
    return text((node as Node).props?.children);
  };
  const buttons: Node[] = [];
  const clearButtons: Node[] = [];
  const forms: Node[] = [];
  const pickers: Node[] = [];
  const find = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(find);
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    if ((node as Node).type === SyncButton) buttons.push(node as Node);
    if ((node as Node).type === ClearButton) clearButtons.push(node as Node);
    if ((node as Node).type === ColourPicker) pickers.push(node as Node);
    if ((node as Node).type === 'form') forms.push(node as Node);
    find((node as Node).props?.children);
  };
  find(tree);
  return { text: text(tree), buttons, clearButtons, forms, pickers };
}

test('on: shows the masked calendar, check times, translated problem, failed count and an enabled Sync now', async () => {
  const en = await render('en-GB', ON);
  for (const expected of ['Google Calendar sync is on.', 'abcdef…', 'Bookings Google would not take', 'The Google Calendar check could not complete']) {
    assert.ok(en.text.includes(expected), expected);
  }
  assert.ok(!en.text.includes('abcdef1234'));
  assert.equal(en.buttons.length, 1);
  assert.equal(en.buttons[0].props?.disabled, false);
  assert.deepEqual([en.buttons[0].props?.label, en.buttons[0].props?.busy], ['Sync now', 'Syncing…']);

  const zh = await render('zh-HK', ON);
  assert.ok(zh.text.includes('Google 日曆同步已啟用'));
  assert.deepEqual([zh.buttons[0].props?.label, zh.buttons[0].props?.busy], ['立即同步', '同步中…']);
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

// The Sync now button while the action runs: disabled, "Syncing…", so a
// second click cannot start a second sync.
function button(pending: boolean, disabled = false) {
  const { GoogleSyncButton } = loadServerModule<typeof import('../../components/admin/GoogleSyncButton')>('src/components/admin/GoogleSyncButton.tsx', {
    'react-dom': { useFormStatus: () => ({ pending }) },
  });
  return GoogleSyncButton({ label: 'Sync now', busy: 'Syncing…', disabled }) as unknown as Node;
}

test('Sync now button: idle is enabled, pending is disabled and says it is syncing, off stays disabled', () => {
  const idle = button(false);
  assert.equal(idle.props?.disabled, false);
  assert.equal(idle.props?.children, 'Sync now');
  const pending = button(true);
  assert.equal(pending.props?.disabled, true);
  assert.equal(pending.props?.children, 'Syncing…');
  assert.equal(button(false, true).props?.disabled, true);
});

test('the pending wording exists in both languages', async () => {
  assert.equal(translator('en-GB', 'adminOps')('integrations.google.syncing'), 'Syncing…');
  assert.equal(translator('zh-HK', 'adminOps')('integrations.google.syncing'), '同步中…');
});

// "Clear Google busy time" (final review I2): offered whether the sync is on
// or off, in the admin's language, and confirmed before it runs.
test('Clear Google busy time is offered on and off, posts to its own action, in both languages', async () => {
  for (const status of [ON, { enabled: false } as Status]) {
    const en = await render('en-GB', status);
    assert.equal(en.clearButtons.length, 1, `enabled: ${status.enabled}`);
    assert.deepEqual([en.clearButtons[0].props?.label, en.clearButtons[0].props?.busy], ['Clear Google busy time and diary copy', 'Clearing…']);
    assert.match(en.clearButtons[0].props?.confirm ?? '', /^Remove every busy period read from Google Calendar, and the copy of the diary shown on Admin → Schedule\?/);
    assert.ok(en.text.includes('It also removes the copy of the diary shown on Admin → Schedule.'), 'the help mentions the diary copy');
    assert.ok(en.forms.some((form) => form.props?.action === clearAction));
    assert.ok(en.text.includes(status.enabled ? 'While the sync is on, the next check of Google reads them again' : 'The sync is off, so nothing reads Google any more'));
    const zh = await render('zh-HK', status);
    assert.deepEqual([zh.clearButtons[0].props?.label, zh.clearButtons[0].props?.busy], ['清除 Google 忙碌時段及記事簿副本', '清除中…']);
    assert.match(zh.clearButtons[0].props?.confirm ?? '', /^要刪除所有從 Google 日曆讀取的忙碌時段嗎？/);
    assert.ok((zh.clearButtons[0].props?.confirm ?? '').endsWith('亦會刪除後台預約時間表上顯示的記事簿副本。'));
  }
});

// "Diary colours": the two salon colours (no "none"), the stylists' colours
// read-only, posting to its own action; offered on or off, in both languages.
test('Diary colours: two pickers without "none" posting to their own action, and the stylists listed', async () => {
  for (const status of [ON, { enabled: false } as Status]) {
    const en = await render('en-GB', status);
    assert.ok(en.forms.some((form) => form.props?.action === coloursAction), `enabled: ${status.enabled}`);
    assert.deepEqual(en.pickers.map((p) => [p.props?.name, p.props?.initial, p.props?.allowNone]), [['googleUnassignedColorId', '11', false], ['googleLeaveColorId', '8', false]]);
    for (const expected of ['Diary colours', 'Save colours', 'Lox', 'Shania', 'No Google colour']) assert.ok(en.text.includes(expected), expected);
    assert.match(en.text, /\(\s*L\s*\)/);
    assert.match(en.text, /\(\s*天\s*\)/);
    const zh = await render('zh-HK', status);
    for (const expected of ['記事簿顏色', '儲存顏色', '沒有 Google 顏色']) assert.ok(zh.text.includes(expected), expected);
  }
});

function clearButton(pending: boolean, confirmed: boolean) {
  const asked: string[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { confirm: (message: string) => { asked.push(message); return confirmed; } };
  const { GoogleClearBusyButton } = loadServerModule<typeof import('../../components/admin/GoogleClearBusyButton')>('src/components/admin/GoogleClearBusyButton.tsx', {
    'react-dom': { useFormStatus: () => ({ pending }) },
  });
  const node = GoogleClearBusyButton({ label: 'Clear', busy: 'Clearing…', confirm: 'Sure?' }) as unknown as Node;
  let prevented = false;
  node.props?.onClick?.({ preventDefault: () => { prevented = true; } });
  (globalThis as { window?: unknown }).window = previous;
  return { node, asked, prevented };
}

test('Clear Google busy time asks first: cancelling stops the submission; pending is disabled', () => {
  const cancelled = clearButton(false, false);
  assert.deepEqual(cancelled.asked, ['Sure?']);
  assert.equal(cancelled.prevented, true);
  const confirmed = clearButton(false, true);
  assert.equal(confirmed.prevented, false);
  assert.equal(confirmed.node.props?.disabled, false);
  assert.equal(confirmed.node.props?.children, 'Clear');
  const pending = clearButton(true, true);
  assert.equal(pending.node.props?.disabled, true);
  assert.equal(pending.node.props?.children, 'Clearing…');
});
