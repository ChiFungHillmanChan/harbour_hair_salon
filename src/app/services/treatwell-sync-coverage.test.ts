import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSyncCoverage, type CoverageStylist } from './treatwell-sync-coverage';
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
  row.calendarConnections[0].lastSuccessAt = new Date(now.getTime() - 46 * 60_000);
  assert.equal(evaluateSyncCoverage({ stylists: [row], now }).safeToEnableOnlineBooking, false);
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
