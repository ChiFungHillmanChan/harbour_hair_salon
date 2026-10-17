import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALENDAR_COLORS,
  CALENDAR_COLOR_KEYS,
  DEFAULT_CALENDAR_COLOR,
  DEFAULT_LEAVE_COLOR_ID,
  DEFAULT_UNASSIGNED_COLOR_ID,
  GOOGLE_COLOR_IDS,
  GOOGLE_EVENT_COLORS,
  GOOGLE_NO_COLOR,
  googleEventSwatch,
  isCalendarColorKey,
  isGoogleColorId,
  resolveCalendarColor,
  stylistSwatch,
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

// Google's own event palette (Google diary mirror, spec §3), verbatim.
const GOOGLE_HEX: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
  '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};
const ZINC_950 = '#09090b';
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('Google palette: the eleven ids in order, Google’s hex, every class a full literal', () => {
  assert.deepEqual(GOOGLE_COLOR_IDS, Object.keys(GOOGLE_HEX));
  for (const id of GOOGLE_COLOR_IDS) {
    const swatch = GOOGLE_EVENT_COLORS[id];
    assert.equal(swatch.hex, GOOGLE_HEX[id], id);
    for (const cls of [swatch.fill, swatch.swatch, swatch.stripe]) assert.equal(cls, `bg-[${GOOGLE_HEX[id]}]`, id);
    assert.ok(swatch.label.length > 0 && swatch.key.length > 0, id);
  }
  assert.deepEqual(GOOGLE_COLOR_IDS.map((id) => GOOGLE_EVENT_COLORS[id].key),
    ['lavender', 'sage', 'grape', 'flamingo', 'banana', 'tangerine', 'peacock', 'graphite', 'blueberry', 'basil', 'tomato']);
});

test('Google palette: text is whichever of white and zinc-950 reads better, and clears WCAG AA', () => {
  for (const id of GOOGLE_COLOR_IDS) {
    const { hex, text } = GOOGLE_EVENT_COLORS[id];
    const white = contrast(hex, '#ffffff');
    const dark = contrast(hex, ZINC_950);
    assert.equal(text, white >= dark ? 'text-white' : 'text-zinc-950', id);
    assert.ok(Math.max(white, dark) >= 4.5, `${id} contrast`);
  }
});

test('Google colour ids, the no-colour grey and the stylist swatch', () => {
  assert.equal(DEFAULT_UNASSIGNED_COLOR_ID, '11');
  assert.equal(DEFAULT_LEAVE_COLOR_ID, '8');
  for (const good of ['1', '8', '11']) assert.equal(isGoogleColorId(good), true, good);
  for (const bad of ['0', '12', '', ' 1', '01', null, undefined, 1, 'toString', '__proto__']) assert.equal(isGoogleColorId(bad), false, String(bad));
  assert.equal(googleEventSwatch('11').fill, 'bg-[#d50000]');
  assert.deepEqual(googleEventSwatch(null), GOOGLE_NO_COLOR);
  assert.deepEqual(googleEventSwatch('99'), GOOGLE_NO_COLOR);
  // The board matches Google: a stylist's Google colour wins over their calendar colour.
  assert.equal(stylistSwatch({ calendarColor: 'teal', googleColorId: '5' }).fill, 'bg-[#f6bf26]');
  assert.equal(stylistSwatch({ calendarColor: 'teal', googleColorId: null }).fill, 'bg-teal-600');
  assert.equal(stylistSwatch({ calendarColor: null }).fill, DEFAULT_CALENDAR_COLOR.fill);
});
