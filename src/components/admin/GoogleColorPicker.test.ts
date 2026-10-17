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
function picker(locale: Locale = 'en-GB') {
  return loadServerModule<typeof import('./GoogleColorPicker')>('src/components/admin/GoogleColorPicker.tsx', {
    react: { useState: (value: unknown) => [value, () => undefined] },
    '@/i18n/client': { useT: (namespace: Namespace) => translator(locale, namespace) },
  });
}

test('eleven Google colours by their Google names, plus "none" when allowed; the hidden input posts the id', () => {
  const nodes = elements(picker().GoogleColorPicker({ name: 'googleColorId', label: 'Google colour', initial: '5', allowNone: true }));
  assert.deepEqual(nodes.filter((node) => node.type === 'button').map((node) => node.props.title),
    ['No Google colour', 'Lavender', 'Sage', 'Grape', 'Flamingo', 'Banana', 'Tangerine', 'Peacock', 'Graphite', 'Blueberry', 'Basil', 'Tomato']);
  assert.equal(nodes.find((node) => node.type === 'input')!.props.value, '5');
  const banana = nodes.find((node) => node.props.title === 'Banana')!;
  assert.equal(banana.props['aria-pressed'], true);
  assert.match(String(banana.props.className), /bg-\[#f6bf26\]/);
  const strict = elements(picker().GoogleColorPicker({ name: 'x', label: 'x', initial: '11', allowNone: false }));
  assert.equal(strict.filter((node) => node.type === 'button').length, 11);
});

test('Chinese colour names', () => {
  const nodes = elements(picker('zh-HK').GoogleColorPicker({ name: 'x', label: 'x', initial: null, allowNone: true }));
  const titles = nodes.filter((node) => node.type === 'button').map((node) => node.props.title);
  assert.deepEqual([titles[0], titles[1], titles[11]], ['沒有 Google 顏色', '薰衣草紫', '番茄紅']);
});
