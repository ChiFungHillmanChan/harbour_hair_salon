import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALENDAR_COLORS,
  CALENDAR_COLOR_KEYS,
  DEFAULT_CALENDAR_COLOR,
  isCalendarColorKey,
  resolveCalendarColor,
} from './calendar-colors';

const TAILWIND_BG = /^bg-[a-z]+-\d{2,3}$/;

test('every swatch exposes a complete set of literal Tailwind classes', () => {
  for (const key of CALENDAR_COLOR_KEYS) {
    const swatch = CALENDAR_COLORS[key];
    assert.match(swatch.fill, TAILWIND_BG, `${key}.fill`);
    assert.match(swatch.stripe, TAILWIND_BG, `${key}.stripe`);
    assert.match(swatch.swatch, TAILWIND_BG, `${key}.swatch`);
    assert.equal(swatch.text, 'text-white', `${key}.text`);
    assert.ok(swatch.label.length > 0, `${key}.label`);
  }
});

test('the source file builds no class name by interpolation', () => {
  // The bug this guards against is invisible in dev and only appears in a
  // production build: Tailwind v4 finds classes by scanning source TEXT, so a
  // name assembled at runtime (`bg-${key}-600`) is never emitted into the
  // stylesheet and every calendar block ships unstyled.
  const source = readFileSync(new URL('./calendar-colors.ts', import.meta.url), 'utf8');
  // Comments are stripped first: the module's own documentation quotes the
  // forbidden `bg-${key}-600` pattern as the thing to avoid, and the guard is
  // about what the code does, not what the prose says.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/["'`](bg|text)-\$\{/.test(code),
    'class names must be written out in full, never interpolated',
  );
});

test('swatches are visually distinct from one another', () => {
  const fills = CALENDAR_COLOR_KEYS.map((key) => CALENDAR_COLORS[key].fill);
  assert.equal(new Set(fills).size, fills.length, 'two swatches share a fill colour');
});

test('there are enough swatches for a salon roster', () => {
  assert.ok(CALENDAR_COLOR_KEYS.length >= 8, 'want at least one colour per stylist with room to spare');
});

test('an unassigned colour falls back to the existing zinc treatment', () => {
  assert.deepEqual(resolveCalendarColor(null), DEFAULT_CALENDAR_COLOR);
  assert.deepEqual(resolveCalendarColor(undefined), DEFAULT_CALENDAR_COLOR);
});

test('a key that is no longer in the palette falls back instead of breaking the board', () => {
  // Colours are stored in the database as keys. Retiring a swatch must not turn
  // every historic appointment into an unstyled block.
  assert.deepEqual(resolveCalendarColor('chartreuse'), DEFAULT_CALENDAR_COLOR);
  assert.deepEqual(resolveCalendarColor(''), DEFAULT_CALENDAR_COLOR);
});

test('a known key resolves to its own swatch', () => {
  const key = CALENDAR_COLOR_KEYS[0];
  assert.equal(resolveCalendarColor(key).fill, CALENDAR_COLORS[key].fill);
});

test('isCalendarColorKey guards what the admin forms are allowed to store', () => {
  assert.equal(isCalendarColorKey(CALENDAR_COLOR_KEYS[0]), true);
  assert.equal(isCalendarColorKey('chartreuse'), false);
  assert.equal(isCalendarColorKey(null), false);
});
