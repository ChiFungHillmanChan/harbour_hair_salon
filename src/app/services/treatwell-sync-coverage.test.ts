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
