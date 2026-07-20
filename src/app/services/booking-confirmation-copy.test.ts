import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingConfirmationText } from './booking-confirmation-copy';

test('confirmation text contains the customer-visible booking contract', () => {
  const text = buildBookingConfirmationText({
    id: 'appointment-ABCDEFGH',
    date: new Date('2026-08-01T09:30:00.000Z'),
    user: { email: 'ada@example.com', name: 'Ada' },
    stylist: { name: 'Hillman' },
    service: { name: 'Cut & Finish', price: 48, duration: 60 },
  });

  assert.match(text, /HARBOUR HAIR — BOOKING CONFIRMED/);
  assert.match(text, /Hi Ada/);
  assert.match(text, /Service: Cut & Finish/);
  assert.match(text, /Stylist: Hillman/);
  assert.match(text, /Duration: 60 minutes/);
  assert.match(text, /Price: £48\.00/);
  assert.match(text, /Booking reference: ABCDEFGH/);
  assert.match(text, /Central Arcade/);
  assert.match(text, /24 hours/);
});
