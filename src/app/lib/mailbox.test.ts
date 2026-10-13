import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailboxAddress } from './mailbox';

test('a bare address is accepted, trimmed and lower-cased', () => {
  assert.equal(mailboxAddress('  Hello@HarbourHair.co.uk '), 'hello@harbourhair.co.uk');
});

test('"Name <address>" yields the address only when names are allowed', () => {
  assert.equal(mailboxAddress('Harbour Hair Salon <bookings@harbourhair.co.uk>', true), 'bookings@harbourhair.co.uk');
  assert.equal(mailboxAddress('Harbour Hair Salon <bookings@harbourhair.co.uk>'), null);
  assert.equal(mailboxAddress('bookings@harbourhair.co.uk', true), 'bookings@harbourhair.co.uk', 'a bare address still works');
});

test('anything that is not one valid address is refused', () => {
  for (const value of [undefined, null, '', '   ', 'Harbour Hair Salon', 'not an address', 'a@b', 'a@example.com, b@example.com', 'Salon <a@example.com', 'Salon\r\n<a@example.com>', '"Salon" <a b@example.com>']) {
    assert.equal(mailboxAddress(value, true), null, JSON.stringify(value));
  }
});
