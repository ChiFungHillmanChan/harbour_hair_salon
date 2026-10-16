import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { GoogleEvent } from './google-calendar-gateway';
import { googleBusyBlocks, googleBusyHash } from './google-busy-mapping';

const ivan = { id: 'st-ivan', name: 'Ivan' };
const lox = { id: 'st-lox', name: 'Lox' };
const loxChan = { id: 'st-loxchan', name: 'Lox Chan' };
const stylists = [ivan, lox];

function ev(summary: string | undefined, extra: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt1', status: 'confirmed', summary,
    start: { dateTime: '2026-10-20T10:00:00+01:00' }, end: { dateTime: '2026-10-20T11:00:00+01:00' },
    ...extra,
  };
}
const ids = (events: GoogleEvent[], list = stylists) => googleBusyBlocks(events, list).map((b) => b.stylistId).sort();

test('a title that starts with a stylist name blocks only that stylist', () => {
  for (const title of ['Ivan: dentist', 'ivan - off', 'Ivan', 'IVAN·x', 'Ivan：午飯', 'Ivan  lunch']) {
    assert.deepEqual(ids([ev(title)]), ['st-ivan'], title);
  }
});

test('a name that is only a prefix of a word does not match: whole salon', () => {
  assert.deepEqual(ids([ev('Ivana party')]), ['st-ivan', 'st-lox']);
  assert.deepEqual(ids([ev("Ivana's party")]), ['st-ivan', 'st-lox']);
});

test('the longest stylist name wins', () => {
  assert.deepEqual(ids([ev('Lox Chan holiday')], [lox, loxChan]), ['st-loxchan']);
  assert.deepEqual(ids([ev('Lox holiday')], [loxChan, lox]), ['st-lox']);
});

test('no title or no match blocks every stylist; names with regex specials are literal', () => {
  assert.deepEqual(ids([ev(undefined)]), ['st-ivan', 'st-lox']);
  assert.deepEqual(ids([ev('')]), ['st-ivan', 'st-lox']);
  assert.deepEqual(ids([ev('Bank holiday')]), ['st-ivan', 'st-lox']);
  const dots = { id: 'st-dot', name: 'A.B' };
  assert.deepEqual(ids([ev('AxB lunch')], [dots, ivan]), ['st-dot', 'st-ivan']);
  assert.deepEqual(ids([ev('A.B lunch')], [dots, ivan]), ['st-dot']);
});

test('transparent, cancelled and website events are never blocks', () => {
  assert.deepEqual(googleBusyBlocks([ev('Ivan', { transparency: 'transparent' })], stylists), []);
  assert.deepEqual(googleBusyBlocks([ev('Ivan', { status: 'cancelled' })], stylists), []);
  assert.deepEqual(
    googleBusyBlocks([ev('Ivan · Jane · Haircut', { extendedProperties: { private: { harbourAppointmentId: 'a1' } } })], stylists),
    [],
  );
  // Even a cancelled or transparent website event.
  assert.deepEqual(
    googleBusyBlocks([ev('x', { status: 'cancelled', extendedProperties: { private: { harbourAppointmentId: 'a1' } } })], stylists),
    [],
  );
});

test('a website event whose private property was stripped is still never a block: its id gives it away', () => {
  const websiteId = 'hh' + createHash('sha256').update('harbour-appointment:a1').digest('hex').slice(0, 40);
  assert.deepEqual(googleBusyBlocks([ev('Ivan · Jane · Haircut', { id: websiteId })], stylists), []);
  assert.deepEqual(googleBusyBlocks([ev('Ivan · Jane · Haircut', { id: websiteId, extendedProperties: { private: {} } })], stylists), []);
  // Only the exact shape: anything else is the salon's own event.
  for (const id of [websiteId.slice(0, -1), `${websiteId}0`, websiteId.toUpperCase(), `hh${'v'.repeat(40)}`, 'abc123def456ghi789jkl012mn']) {
    assert.deepEqual(ids([ev('Ivan: dentist', { id })]), ['st-ivan'], id);
  }
});

test('an all-day event on the BST to GMT change day spans 25 hours', () => {
  const [block] = googleBusyBlocks([ev('Ivan', { start: { date: '2026-10-25' }, end: { date: '2026-10-26' } })], [ivan]);
  assert.equal(block.start.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.equal(block.end.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal((block.end.getTime() - block.start.getTime()) / 3_600_000, 25);
});

test('an all-day event without an end covers one day; invalid times are skipped', () => {
  const [block] = googleBusyBlocks([ev('Ivan', { start: { date: '2026-10-24' }, end: undefined })], [ivan]);
  assert.equal(block.start.toISOString(), '2026-10-23T23:00:00.000Z');
  assert.equal(block.end.toISOString(), '2026-10-24T23:00:00.000Z');
  assert.deepEqual(googleBusyBlocks([ev('Ivan', { start: undefined })], [ivan]), []);
  assert.deepEqual(googleBusyBlocks([ev('Ivan', { end: { dateTime: '2026-10-20T10:00:00+01:00' } })], [ivan]), []);
  assert.deepEqual(googleBusyBlocks([ev('Ivan', { start: { dateTime: 'nonsense' } })], [ivan]), []);
});

test('a malformed all-day start without an end is skipped, never thrown; the other events still map', () => {
  for (const date of ['garbage', '2026-13-45', '2026-02-30x', '']) {
    const events = [ev('Ivan', { id: 'bad', start: { date }, end: undefined }), ev('Lox', { id: 'good' })];
    assert.deepEqual(googleBusyBlocks(events, stylists).map((b) => b.stylistId), ['st-lox'], JSON.stringify(date));
  }
});

test('a tentative Google-only event still blocks (only cancelled or transparent ones do not)', () => {
  assert.deepEqual(ids([ev('Ivan: maybe dentist', { status: 'tentative' })]), ['st-ivan']);
  assert.deepEqual(ids([ev('Stock take', { status: 'tentative' })]), ['st-ivan', 'st-lox']);
});

test('externalUid is sha256(eventId::stylistId)', () => {
  const [block] = googleBusyBlocks([ev('Ivan')], stylists);
  assert.equal(block.externalUid, createHash('sha256').update('evt1::st-ivan').digest('hex'));
  assert.equal(block.start.toISOString(), '2026-10-20T09:00:00.000Z');
  assert.equal(block.end.toISOString(), '2026-10-20T10:00:00.000Z');
});

test('the busy hash ignores order and changes with content', () => {
  const a = googleBusyBlocks([ev('Ivan'), ev('Lox', { id: 'evt2' })], stylists);
  const b = [...a].reverse();
  assert.equal(googleBusyHash(a), googleBusyHash(b));
  assert.match(googleBusyHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(googleBusyHash(a), googleBusyHash(a.slice(1)));
  const moved = a.map((x, i) => (i === 0 ? { ...x, end: new Date(x.end.getTime() + 60_000) } : x));
  assert.notEqual(googleBusyHash(moved), googleBusyHash(a));
  assert.equal(googleBusyHash([]), googleBusyHash([]));
});
