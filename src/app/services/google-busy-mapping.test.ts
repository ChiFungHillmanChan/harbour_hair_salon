import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { GoogleEvent } from './google-calendar-gateway';
import { eventInterval, googleBusyBlocks, googleBusyHash } from './google-busy-mapping';
import type { DiaryEntry } from './google-diary-classify';

function entry(kind: DiaryEntry['kind'], stylistIds: string[], id = 'evt1'): DiaryEntry {
  return {
    googleEventId: id, kind, stylistIds, title: 't', colorId: null, allDay: false, htmlLink: null,
    start: new Date('2026-10-20T09:00:00Z'), end: new Date('2026-10-20T10:00:00Z'),
  };
}
function ev(extra: Partial<GoogleEvent>): GoogleEvent {
  return { id: 'e', status: 'confirmed', start: { dateTime: '2026-10-20T10:00:00+01:00' }, end: { dateTime: '2026-10-20T11:00:00+01:00' }, ...extra };
}

test('only STYLIST and LEAVE entries are busy time; UNASSIGNED and NOTE never are (spec §5)', () => {
  const blocks = googleBusyBlocks([entry('STYLIST', ['ivan'], 'a'), entry('LEAVE', ['lox', 'funky'], 'b'), entry('UNASSIGNED', [], 'c'), entry('NOTE', [], 'd')]);
  assert.deepEqual(blocks.map((block) => block.stylistId), ['ivan', 'lox', 'funky']);
});

test('externalUid is sha256(eventId::stylistId); a repeated stylist id gives one block', () => {
  const [block, ...rest] = googleBusyBlocks([entry('LEAVE', ['ivan', 'ivan'])]);
  assert.equal(rest.length, 0);
  assert.equal(block.externalUid, createHash('sha256').update('evt1::ivan').digest('hex'));
  assert.equal(block.start.toISOString(), '2026-10-20T09:00:00.000Z');
});

test('an all-day event on the BST to GMT change day spans 25 hours; no end covers one day; bad times are null', () => {
  const day = eventInterval(ev({ start: { date: '2026-10-25' }, end: { date: '2026-10-26' } }))!;
  assert.equal(day.start.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal((day.end.getTime() - day.start.getTime()) / 3_600_000, 25);
  const single = eventInterval(ev({ start: { date: '2026-10-24' }, end: undefined }))!;
  assert.equal(single.end.toISOString(), '2026-10-24T23:00:00.000Z');
  for (const bad of [{ start: undefined }, { end: { dateTime: '2026-10-20T10:00:00+01:00' } }, { start: { dateTime: 'nonsense' } }, { start: { date: '2026-13-45' }, end: undefined }]) {
    assert.equal(eventInterval(ev(bad as Partial<GoogleEvent>)), null, JSON.stringify(bad));
  }
});

test('the busy hash ignores order and changes with content', () => {
  const a = googleBusyBlocks([entry('LEAVE', ['ivan'], 'a'), entry('STYLIST', ['lox'], 'b')]);
  assert.equal(googleBusyHash(a), googleBusyHash([...a].reverse()));
  assert.notEqual(googleBusyHash(a), googleBusyHash(a.slice(1)));
  assert.equal(googleBusyHash([]), googleBusyHash([]));
});
