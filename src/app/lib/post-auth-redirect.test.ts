import test from 'node:test';
import assert from 'node:assert/strict';
import { postSignInPath } from './post-auth-redirect';

test('sign-in lands on the home page of the language it was made in', () => {
  assert.equal(postSignInPath('en-GB', null), '/');
  assert.equal(postSignInPath('zh-HK', null), '/zh-hk');
  assert.equal(postSignInPath('zh-HK', ''), '/zh-hk');
});

test('administrators open the admin panel in their language, whatever was requested', () => {
  assert.equal(postSignInPath('en-GB', '/book', 'ADMIN'), '/admin');
  assert.equal(postSignInPath('zh-HK', '/book', 'ADMIN'), '/zh-hk/admin');
});

test('a requested page is kept and follows the language of the sign-in page', () => {
  assert.equal(postSignInPath('zh-HK', '/zh-hk/book'), '/zh-hk/book');
  assert.equal(postSignInPath('zh-HK', '/book?stylist=amy'), '/zh-hk/book?stylist=amy');
  assert.equal(postSignInPath('en-GB', '/zh-hk/appointments'), '/appointments');
  assert.equal(postSignInPath('en-GB', '/reviews/new?appointmentId=a1'), '/reviews/new?appointmentId=a1');
});

test('no language move can turn a target into an absolute or protocol-relative URL', () => {
  for (const locale of ['en-GB', 'zh-HK'] as const) {
    for (const hostile of ['https://evil.example', '//evil.example', '/\\evil.example', '/zh-hk//evil.example', '/zh-hk/\\evil.example', 'javascript:alert(1)']) {
      const target = postSignInPath(locale, hostile);
      assert.ok(target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\'), `${locale} ${hostile} → ${target}`);
    }
  }
});
