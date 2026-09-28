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
    code: 'ALREADY_REGISTERED', error: ALREADY_REGISTERED_ERROR,
  });
});

test('a Google-only account (no password) is NOT claimable — account takeover guard', () => {
  // Regression test: this shape used to fall through to CLAIM_GUEST, which
  // wrote the registrant's password onto the victim's row and signed them in.
  assert.deepEqual(decideRegistration({ hasPassword: false, linkedProviderCount: 1 }), {
    kind: 'REJECT',
    code: 'USE_GOOGLE', error: USE_GOOGLE_ERROR,
  });
});

test('a password-less account with several linked providers is still not claimable', () => {
  assert.deepEqual(decideRegistration({ hasPassword: false, linkedProviderCount: 3 }), {
    kind: 'REJECT',
    code: 'USE_GOOGLE', error: USE_GOOGLE_ERROR,
  });
});

test('a guest placeholder requires email recovery proof instead of registration', () => {
  assert.deepEqual(decideRegistration({ hasPassword: false, linkedProviderCount: 0 }), {
    kind: 'REJECT',
    code: 'ALREADY_REGISTERED', error: ALREADY_REGISTERED_ERROR,
  });
});

test('a linked provider outranks the guest path even when both look password-less', () => {
  const guest = decideRegistration({ hasPassword: false, linkedProviderCount: 0 });
  const federated = decideRegistration({ hasPassword: false, linkedProviderCount: 1 });
  assert.equal(guest.kind, 'REJECT');
  assert.equal(federated.kind, 'REJECT');
});
