import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { locale, messages, parseLocale, t } from './i18n.js';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');

// Tokenize this bounded static HTML without introducing a browser or an HTML dependency.
// Quoted attributes may contain Tailwind's > selectors, so splitting on > alone is unsafe.
function copyFromMarkup(markup) {
  const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0' }[entity];
  });
  const copy = new Set();
  for (const token of markup.match(/<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g) || []) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('<')) {
      const attributes = Object.fromEntries([...token.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
      for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
        if (attributes[name]) copy.add(attributes[name]);
      }
      if (attributes.name === 'description') copy.add(attributes.content);
    } else {
      const value = decode(token.trim());
      if (/[a-z]/i.test(value)) copy.add(value);
    }
  }
  return copy;
}

test('the explicit query supports Chinese aliases and defaults all other languages to English', () => {
  for (const query of ['?lang=zh-HK', '?lang=ZH-hk', '?lang=zh', '?lang=zh_TW', '?lang=zh-Hant', '?LANG=zh-CN', '?x=1&lang=zh-hk']) {
    assert.equal(parseLocale(query), 'zh-HK', query);
  }
  for (const query of ['', '?lang=', '?lang=en-GB', '?lang=en-US', '?lang=fr', '?lang=zhfoo', '?locale=zh-HK']) {
    assert.equal(parseLocale(query), 'en-GB', query);
  }
  assert.equal(locale, 'en-GB', 'Node/test environments have the same safe English default');
  assert.equal(t('Walk inside', 'zh-HK'), '步行導覽', 'the caption matches the website instructions');
  assert.equal(t('constructor', 'zh-HK'), 'constructor', 'translation lookup ignores inherited object properties');
});

test('all static visible and accessibility copy has a Traditional Chinese translation', () => {
  const unchanged = new Set(['harbour hair', 'Unit 15, Central Arcade, Leeds LS1 6DX']);
  const copy = copyFromMarkup(html);
  assert.ok(copy.size > 80, 'the scan includes dialog, metadata and accessibility copy');
  assert.ok(copy.has('Model') && copy.has('Walk') && copy.has('Plan'), 'compact landscape labels are included');
  assert.ok(copy.has('Close view settings') && copy.has('Your current Harbour Hair 3D salon view'), 'reader-facing attributes are included');
  const missing = [...copy].filter((english) => !unchanged.has(english) && !Object.hasOwn(messages, english));
  assert.deepEqual(missing, [], 'New UI copy must be added to i18n.js');
  for (const english of copy) {
    assert.equal(t(english, 'en-GB'), english, 'English copy is unchanged');
    if (!unchanged.has(english)) assert.match(t(english, 'zh-HK'), /[\u3400-\u9fff]/u, english);
  }
});

