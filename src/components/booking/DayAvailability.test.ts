import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  const rendered = typeof element.type === 'function' ? (element.type as (p: unknown) => unknown)(element.props) : null;
  return [element, ...elements(element.props.children), ...elements(rendered)];
}
const text = (nodes: Element[]) => nodes.flatMap((node) => [node.props.children].flat().filter((c) => typeof c === 'string' || typeof c === 'number')).join(' ');
const ui = loadServerModule<typeof import('./DayAvailability')>('src/components/booking/DayAvailability.tsx', {
  '@/i18n/client': { useT: (namespace: Namespace) => translator('en-GB', namespace) },
});

test('an unavailable date is greyed, labelled Unavailable, and still selectable to show the block', () => {
  let selected = false;
  const nodes = elements(ui.DayChip({ weekday: 'Tue', dayOfMonth: 6, month: 'Oct', fullLabel: 'Tuesday 6 October', selected: false, unavailable: true, onSelect: () => { selected = true; } }));
  const button = nodes.find((node) => node.type === 'button')!;
  assert.equal(button.props['aria-label'], 'Tuesday 6 October, unavailable');
  assert.match(String(button.props.className), /text-zinc-400/);
  assert.ok(text(nodes).includes('Unavailable'));
  (button.props.onClick as () => void)();
  assert.equal(selected, true);
});

test('an open date keeps its plain label and month', () => {
  const nodes = elements(ui.DayChip({ weekday: 'Mon', dayOfMonth: 5, month: 'Oct', fullLabel: 'Monday 5 October', selected: false, unavailable: false, onSelect: () => undefined }));
  const button = nodes.find((node) => node.type === 'button')!;
  assert.equal(button.props['aria-label'], 'Monday 5 October');
  assert.ok(text(nodes).includes('Oct'));
  assert.ok(!text(nodes).includes('Unavailable'));
});

test('the whole-day block says Unavailable with the hours and who', () => {
  const nodes = elements(ui.UnavailableDayBlock({ hours: { start: '10:15', end: '19:00' }, stylistName: 'Funky' }));
  const words = text(nodes);
  assert.ok(words.includes('Unavailable'));
  assert.ok(words.includes('10:15 – 19:00'));
  assert.ok(words.includes('Funky isn’t available on this day.'));
});

test('the whole-day block for Anyone names nobody and shows no hours when nobody is rostered', () => {
  const words = text(elements(ui.UnavailableDayBlock({ hours: null, stylistName: null })));
  assert.ok(words.includes('No stylist is available on this day.'));
  assert.ok(!/\d\d:\d\d/.test(words));
});

test('taken times are shown greyed and cannot be picked', () => {
  const picked: string[] = [];
  const nodes = elements(ui.TimeSlotGrid({ slots: [{ time: '10:00', available: true }, { time: '10:30', available: false }], selectedTime: null, onSelect: (time) => picked.push(time) }));
  const buttons = nodes.filter((node) => node.type === 'button');
  assert.equal(buttons.length, 2);
  const taken = buttons.find((node) => node.props['aria-label'] === '10:30, unavailable')!;
  assert.equal(taken.props.disabled, true);
  assert.match(String(taken.props.className), /line-through/);
  (taken.props.onClick as () => void)();
  (buttons[0].props.onClick as () => void)();
  assert.deepEqual(picked, ['10:00']);
});

test('a selected free time is marked pressed', () => {
  const nodes = elements(ui.TimeSlotGrid({ slots: [{ time: '10:00', available: true }, { time: '10:30', available: true }], selectedTime: '10:30', onSelect: () => undefined }));
  const pressed = nodes.filter((node) => node.type === 'button' && node.props['aria-pressed'] === true);
  assert.deepEqual(pressed.map((node) => node.props['aria-label']), ['10:30']);
});

test('times are grouped into morning, afternoon and evening', () => {
  const words = text(elements(ui.TimeSlotGrid({ slots: [{ time: '10:00', available: true }, { time: '13:00', available: false }, { time: '17:30', available: true }], selectedTime: null, onSelect: () => undefined })));
  assert.ok(words.includes('Morning') && words.includes('Afternoon') && words.includes('Evening'));
});
