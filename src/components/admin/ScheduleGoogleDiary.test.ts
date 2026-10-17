import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadServerModule } from '../../test/load-server-module';
import { translator } from '../../i18n/messages';
import type { Namespace } from '../../i18n/messages';
import type { Locale } from '../../i18n/config';
import type { CalendarDiaryEntry } from '../../app/lib/calendar-diary-display';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'string' || typeof node === 'number' ? String(node)
  : node && typeof node === 'object' && 'props' in node ? text((node as Element).props.children) : '';
const hooks = {
  useMemo: (run: () => unknown) => run(),
  useState: (value: unknown) => [value, () => undefined],
  useRef: (value: unknown) => ({ current: value }),
};
// The real i18n client hooks need a browser React; the page language's text is asserted.
const i18n = (locale: Locale) => ({ useT: (namespace: Namespace) => translator(locale, namespace), useLocale: () => locale });

const DAY = '2026-10-23'; // BST: 13:00Z is 14:00 in London
const entry = (id: string, kind: CalendarDiaryEntry['kind'], stylistIds: string[], title: string, colorId: string | null, start: string, end: string): CalendarDiaryEntry =>
  ({ id, kind, stylistIds, title, colorId, start, end, allDay: false, htmlLink: `https://www.google.com/calendar/event?eid=${id}` });
const ENTRIES = [
  entry('amy', 'STYLIST', ['lox'], 'Amy 07700', '5', '2026-10-23T13:00:00Z', '2026-10-23T14:00:00Z'),
  entry('walkin', 'UNASSIGNED', [], 'Cut - Erin(W)', '11', '2026-10-23T14:00:00Z', '2026-10-23T15:00:00Z'),
  entry('late', 'LEAVE', ['lox', 'funky'], '遲返 (L)(F)', '8', '2026-10-23T09:00:00Z', '2026-10-23T10:00:00Z'),
  entry('note', 'NOTE', [], '卡機', '8', '2026-10-23T11:00:00Z', '2026-10-23T11:30:00Z'),
];
const STYLISTS = [
  { id: 'funky', name: 'Funky', calendarColor: null, googleColorId: '2', availability: { startTime: '10:00', endTime: '19:00' }, availabilityByWeekday: { 5: { startTime: '10:00', endTime: '19:00' } } },
  { id: 'lox', name: 'Lox', calendarColor: null, googleColorId: '5', availability: { startTime: '10:00', endTime: '19:00' }, availabilityByWeekday: { 5: { startTime: '10:00', endTime: '19:00' } } },
];
const BOOKING = { id: 'web', stylistId: 'lox', date: '2026-10-23T15:00:00Z', durationMin: 60, status: 'CONFIRMED', customerName: 'Web Customer', serviceName: 'Cut', serviceColor: null, updatedAt: '2026-10-01T00:00:00Z' };

function render(view: 'Day' | 'Week', entries = ENTRIES, locale: Locale = 'en-GB', selected: CalendarDiaryEntry[] = []) {
  const grid = loadServerModule<Record<string, (props: Record<string, unknown>) => unknown>>(`src/components/admin/Schedule${view}Grid.tsx`, {
    react: hooks, '@/i18n/client': i18n(locale), './MoveConfirmDialog': { MoveConfirmDialog: () => null },
    // Stubbed like every child component in these trees: the real one would pull in a browser React.
    './GoogleDiaryNotes': { GoogleDiaryNotes: () => null },
  });
  return elements(grid[`Schedule${view}Grid`]({
    day: new Date(`${DAY}T12:00:00Z`), dayKeys: [DAY], todayKey: DAY, stylists: STYLISTS, appointments: [BOOKING], busyBlocks: [],
    diaryEntries: entries, onSelectDiary: (picked: CalendarDiaryEntry) => selected.push(picked),
  }));
}
const labelled = (nodes: Element[], words: string) => nodes.filter((node) => String(node.props['aria-label'] ?? '').includes(words));

test('day view: a No stylist column for a walk-in, in Google’s tomato with its Google title and badge', () => {
  const nodes = render('Day');
  assert.ok(nodes.some((node) => text(node) === 'No stylist'));
  const [walkIn] = labelled(nodes, 'Cut - Erin(W)');
  assert.match(String(walkIn.props.className), /bg-\[#d50000\]/);
  assert.match(String(walkIn.props.className), /text-white/);
  assert.ok(elements(walkIn).some((node) => text(node) === 'Google'));
});

test('day view: no walk-in that day, no No stylist column', () => {
  assert.ok(!render('Day', ENTRIES.filter((e) => e.kind !== 'UNASSIGNED')).some((node) => text(node) === 'No stylist'));
});

// Child components (GoogleDiaryNotes) are elements, not rendered output, in these trees:
// the strip is found by its `notes` prop, and GoogleDiaryNotes is rendered on its own below.
const strip = (nodes: Element[]) => nodes.find((node) => Array.isArray(node.props.notes));

test('day view: a leave naming two stylists sits in both columns; a note goes to the strip, never a column', () => {
  const nodes = render('Day');
  assert.equal(labelled(nodes, '遲返 (L)(F)').length, 2);
  assert.deepEqual((strip(nodes)!.props.notes as CalendarDiaryEntry[]).map((e) => e.id), ['note']);
  assert.equal(labelled(nodes, '卡機').length, 0);
});

test('the notes strip: one button per note, labelled with its title and time', () => {
  const notes = loadServerModule<typeof import('./GoogleDiaryNotes')>('src/components/admin/GoogleDiaryNotes.tsx', { react: hooks, '@/i18n/client': i18n('en-GB') });
  const selected: CalendarDiaryEntry[] = [];
  const nodes = elements(notes.GoogleDiaryNotes({ notes: [{ ...ENTRIES[3], startMin: 720, endMin: 750 }], onSelect: (e: CalendarDiaryEntry) => selected.push(e) }));
  assert.ok(nodes.some((node) => node.props['data-testid'] === 'diary-notes'));
  const [button] = labelled(nodes, '卡機 · 12:00–12:30 · Google');
  (button.props.onClick as () => void)();
  assert.deepEqual(selected.map((e) => e.id), ['note']);
  assert.equal(elements(notes.GoogleDiaryNotes({ notes: [], onSelect: () => undefined })).length, 0);
});

test('day view: Google entries are read-only; a click opens the panel and never starts a booking', () => {
  const selected: CalendarDiaryEntry[] = [];
  const [amy] = labelled(render('Day', ENTRIES, 'en-GB', selected), 'Amy 07700');
  assert.equal(amy.props.onPointerDown, undefined, 'not draggable');
  let stopped = false;
  (amy.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(selected.map((e) => e.id), ['amy']);
});

test('day view: a website booking takes its stylist’s Google colour', () => {
  const booking = render('Day').find((node) => node.props.onPointerDown && String(node.props.className).includes('cursor-grab'))!;
  assert.match(String(booking.props.className), /bg-\[#f6bf26\]/);
  assert.match(String(booking.props.className), /text-zinc-950/);
});

test('week view: the same entries, compact, in their Google colours', () => {
  const nodes = render('Week');
  assert.match(String(labelled(nodes, 'Cut - Erin(W)')[0].props.className), /bg-\[#d50000\]/);
  assert.equal(labelled(nodes, '遲返 (L)(F)').length, 1, 'one block per entry in the week');
  assert.deepEqual((strip(nodes)!.props.notes as CalendarDiaryEntry[]).map((e) => e.id), ['note']);
});

test('Chinese labels', () => {
  assert.ok(render('Day', ENTRIES, 'zh-HK').some((node) => text(node) === '未指定髮型師'));
});

test('the panel: title, kind, stylists and an Open in Google Calendar link only for a Google link', () => {
  const panel = loadServerModule<typeof import('./GoogleDiaryPanel')>('src/components/admin/GoogleDiaryPanel.tsx', { react: hooks, '@/i18n/client': i18n('en-GB') });
  const nodes = elements(panel.GoogleDiaryPanel({ entry: ENTRIES[2], stylistNames: { lox: 'Lox', funky: 'Funky' }, onClose: () => undefined }));
  const link = nodes.find((node) => node.type === 'a')!;
  assert.deepEqual([link.props.href, link.props.target, link.props.rel, text(link)],
    ['https://www.google.com/calendar/event?eid=late', '_blank', 'noopener noreferrer', 'Open in Google Calendar']);
  assert.ok(nodes.some((node) => text(node) === 'Leave or away: blocks the stylists named'));
  assert.ok(nodes.some((node) => text(node) === 'Lox, Funky'));
  const plain = elements(panel.GoogleDiaryPanel({ entry: { ...ENTRIES[2], htmlLink: null }, stylistNames: {}, onClose: () => undefined }));
  assert.ok(!plain.some((node) => node.type === 'a'));
});
