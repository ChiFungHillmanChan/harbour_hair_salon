import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture as fixture } from '../../test/booking-fixture';
import { translator } from '../../i18n/messages';

/**
 * Online booking needs a phone the salon can reach the customer on (owner
 * request 2026-11-15): the salon's new-request email shows it to staff.
 */

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T09:00:00Z') }));
after(() => mock.timers.reset());

const request = (extra: { phone?: string } = {}) => ({
  stylistId: 'funky', serviceId: 'service-1', date: '2026-10-06', time: '11:00',
  expectedQuote: { serviceId: 'service-1', priceVersion: 1, amountPence: 10000 },
  ...extra,
});

test('no phone typed and none saved: refused, nothing booked or queued', async () => {
  const f = fixture({ savedPhone: null });
  assert.deepEqual(await f.actions.submitBooking(request()), {
    success: false, code: 'PHONE_REQUIRED', error: translator('en-GB', 'errors')('booking.PHONE_REQUIRED'),
  });
  assert.equal(f.rows.length, 0);
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.phoneWrites, []);
});

test('a typed phone that is not a phone number is refused, and the saved one is left alone', async () => {
  const f = fixture();
  const answer = await f.actions.submitBooking(request({ phone: 'call me' }));
  assert.equal(!answer.success && answer.code, 'PHONE_INVALID');
  assert.equal(f.rows.length, 0);
  assert.deepEqual(f.phoneWrites, []);
});

test('a new phone is saved to the account before the request, so the salon alert carries it', async () => {
  const f = fixture({ savedPhone: null });
  assert.deepEqual(await f.actions.submitBooking(request({ phone: ' 07700  900456 ' })), { success: true });
  assert.deepEqual(f.phoneWrites, [{ phone: '07700 900456', bookingsBefore: 0 }], 'saved once, tidied, before the booking');
  assert.equal(f.rows.length, 1);
  assert.ok(f.notices.some((notice) => notice.endsWith('/SALON_ALERT')), 'the salon is alerted');
});

test('the saved phone unchanged, or an older page that sends none, writes nothing extra', async () => {
  const f = fixture();
  assert.deepEqual(await f.actions.submitBooking(request({ phone: '07700 900123' })), { success: true });
  f.rows.length = 0;
  assert.deepEqual(await f.actions.submitBooking(request()), { success: true });
  assert.deepEqual(f.phoneWrites, []);
});

test('a refused request leaves one log line with its code and account (it was invisible before, 2026-11-19)', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  const f = fixture({ savedPhone: null });
  await f.actions.submitBooking(request());
  const lines = warn.mock.calls.filter((call) => call.arguments[0] === '[booking] request refused');
  assert.equal(lines.length, 1);
  const fields = lines[0].arguments[1] as Record<string, unknown>;
  assert.deepEqual([fields.code, fields.withCard], ['PHONE_REQUIRED', false]);
  assert.equal(typeof fields.userId, 'string');

  warn.mock.resetCalls();
  await fixture({ savedPhone: '07700 900123' }).actions.submitBooking(request());
  assert.equal(warn.mock.calls.filter((call) => call.arguments[0] === '[booking] request refused').length, 0, 'a booking made logs nothing');
});
