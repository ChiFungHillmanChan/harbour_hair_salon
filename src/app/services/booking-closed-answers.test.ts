import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture } from '../../test/booking-fixture';
import { ANY_STYLIST_ID } from '../lib/booking-constants';
import { isBookingClosedAnswer } from '../../components/booking/closed-answer';

/**
 * Online booking can close while the wizard is open: the nightly pause when the
 * calendar feeds go stale, or staff switching it off. Every answer the wizard
 * gets from then on must read as "closed", so it can show what /book shows
 * when closed — never "no appointments available".
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const request = (stylistId: string) => ({
  stylistId, serviceId: 'service-1', date: '2026-10-06', time: '11:00',
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
});

test('closed at the page gate: the date strip and the time lists answer "closed"', async () => {
  const f = fixture({ enabled: false });
  for (const answer of [
    await f.actions.fetchBookingDays('funky', ['2026-10-06'], 60),
    await f.actions.fetchSlots('funky', '2026-10-06', 60),
    await f.actions.fetchSlots(ANY_STYLIST_ID, '2026-10-06', 60),
  ]) {
    assert.deepEqual(answer, { ok: false, reason: 'CLOSED' });
    assert.equal(isBookingClosedAnswer(answer), true);
  }
});

for (const stylistId of ['funky', ANY_STYLIST_ID]) {
  test(`closed at the page gate: confirming (${stylistId}) answers "closed" and books nothing`, async () => {
    const f = fixture({ enabled: false });
    const answer = await f.actions.submitBooking(request(stylistId));
    assert.equal(!answer.success && answer.code, 'MAINTENANCE');
    assert.equal(isBookingClosedAnswer(answer), true);
    assert.equal(f.rows.length, 0);
  });

  test(`closed between loading the times and confirming (${stylistId}): the transaction's answer is "closed" too`, async () => {
    const f = fixture({ ready: false });
    const answer = await f.actions.submitBooking(request(stylistId));
    assert.equal(!answer.success && answer.code, 'MAINTENANCE');
    assert.match(!answer.success ? answer.error : '', /Online booking is closed/);
    assert.equal(isBookingClosedAnswer(answer), true);
    assert.equal(f.rows.length, 0);
    assert.equal(f.notices.length, 0);
  });
}

test('a time that is simply taken is not "closed"', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.submitBooking(request('funky')), { success: true });
  f.rows[0].userId = 'someone-else';
  const answer = await f.actions.submitBooking(request('funky'));
  assert.equal(!answer.success && answer.code, 'SLOT_UNAVAILABLE');
  assert.equal(isBookingClosedAnswer(answer), false);
});
