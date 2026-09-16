import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { evaluateSyncCoverage, CALENDAR_FRESHNESS_MINUTES, type CoverageStylist } from './treatwell-sync-coverage';
const now = new Date('2026-09-11T12:00:00Z');
function stylist(): CoverageStylist {
  return { id: 's1', name: 'Stylist one', icalToken: 'secret', availabilities: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOff: dayOfWeek === 0, startTime: '09:00', endTime: '17:00' })), calendarConnections: [{ provider: 'TREATWELL', receivesBookings: true, inboundUrl: 'https://example.com/private', inboundEnabled: true, outboundConfirmedAt: now, lastSuccessAt: now, lastError: null }] };
}
test('a generated token and configured URL do not prove either direction works', () => {
  const row = stylist(); row.calendarConnections[0].lastSuccessAt = null; row.calendarConnections[0].outboundConfirmedAt = null;
  const result = evaluateSyncCoverage({ stylists: [row], now });
  assert.equal(result.safeToEnableOnlineBooking, false);
  assert.equal(result.missingInbound, 1); assert.equal(result.missingOutbound, 1);
});
test('fresh successful empty feeds count, stale feeds and latest failures block readiness', () => {
  const row = stylist();
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, true);
  row.calendarConnections[0].lastSuccessAt = new Date(now.getTime() - (CALENDAR_FRESHNESS_MINUTES + 1) * 60_000);
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, false);
  // The boundary itself still counts, so the window is inclusive of an exactly-on-time feed.
  row.calendarConnections[0].lastSuccessAt = new Date(now.getTime() - CALENDAR_FRESHNESS_MINUTES * 60_000);
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, true);
  row.calendarConnections[0].lastSuccessAt = now; row.calendarConnections[0].lastError = 'HTTP 503';
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, false);
});
test('activity is explicit and independent of public links and stale stored feed URLs', () => {
  const row = stylist(); row.calendarConnections[0].receivesBookings = false;
  row.calendarConnections[0].lastSuccessAt = null; row.calendarConnections[0].outboundConfirmedAt = null;
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, true);
});
test('all active sources must be ready independently; Fresha supports the same feed contract', () => {
  const row = stylist(); row.calendarConnections.push({ ...row.calendarConnections[0], provider: 'FRESHA', lastSuccessAt: null });
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, false);
  row.calendarConnections[1].lastSuccessAt = now;
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, true);
});
test('missing or invalid opening hours and no stylists block booking', () => {
  assert.equal(evaluateSyncCoverage({ stylists: [], now }).safeToEnableOnlineBooking, false);
  const row = stylist(); row.availabilities.pop();
  assert.match(evaluateSyncCoverage({ stylists: [row], now }).warning ?? '', /hours/i);
});
test('readiness reports no inbound URL or tokens in its warning', () => {
  const row = stylist(); row.calendarConnections[0].lastSuccessAt = null;
  const result = evaluateSyncCoverage({ stylists: [row], now });
  assert.doesNotMatch(JSON.stringify(result), /https:|secret/);
});

// Booking readiness is re-checked on every booking attempt, so this window is
// also the grace period online booking gets when a sync run does not land. If
// it ever drops to one cron interval, a single skipped or slow run closes
// public booking for everyone with no signal to the customer.
test('the freshness window survives more than one missed calendar-sync run', async () => {
  const { crons } = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
  const sync = crons.find((job: { path: string }) => job.path === '/api/cron/calendar-sync');
  assert.ok(sync, 'calendar-sync must stay scheduled while any provider receives bookings');
  const everyNMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(sync.schedule);
  assert.ok(everyNMinutes, `Expected a fixed minute interval running every hour, got "${sync.schedule}".`);
  const interval = Number(everyNMinutes[1]);
  // Also guards the reverse mistake: restricting this cron to business hours
  // would let the feed go stale overnight and close booking until morning.
  assert.ok(
    CALENDAR_FRESHNESS_MINUTES >= interval * 3,
    `A ${interval}-minute cron needs at least ${interval * 3} minutes of freshness headroom, not ${CALENDAR_FRESHNESS_MINUTES}.`
  );
});

// `evaluateSyncCoverage` is handed whatever rows the query returns, and it
// demands a complete valid week plus a covered feed from every one of them. A
// retired stylist has neither, so if the query ever stopped filtering them out,
// `safeToEnableOnlineBooking` would be false forever and booking would close
// for the whole salon — with the same silent "online booking is closed" symptom
// the freshness window above exists to prevent.
test('retired stylists are excluded before they can reach the booking gate', async () => {
  const readiness = await readFile(new URL('./integration-readiness.ts', import.meta.url), 'utf8');
  const coverageQuery = readiness.slice(readiness.indexOf('export async function getCalendarSyncCoverage'));
  const body = coverageQuery.slice(0, coverageQuery.indexOf('return evaluateSyncCoverage'));
  assert.match(body, /where:\s*\{\s*isActive:\s*true\s*\}/,
    'getCalendarSyncCoverage must load only active stylists.');

  // The same row would otherwise still be sold on the public site.
  for (const page of ['../page.tsx', '../book/page.tsx']) {
    const source = await readFile(new URL(page, import.meta.url), 'utf8');
    const query = source.slice(source.indexOf('stylist.findMany'));
    assert.match(query.slice(0, 200), /isActive:\s*true/, `${page} must not list retired stylists.`);
  }
});

// A retired stylist keeps their rows, so a stale marketplace URL left on one
// would otherwise be polled every cron cycle: pure Neon compute spend on a feed
// that cannot affect a single bookable slot.
test('the calendar-sync cron skips connections belonging to retired stylists', async () => {
  const source = await readFile(new URL('./calendar-sync-service.ts', import.meta.url), 'utf8');
  const query = source.slice(source.indexOf('calendarConnection.findMany'));
  assert.match(query.slice(0, 600), /stylist:\s*\{\s*isActive:\s*true\s*\}/,
    'syncCalendarFeeds must not poll feeds for retired stylists.');
});
