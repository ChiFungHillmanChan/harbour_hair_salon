import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture } from '../../test/booking-fixture';
import { ANY_STYLIST_ID } from '../lib/booking-constants';

/**
 * Online requests wait for staff approval, so a time less than
 * MIN_BOOKING_NOTICE_MINUTES (two hours) away could never be confirmed in
 * time. The page greys such times out and submitBooking refuses them. The
 * clocks go back at 02:00 BST on Sunday 25 October 2026, so the dates around
 * it check that the notice is real time, not wall-clock arithmetic.
 */

const SATURDAY = '2026-10-24'; // BST (UTC+1)
const SUNDAY = '2026-10-25'; // GMT from 02:00 BST
const request = (date: string, time: string, stylistId = 'funky') => ({
  stylistId, serviceId: 'service-1', date, time,
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
});

for (const stylistId of ['funky', ANY_STYLIST_ID]) {
  const label = stylistId === ANY_STYLIST_ID ? 'Anyone' : 'a named stylist';

  test(`submitBooking refuses ${label} 90 minutes away, in the customer's language, and books nothing (BST)`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T08:30:00Z') }); // 09:30 BST
    for (const [locale, wording] of [['en-GB', /at least 2 hours’ notice/], ['zh-HK', /最少提前 2 小時/]] as const) {
      const f = fixture({ locale });
      const result = await f.actions.submitBooking(request(SATURDAY, '11:00', stylistId));
      assert.equal(result.success, false);
      assert.equal(!result.success && result.code, 'BOOKING_TOO_SOON');
      assert.match(!result.success ? result.error : '', wording);
      assert.equal(f.rows.length, 0);
      assert.equal(f.notices.length, 0);
    }
  });

  test(`submitBooking accepts ${label} exactly two hours away (BST)`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T08:30:00Z') }); // 09:30 BST
    const f = fixture();
    assert.deepEqual(await f.actions.submitBooking(request(SATURDAY, '11:30', stylistId)), { success: true });
    assert.equal(f.rows.length, 1);
  });

  test(`after the clocks go back the notice is still two real hours for ${label} (GMT)`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T08:30:00Z') }); // 08:30 GMT
    const f = fixture();
    const tooSoon = await f.actions.submitBooking(request(SUNDAY, '10:00', stylistId));
    assert.equal(!tooSoon.success && tooSoon.code, 'BOOKING_TOO_SOON');
    assert.deepEqual(await f.actions.submitBooking(request(SUNDAY, '10:30', stylistId)), { success: true });
  });
}

test('the date strip greys out times inside the notice period and keeps later ones', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T08:30:00Z') }); // 09:30 BST
  const f = fixture();
  for (const stylistId of ['funky', ANY_STYLIST_ID]) {
    const result = await f.actions.fetchBookingDays(stylistId, [SATURDAY, SUNDAY], 60);
    assert.ok(result.ok);
    const [saturday, sunday] = result.days;
    assert.equal(saturday.status, 'OPEN');
    assert.deepEqual(saturday.slots.filter((slot) => !slot.available).map((slot) => slot.time), ['10:00', '10:30', '11:00'], stylistId);
    assert.equal(saturday.slots.find((slot) => slot.available)?.time, '11:30');
    assert.ok(sunday.slots.every((slot) => slot.available), 'tomorrow is far enough away');
  }
});

test('single-day time lists leave out times inside the notice period', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T08:30:00Z') }); // 08:30 GMT
  const f = fixture();
  for (const stylistId of ['funky', ANY_STYLIST_ID]) {
    const result = await f.actions.fetchSlots(stylistId, SUNDAY, 60);
    assert.ok(result.ok);
    assert.equal(result.slots[0]?.time, '10:30', stylistId);
  }
});

test('a day with nothing left beyond the notice period shows as unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T16:30:00Z') }); // 17:30 BST; hours end 19:00
  const f = fixture();
  const result = await f.actions.fetchBookingDays('funky', [SATURDAY], 60);
  assert.ok(result.ok);
  assert.equal(result.days[0].status, 'UNAVAILABLE');
});
