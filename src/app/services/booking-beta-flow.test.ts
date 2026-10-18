import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture } from '../../test/booking-fixture';
import { ANY_STYLIST_ID } from '../lib/booking-constants';

/**
 * Beta booking (owner decision 2026-10-18): with online booking closed to the
 * public, a signed-in account on the beta list still gets the whole flow — the
 * date strip, the times, and a booking request — while everyone else is told
 * booking is closed. The gate itself is tested in lib/booking-maintenance.test.ts.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const request = (stylistId: string) => ({
  stylistId, serviceId: 'service-1', date: '2026-10-06', time: '11:00',
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
});

for (const stylistId of ['funky', ANY_STYLIST_ID]) {
  test(`beta: a tester sees times and books (${stylistId}) while booking is closed; the booking transaction checks the same account`, async () => {
    const f = fixture({ enabled: false, betaTesters: ['user-1'] });
    const days = await f.actions.fetchBookingDays(stylistId, ['2026-10-06'], 60);
    assert.equal(days.ok, true);
    const slots = await f.actions.fetchSlots(stylistId, '2026-10-06', 60);
    assert.equal(slots.ok, true);
    assert.deepEqual(await f.actions.submitBooking(request(stylistId)), { success: true });
    assert.equal(f.rows.length, 1);
    assert.equal(f.rows[0].userId, 'user-1');
    assert.ok(f.gateUserIds.length >= 3 && f.gateUserIds.every((id) => id === 'user-1'), 'every beta-aware check was about the signed-in account');
  });

  test(`beta: any other signed-in account is told booking is closed (${stylistId}) and books nothing`, async () => {
    const f = fixture({ enabled: false, betaTesters: ['user-1'] });
    f.asCustomer('user-2');
    assert.deepEqual(await f.actions.fetchBookingDays(stylistId, ['2026-10-06'], 60), { ok: false, reason: 'CLOSED' });
    assert.deepEqual(await f.actions.fetchSlots(stylistId, '2026-10-06', 60), { ok: false, reason: 'CLOSED' });
    const answer = await f.actions.submitBooking(request(stylistId));
    assert.equal(!answer.success && answer.code, 'MAINTENANCE');
    assert.equal(f.rows.length, 0);
    assert.equal(f.notices.length, 0);
  });
}

test('beta: a tester is still refused when the authoritative check closes (calendars not ready)', async () => {
  const f = fixture({ enabled: false, ready: false, betaTesters: ['user-1'] });
  const answer = await f.actions.submitBooking(request('funky'));
  assert.equal(!answer.success && answer.code, 'MAINTENANCE');
  assert.equal(f.rows.length, 0);
});

test('beta: while booking is open to everyone, the beta list is never consulted by the lookups', async () => {
  const f = fixture({ betaTesters: [] });
  assert.equal((await f.actions.fetchSlots('funky', '2026-10-06', 60)).ok, true);
  assert.deepEqual(await f.actions.submitBooking(request('funky')), { success: true });
  // Only the booking transaction asks, for the account verifySession proved.
  assert.deepEqual(f.gateUserIds, ['user-1']);
});
