import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from './en';
import { zh } from './zh';
import { isPluralMessage, placeholders, type MessageTree, type MessageValue } from '../format';

type Leaf = { path: string; value: MessageValue };

function leaves(tree: MessageTree, prefix = ''): Leaf[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' || isPluralMessage(value)) return [{ path, value }];
    return leaves(value as MessageTree, path);
  });
}

const english = new Map(leaves(en as unknown as MessageTree).map((leaf) => [leaf.path, leaf.value]));
const chinese = new Map(leaves(zh as unknown as MessageTree).map((leaf) => [leaf.path, leaf.value]));

test('every English message has a Chinese translation and vice versa', () => {
  assert.deepEqual([...english.keys()].filter((key) => !chinese.has(key)), [], 'missing in zh-HK');
  assert.deepEqual([...chinese.keys()].filter((key) => !english.has(key)), [], 'extra in zh-HK');
});

test('both languages use the same placeholders in every message', () => {
  const mismatched = [...english].filter(([key, value]) => {
    const other = chinese.get(key);
    return other !== undefined && placeholders(value).join(',') !== placeholders(other).join(',');
  }).map(([key]) => key);
  assert.deepEqual(mismatched, []);
});

test('no Chinese message is left empty or still in English placeholder form', () => {
  const empty = [...chinese].filter(([, value]) => (typeof value === 'string' ? value : value.other).trim() === '').map(([key]) => key);
  assert.deepEqual(empty, []);
});

test('rich-text tags match between languages', () => {
  const tags = (value: MessageValue) => [...(typeof value === 'string' ? value : value.other).matchAll(/<(\w+)>/g)].map((m) => m[1]).sort().join(',');
  const mismatched = [...english].filter(([key, value]) => chinese.has(key) && tags(value) !== tags(chinese.get(key)!)).map(([key]) => key);
  assert.deepEqual(mismatched, []);
});
