import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideRegistration,
  ALREADY_REGISTERED_ERROR,
  USE_GOOGLE_ERROR,
} from './register-gate';

test('a brand-new email creates a fresh account', () => {
  assert.deepEqual(decideRegistration(null), { kind: 'CREATE' });
});

test('an email with a password is rejected, never overwritten', () => {
  assert.deepEqual(decideRegistration({ hasPassword: true, linkedProviderCount: 0 }), {
    kind: 'REJECT',
    error: ALREADY_REGISTERED_ERROR,
  });
});

test('a Google-only account (no password) is NOT claimable — account takeover guard', () => {
  // Regression test: this shape used to fall through to CLAIM_GUEST, which
  // wrote the registrant's password onto the victim's row and signed them in.
  assert.deepEqual(decideRegistration({ hasPassword: false, linkedProviderCount: 1 }), {
    kind: 'REJECT',
    error: USE_GOOGLE_ERROR,
  });
});

test('a password-less account with several linked providers is still not claimable', () => {
  assert.deepEqual(decideRegistration({ hasPassword: false, linkedProviderCount: 3 }), {
    kind: 'REJECT',
    error: USE_GOOGLE_ERROR,
  });
});

test('a true guest placeholder (no password, no provider) is claimable', () => {
  assert.deepEqual(decideRegistration({ hasPassword: false, linkedProviderCount: 0 }), {
    kind: 'CLAIM_GUEST',
  });
});

test('a linked provider outranks the guest path even when both look password-less', () => {
  const guest = decideRegistration({ hasPassword: false, linkedProviderCount: 0 });
  const federated = decideRegistration({ hasPassword: false, linkedProviderCount: 1 });
  assert.equal(guest.kind, 'CLAIM_GUEST');
  assert.notEqual(federated.kind, 'CLAIM_GUEST');
});
