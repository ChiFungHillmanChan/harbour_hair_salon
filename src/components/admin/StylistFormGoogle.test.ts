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

function loadForm(locale: Locale) {
  return loadServerModule<typeof import('./StylistForm')>('src/components/admin/StylistForm.tsx', {
    react: { useActionState: () => [{ status: 'idle' }, () => undefined, false], useEffect: () => undefined },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
    '@/i18n/link': { __esModule: true, default: (props: Record<string, unknown>) => ({ type: 'a', props }) },
    '@/i18n/draft-store': { clearDraft: () => undefined, usePreservedForm: () => ({ current: null }) },
    './BilingualContentEditor': { BilingualContentEditor: () => null },
    './CalendarColorPicker': { CalendarColorPicker: () => null },
    './GoogleColorPicker': { GoogleColorPicker: () => null },
    '@/i18n/rich': { rich: (value: string) => value },
  });
}

test('the stylist form offers a Google colour (none allowed) and Google names, in English and Chinese', () => {
  for (const [locale, words] of [
    ['en-GB', { colour: 'Google colour', names: 'Google names' }],
    ['zh-HK', { colour: 'Google 顏色', names: 'Google 名稱' }],
  ] as const) {
    const nodes = elements(loadForm(locale).StylistForm({
      mode: 'edit', action: async () => ({ status: 'idle' }), saved: false,
      stylist: { id: 'lox', name: 'Lox', slug: 'lox', imageUrl: null, yearsExperience: null },
      googleColorId: '5', googleAliases: 'L',
    }));
    const picker = nodes.find((node) => node.props.name === 'googleColorId')!;
    assert.deepEqual([picker.props.label, picker.props.initial, picker.props.allowNone], [words.colour, '5', true], locale);
    const names = nodes.find((node) => node.props.name === 'googleAliases')!;
    assert.deepEqual([names.props.defaultValue, names.props.maxLength], ['L', 200], locale);
    assert.ok(nodes.some((node) => text(node) === words.names), locale);
  }
});

test('"Takes walk-ins" is a checkbox, ticked for a new stylist and as saved for an existing one, in English and Chinese', () => {
  for (const [locale, label] of [['en-GB', 'Takes walk-ins'], ['zh-HK', '接 walk-in']] as const) {
    const { StylistForm } = loadForm(locale);
    const box = (props: Record<string, unknown>) => elements(StylistForm({ action: async () => ({ status: 'idle' }), ...props } as never)).find((node) => node.props.name === 'takesWalkIns')!;
    const fresh = box({ mode: 'create' });
    assert.deepEqual([fresh.props.type, fresh.props.defaultChecked], ['checkbox', true], locale);
    const assistant = box({ mode: 'edit', stylist: { id: 'shania', name: 'Shania', slug: 'shania', imageUrl: null, yearsExperience: null }, takesWalkIns: false });
    assert.equal(assistant.props.defaultChecked, false, locale);
    const nodes = elements(StylistForm({ mode: 'create', action: async () => ({ status: 'idle' }) }));
    assert.ok(nodes.some((node) => text(node).includes(label)), locale);
  }
});

test('"Show on website" is a checkbox as saved for an existing stylist; a new stylist starts hidden and the form says so, in English and Chinese', () => {
  for (const [locale, label] of [['en-GB', 'Show on website'], ['zh-HK', '在網站顯示']] as const) {
    const { StylistForm } = loadForm(locale);
    const box = (props: Record<string, unknown>) => elements(StylistForm({ action: async () => ({ status: 'idle' }), ...props } as never)).find((node) => node.props.name === 'showOnWebsite')!;
    assert.equal(box({ mode: 'create' }), undefined, locale);
    const hidden = box({ mode: 'edit', stylist: { id: 'shania', name: 'Shania', slug: 'shania', imageUrl: null, yearsExperience: null }, showOnWebsite: false });
    assert.deepEqual([hidden.props.type, hidden.props.defaultChecked], ['checkbox', false], locale);
    const nodes = elements(StylistForm({ mode: 'create', action: async () => ({ status: 'idle' }) }));
    assert.ok(nodes.some((node) => text(node).includes(label)), locale);
  }
});
