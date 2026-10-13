import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewEmailBlocked, isPreviewRecipientAllowed, parsePreviewEmailAllowlist } from './preview-email';

test('the allow-list takes full addresses and @domain entries, case-insensitively, and ignores anything else', () => {
  const list = parsePreviewEmailAllowlist(' Tester@Example.com, @Staff.Example.org ,, not-an-address, @, @nodot, x@y ');
  assert.deepEqual([...list.addresses], ['tester@example.com']);
  assert.deepEqual([...list.domains], ['staff.example.org']);
  assert.deepEqual(parsePreviewEmailAllowlist(undefined), { addresses: new Set(), domains: new Set() });
});

test('a recipient matches an exact address or a listed domain, never a look-alike', () => {
  const list = parsePreviewEmailAllowlist('tester@example.com, @staff.example.org');
  assert.equal(isPreviewRecipientAllowed('tester@example.com', list), true);
  assert.equal(isPreviewRecipientAllowed('TESTER@EXAMPLE.COM', list), true);
  assert.equal(isPreviewRecipientAllowed('Harbour Tester <tester@example.com>', list), true);
  assert.equal(isPreviewRecipientAllowed('anyone@staff.example.org', list), true);
  for (const recipient of ['customer@example.com', 'tester@example.com.evil.test', 'x@sub.staff.example.org', 'x@evilstaff.example.org', 'staff.example.org', '']) {
    assert.equal(isPreviewRecipientAllowed(recipient, list), false, recipient);
  }
});

test('only a Vercel preview is restricted; production and local development send as before', () => {
  for (const VERCEL_ENV of [undefined, 'production', 'development']) {
    assert.equal(isPreviewEmailBlocked('customer@example.com', { VERCEL_ENV }), false, String(VERCEL_ENV));
  }
  const preview = (PREVIEW_EMAIL_ALLOWLIST?: string) => ({ VERCEL_ENV: 'preview', PREVIEW_EMAIL_ALLOWLIST });
  // Unset or empty: a preview emails nobody.
  for (const value of [undefined, '', ' , ']) assert.equal(isPreviewEmailBlocked('tester@example.com', preview(value)), true, String(value));
  assert.equal(isPreviewEmailBlocked('tester@example.com', preview('tester@example.com')), false);
  assert.equal(isPreviewEmailBlocked('customer@example.com', preview('tester@example.com')), true, 'a copied real customer');
  // Every recipient must be on the list.
  assert.equal(isPreviewEmailBlocked(['tester@example.com', 'customer@example.com'], preview('tester@example.com')), true);
  assert.equal(isPreviewEmailBlocked('tester@example.com, customer@example.com', preview('tester@example.com')), true);
  assert.equal(isPreviewEmailBlocked(['a@staff.example.org', 'tester@example.com'], preview('tester@example.com,@staff.example.org')), false);
  assert.equal(isPreviewEmailBlocked([], preview('tester@example.com')), true, 'no recipient at all is not sent either');
});
