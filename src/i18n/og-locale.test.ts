import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ogLocale } from './metadata';
import { OG_BASE, OG_IMAGE } from '@/app/lib/og-defaults';

test('the shared share-card image carries alt text in the page language', () => {
  const zh = { ...OG_BASE, ...ogLocale('zh-HK') };
  assert.equal(zh.locale, 'zh_HK');
  assert.equal(zh.images.length, 1);
  assert.equal(zh.images[0].url, OG_IMAGE.url);
  assert.match(zh.images[0].alt, /列斯/);
  const en = { ...OG_BASE, ...ogLocale('en-GB') };
  assert.match(en.images[0].alt, /Leeds/);
});
