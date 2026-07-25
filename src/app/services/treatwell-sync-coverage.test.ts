import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSyncCoverage } from './treatwell-sync-coverage';

test('both directions covering every stylist is safe and warning-free', () => {
  const r = evaluateSyncCoverage({ totalStylists: 2, inboundConfigured: 2, outboundConfigured: 2 });
  assert.equal(r.safeToEnableOnlineBooking, true);
  assert.equal(r.warning, null);
  assert.equal(r.missingInbound, 0);
  assert.equal(r.missingOutbound, 0);
});

test('the real production state (nothing configured) is flagged unsafe', () => {
  // 2 stylists, 0 iCal URLs, 0 feed tokens — exactly what prod looked like.
  const r = evaluateSyncCoverage({ totalStylists: 2, inboundConfigured: 0, outboundConfigured: 0 });
  assert.equal(r.safeToEnableOnlineBooking, false);
  assert.equal(r.inboundReady, false);
  assert.equal(r.outboundReady, false);
  assert.match(r.warning ?? '', /Double-booking risk/);
  assert.match(r.warning ?? '', /Treatwell iCal URL/);
  assert.match(r.warning ?? '', /outbound busy-feed token/);
});

test('inbound-only coverage is still unsafe', () => {
  const r = evaluateSyncCoverage({ totalStylists: 3, inboundConfigured: 3, outboundConfigured: 0 });
  assert.equal(r.inboundReady, true);
  assert.equal(r.outboundReady, false);
  assert.equal(r.safeToEnableOnlineBooking, false);
  assert.match(r.warning ?? '', /outbound busy-feed token/);
  assert.doesNotMatch(r.warning ?? '', /Treatwell iCal URL/);
});

test('outbound-only coverage is still unsafe', () => {
  const r = evaluateSyncCoverage({ totalStylists: 3, inboundConfigured: 0, outboundConfigured: 3 });
  assert.equal(r.safeToEnableOnlineBooking, false);
  assert.match(r.warning ?? '', /Treatwell iCal URL/);
  assert.doesNotMatch(r.warning ?? '', /outbound busy-feed token/);
});

test('partial coverage counts the stylists that are missing', () => {
  const r = evaluateSyncCoverage({ totalStylists: 5, inboundConfigured: 3, outboundConfigured: 1 });
  assert.equal(r.missingInbound, 2);
  assert.equal(r.missingOutbound, 4);
  assert.match(r.warning ?? '', /2 of 5/);
  assert.match(r.warning ?? '', /4 of 5/);
});

test('zero stylists is reported as not ready, not silently safe', () => {
  const r = evaluateSyncCoverage({ totalStylists: 0, inboundConfigured: 0, outboundConfigured: 0 });
  assert.equal(r.safeToEnableOnlineBooking, false);
  assert.match(r.warning ?? '', /no stylists are set up/);
});

test('over-counting configured stylists never yields negative missing counts', () => {
  const r = evaluateSyncCoverage({ totalStylists: 2, inboundConfigured: 5, outboundConfigured: 5 });
  assert.equal(r.missingInbound, 0);
  assert.equal(r.missingOutbound, 0);
  assert.equal(r.safeToEnableOnlineBooking, true);
});
