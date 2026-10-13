import { test } from 'node:test';
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
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object' || !('props' in node)) return '';
  return text((node as Element).props.children);
}

/** The form module with hooks stubbed: `typed` is what the percentage box currently holds (its state). */
function loadForm(locale: Locale = 'en-GB', typed?: string) {
  const changes: unknown[] = [];
  const form = loadServerModule<typeof import('./SiteSettingsForm')>('src/components/admin/SiteSettingsForm.tsx', {
    react: {
      useActionState: () => [{ status: 'idle' }, () => undefined, false],
      useEffect: () => undefined,
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [typed ?? initial, (value: unknown) => changes.push(value)],
    },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/app/actions/admin-settings': { updateSiteSettings: async () => ({ status: 'idle' }) },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/draft-store': { clearDraft: () => undefined, usePreservedForm: () => ({ current: null }) },
  });
  return { form, changes };
}

const HINT = 'Keep deposits proportionate — UK consumer law can treat large non-refundable deposits as unfair (many salons use 10–30%).';
const WARNING = 'Above 50%: a deposit this large is more likely to be found unfair if the salon keeps it after a late cancellation or no-show. Consider a lower percentage.';

test('the deposit percentage always carries the proportionality hint, and warns only above 50%', () => {
  for (const [typed, warns] of [['10', false], ['30', false], ['50', false], ['51', true], ['100', true], ['', false]] as const) {
    const nodes = elements(loadForm('en-GB', typed).form.DepositPercentField({ defaultValue: 10 }));
    const input = nodes.find((node) => node.type === 'input')!;
    assert.equal(input.props.max, 100, 'up to 100% stays allowed');
    assert.ok(nodes.some((node) => text(node) === HINT), `${typed}: the hint`);
    const warning = nodes.find((node) => node.props.id === 'settings-deposit-percent-warning');
    assert.equal(Boolean(warning), warns, `${typed}%`);
    if (warning) assert.equal(text(warning), WARNING);
    assert.equal(String(input.props['aria-describedby']).includes('settings-deposit-percent-warning'), warns, 'the warning is read out with the field');
    // The warning appears inside a polite live region, so it is announced as it shows.
    assert.ok(nodes.some((node) => node.props.role === 'status'));
  }
});

test('the warning follows what is typed', () => {
  const { form, changes } = loadForm('en-GB');
  const input = elements(form.DepositPercentField({ defaultValue: 20 })).find((node) => node.type === 'input')!;
  assert.equal(input.props.defaultValue, 20);
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '75' } });
  assert.deepEqual(changes, ['75']);
});

test('the hint and the warning are in Chinese on the Chinese admin', () => {
  const nodes = elements(loadForm('zh-HK', '80').form.DepositPercentField({ defaultValue: 80 }));
  assert.ok(nodes.some((node) => text(node).startsWith('訂金應與服務價格相稱')));
  assert.ok(nodes.some((node) => text(node).startsWith('高於 50%')));
});

test('the settings form uses the field with the saved percentage, and says a fixed deposit beats the minimum price', () => {
  const settings = {
    bookingEnabled: true, depositsEnabled: true, depositPercent: 25, depositMinimumServicePence: 2000, phone: '0113 496 0000',
    salonNotificationLocale: 'en-GB', instagramUrl: '', googleBusinessUrl: '', facebookUrl: '', treatwellUrl: '', freshaUrl: '', booksyUrl: '',
    twitterHandle: '', gscVerification: '',
  };
  const { form } = loadForm('en-GB');
  const nodes = elements(form.SiteSettingsForm({ settings: settings as never }));
  const field = nodes.find((node) => node.type === form.DepositPercentField);
  assert.equal(field?.props.defaultValue, 25);
  const minimumHelp = nodes.find((node) => node.props.id === 'settings-deposit-minimum-help');
  assert.equal(text(minimumHelp), 'Services priced below this take no deposit, unless the service has its own fixed deposit. 0.00 means every priced service does.');
  assert.match(translator('zh-HK', 'adminContent')('settings.deposits.minimumHelp'), /除非該服務設有自己的固定訂金/);
});
