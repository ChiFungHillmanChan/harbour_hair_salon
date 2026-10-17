import test from 'node:test';
import assert from 'node:assert/strict';
import type { GoogleEvent } from './google-calendar-gateway';
import { googleEventIdFor } from './google-calendar-event';
import {
  classifyDiaryEvent, diaryEntriesFrom, diaryHash, stylistsNamedIn, type DiaryConfig, type DiaryStylist,
} from './google-diary-classify';

// The real roster and diary (spec §2, §3; colour ids confirmed against the API 2026-10-17).
const IVAN: DiaryStylist = { id: 'ivan', name: 'Ivan', googleColorId: '1', googleAliases: null };
const FUNKY: DiaryStylist = { id: 'funky', name: 'Funky', googleColorId: '2', googleAliases: 'F' };
const LOX: DiaryStylist = { id: 'lox', name: 'Lox', googleColorId: '5', googleAliases: 'L' };
const SHANIA: DiaryStylist = { id: 'shania', name: 'Shania', googleColorId: null, googleAliases: '天' };
const CONFIG: DiaryConfig = { stylists: [IVAN, FUNKY, LOX, SHANIA], unassignedColorId: '11', leaveColorId: '8' };

function ev(summary: string | undefined, extra: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt1', status: 'confirmed', summary,
    start: { dateTime: '2026-10-20T10:00:00+01:00' }, end: { dateTime: '2026-10-20T11:00:00+01:00' },
    ...extra,
  };
}
const kindOf = (summary: string, extra?: Partial<GoogleEvent>) => classifyDiaryEvent(ev(summary, extra), CONFIG);

test('a stylist colour is that stylist, whatever the title says (rule 3)', () => {
  assert.deepEqual(kindOf('Cut - Erin(W)', { colorId: '1' }), { kind: 'STYLIST', stylistIds: ['ivan'] });
  assert.deepEqual(kindOf('07700 900123 Amy', { colorId: '2' }), { kind: 'STYLIST', stylistIds: ['funky'] });
  assert.deepEqual(kindOf('Ivan off', { colorId: '5' }), { kind: 'STYLIST', stylistIds: ['lox'] });
});

test('the no-stylist colour is UNASSIGNED (rule 4): walk-ins and Treatwell', () => {
  for (const title of ['Cut - Erin(W)', 'TW L', 'Ivan off']) {
    assert.deepEqual(kindOf(title, { colorId: '11' }), { kind: 'UNASSIGNED', stylistIds: [] }, title);
  }
});

test('real leave titles block the stylists they name (rule 5)', () => {
  const cases: [string, string[]][] = [
    ['FunkyOff(F)', ['funky']], ['早走(L)', ['lox']], ['遲返 (L)(F)', ['funky', 'lox']], ['天off', ['shania']],
    ['LoxOff', ['lox']], ['lox off', ['lox']], ['Day off lox', ['lox']], ['Ivan off', ['ivan']], ['lox.', ['lox']],
    ['天 driving lesson', ['shania']], ['早走（L）', ['lox']], ['( F ) late', ['funky']], ["Ivan's dentist", ['ivan']],
  ];
  for (const [title, ids] of cases) assert.deepEqual(kindOf(title, { colorId: '8' }), { kind: 'LEAVE', stylistIds: ids }, title);
});

test('titles that name nobody are notes and block nothing (D5): one letter outside brackets, names glued into words', () => {
  for (const title of ['卡機', '檢查消防', '見工 zayn', 'GhD Con', 'TW L', 'Loxley', 'Ivana party', 'L-shaped mirror', 'F', '']) {
    assert.deepEqual(kindOf(title, { colorId: '8' }), { kind: 'NOTE', stylistIds: [] }, JSON.stringify(title));
  }
  assert.deepEqual(classifyDiaryEvent(ev(undefined, { colorId: '8' }), CONFIG), { kind: 'NOTE', stylistIds: [] });
});

test('any other colour, or none, is read by names exactly like the leave colour', () => {
  assert.deepEqual(kindOf('Ivan off', { colorId: '3' }), { kind: 'LEAVE', stylistIds: ['ivan'] });
  assert.deepEqual(kindOf('Ivan off'), { kind: 'LEAVE', stylistIds: ['ivan'] });
  assert.deepEqual(kindOf('卡機'), { kind: 'NOTE', stylistIds: [] });
});

test('transparency is ignored: "Show as available" leave still blocks (rule 6, amended)', () => {
  assert.deepEqual(
    kindOf('天off', { colorId: '8', transparency: 'transparent', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }),
    { kind: 'LEAVE', stylistIds: ['shania'] },
  );
  assert.deepEqual(kindOf('LoxOff', { colorId: '8', transparency: 'transparent' }), { kind: 'LEAVE', stylistIds: ['lox'] });
  assert.deepEqual(kindOf('Walk-in', { colorId: '11', transparency: 'transparent' }), { kind: 'UNASSIGNED', stylistIds: [] });
  assert.deepEqual(kindOf('Amy', { colorId: '1', transparency: 'transparent' }), { kind: 'STYLIST', stylistIds: ['ivan'] });
});

test('website events and cancelled events are skipped entirely (rules 1–2); tentative ones are not', () => {
  assert.equal(kindOf('Ivan · Amy · Cut', { colorId: '1', extendedProperties: { private: { harbourAppointmentId: 'a1' } } }), null);
  assert.equal(kindOf('Ivan · Amy · Cut', { id: googleEventIdFor('a1') }), null);
  assert.equal(kindOf('Ivan off', { status: 'cancelled' }), null);
  assert.deepEqual(kindOf('Ivan off', { status: 'tentative' }), { kind: 'LEAVE', stylistIds: ['ivan'] });
});

test('two active stylists holding one colour (refused by the form, possible after a reactivation) are both blocked', () => {
  const twins: DiaryConfig = { ...CONFIG, stylists: [IVAN, { ...LOX, googleColorId: '1' }] };
  assert.deepEqual(classifyDiaryEvent(ev('x', { colorId: '1' }), twins), { kind: 'STYLIST', stylistIds: ['ivan', 'lox'] });
});

test('names with regex characters are literal; multi-word names match as a phrase', () => {
  const dotted: DiaryStylist = { id: 'ab', name: 'A.B', googleColorId: null, googleAliases: null };
  assert.deepEqual(stylistsNamedIn('AxB off', [dotted]), []);
  assert.deepEqual(stylistsNamedIn('A.B off', [dotted]), ['ab']);
  const synthetic: DiaryStylist = { id: 's', name: 'Synthetic Stylist', googleColorId: null, googleAliases: null };
  assert.deepEqual(stylistsNamedIn('Synthetic Stylist: dentist', [synthetic]), ['s']);
});

test('entries: intervals, all-day salon days across the clock change, titles cut to 200 characters, Google links only', () => {
  const [allDay, timed] = diaryEntriesFrom([
    ev('天off', { id: 'e1', colorId: '8', transparency: 'transparent', start: { date: '2026-10-25' }, end: { date: '2026-10-26' }, htmlLink: 'https://www.google.com/calendar/event?eid=YWJjMTIz' }),
    ev(`  ${'長'.repeat(250)}  `, { id: 'e2', colorId: '11', htmlLink: 'javascript:alert(1)' }),
  ], CONFIG);
  assert.deepEqual([allDay.googleEventId, allDay.kind, allDay.stylistIds, allDay.allDay, allDay.colorId], ['e1', 'LEAVE', ['shania'], true, '8']);
  assert.equal(allDay.start.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(allDay.end.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(allDay.htmlLink, 'https://www.google.com/calendar/event?eid=YWJjMTIz');
  assert.equal(timed.title, '長'.repeat(200));
  assert.deepEqual([timed.kind, timed.allDay, timed.htmlLink], ['UNASSIGNED', false, null]);
  assert.equal(diaryEntriesFrom([ev('x', { htmlLink: 'https://evil.example/calendar/event?eid=1' })], CONFIG)[0].htmlLink, null);
});

test('entries skip website, cancelled and malformed events; a repeated id is stored once; an unknown colour is null', () => {
  const entries = diaryEntriesFrom([
    ev('Ivan off', { id: 'a' }),
    ev('Ivan off again', { id: 'a' }),
    ev('website', { id: googleEventIdFor('x') }),
    ev('gone', { id: 'b', status: 'cancelled' }),
    ev('bad', { id: 'c', start: { dateTime: 'nonsense' } }),
    ev('odd colour', { id: 'd', colorId: '42' }),
  ], CONFIG);
  assert.deepEqual(entries.map((entry) => [entry.googleEventId, entry.title, entry.colorId]), [['a', 'Ivan off', null], ['d', 'odd colour', null]]);
});

test('the diary hash ignores order and changes with any shown field', () => {
  const entries = diaryEntriesFrom([ev('Ivan off', { id: 'a' }), ev('卡機', { id: 'b' })], CONFIG);
  assert.equal(diaryHash(entries), diaryHash([...entries].reverse()));
  assert.match(diaryHash(entries), /^[0-9a-f]{64}$/);
  assert.notEqual(diaryHash(entries), diaryHash([{ ...entries[0], title: 'Ivan off (dentist)' }, entries[1]]));
  assert.notEqual(diaryHash(entries), diaryHash([{ ...entries[0], colorId: '8' }, entries[1]]));
  assert.notEqual(diaryHash(entries), diaryHash([{ ...entries[0], end: new Date(entries[0].end.getTime() + 60_000) }, entries[1]]));
  assert.notEqual(diaryHash(entries), diaryHash(entries.slice(1)));
});
