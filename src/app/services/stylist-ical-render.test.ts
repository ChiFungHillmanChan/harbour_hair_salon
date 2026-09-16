import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderIcalFeed, tokenMatches, type BusyEvent } from './stylist-ical-feed';

const NOW = new Date('2026-07-21T12:00:00Z');
const at = (iso: string, minutes: number, id = 'a1'): BusyEvent => ({
  id, startMs: new Date(iso).getTime(), minutes,
});

test('renderIcalFeed re-applies the "already ended" cut against the CURRENT time', () => {
  // The whole point of caching rows rather than the rendered body: the same
  // event list must drop the past event once `now` moves past its end.
  const events = [at('2026-07-21T11:00:00Z', 30, 'ended')];
  assert.match(renderIcalFeed(events, new Date('2026-07-21T11:20:00Z')), /UID:ended@/);
  assert.doesNotMatch(renderIcalFeed(events, NOW), /UID:ended@/);
});

test('renderIcalFeed stamps DTSTAMP from the current time, not the cached rows', () => {
  const body = renderIcalFeed([at('2026-08-05T09:00:00Z', 30)], NOW);
  assert.match(body, /DTSTAMP:20260721T120000Z/);
});

test('renderIcalFeed emits CRLF and leaks no customer fields', () => {
  const body = renderIcalFeed([at('2026-08-05T09:05:00Z', 45)], NOW);
  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(body.trimEnd().endsWith('END:VCALENDAR'));
  assert.doesNotMatch(body, /[^\r]\n/);
  assert.match(body, /DTSTART:20260805T090500Z/);
  assert.match(body, /DTEND:20260805T095000Z/);
  assert.doesNotMatch(body, /name|email|notes/i);
});

test('tokenMatches rejects empty, absent and mismatched tokens', () => {
  assert.equal(tokenMatches('tok', 'tok'), true);
  assert.equal(tokenMatches('tok', 'other-token'), false);
  assert.equal(tokenMatches('', ''), false);
  assert.equal(tokenMatches('tok', null), false);
  assert.equal(tokenMatches('', 'tok'), false);
  // Differing UTF-8 byte length with equal UTF-16 length must not throw.
  assert.equal(tokenMatches('é', 'e'), false);
});

const cacheSource = readFileSync(join(process.cwd(), 'src/app/services/stylist-ical-cache.ts'), 'utf8');

test('the busy-feed cache window stays well clear of Neon\'s 5-minute suspend', () => {
  const seconds = Number(/EVENTS_REVALIDATE_SECONDS = ([^;]+);/.exec(cacheSource)?.[1]
    ?.replace(/\s*\*\s*/g, '*').split('*').reduce((a, b) => a * Number(b), 1));
  assert.ok(Number.isFinite(seconds), 'EVENTS_REVALIDATE_SECONDS must be a numeric literal');
  // External pollers hit this feed every 5 minutes. If the window ever drops to
  // that cadence the cache stops absorbing them and Neon is pinned awake again.
  assert.ok(seconds >= 15 * 60, `busy-feed cache window is ${seconds}s — must stay >= 900s`);
});

test('token and events are cached under separate tags', () => {
  // A wrong token must be answered from the token cache alone, never reaching
  // the appointment entry — the cache-layer twin of the "no scan on bad token"
  // guarantee asserted in stylist-ical-feed.test.ts.
  assert.match(cacheSource, /const EVENTS_TAG = 'stylist-ical-feed'/);
  assert.match(cacheSource, /const TOKEN_TAG = 'stylist-ical-token'/);
  const tokenFirst = cacheSource.indexOf('readToken(stylistId)');
  const eventsAfter = cacheSource.indexOf('readBusyEvents(stylistId)');
  assert.ok(tokenFirst > -1 && eventsAfter > tokenFirst, 'token must be checked before events are read');
});

test('every appointment mutation drops the cached feed', () => {
  // A mutation path that forgets this leaves the marketplaces double-booking
  // against a stale feed for up to the whole cache window.
  for (const file of ['booking.ts', 'admin.ts', 'admin-schedule.ts']) {
    const source = readFileSync(join(process.cwd(), 'src/app/actions', file), 'utf8');
    assert.match(source, /invalidateStylistIcalFeed\(\)/, `${file} must invalidate the busy feed`);
  }
  const integrations = readFileSync(join(process.cwd(), 'src/app/actions/admin-integrations.ts'), 'utf8');
  assert.match(integrations, /invalidateStylistIcalToken\(\)/, 'token rotation must invalidate the token cache');
});
