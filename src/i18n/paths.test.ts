import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMachinePath, localizeHref, splitLocalePath, stripLocale, switchLocaleHref } from './paths';

test('splitLocalePath separates the language from the business path', () => {
  assert.deepEqual(splitLocalePath('/zh-hk/admin/services'), { locale: 'zh-HK', path: '/admin/services', prefixed: true });
  assert.deepEqual(splitLocalePath('/zh-hk'), { locale: 'zh-HK', path: '/', prefixed: true });
  assert.deepEqual(splitLocalePath('/zh-hk/'), { locale: 'zh-HK', path: '/', prefixed: true });
  assert.deepEqual(splitLocalePath('/admin'), { locale: 'en-GB', path: '/admin', prefixed: false });
  assert.deepEqual(splitLocalePath('/'), { locale: 'en-GB', path: '/', prefixed: false });
  // A lookalike segment is not a language prefix.
  assert.deepEqual(splitLocalePath('/zh-hkx/admin'), { locale: 'en-GB', path: '/zh-hkx/admin', prefixed: false });
  assert.equal(stripLocale('/zh-hk/kiosk'), '/kiosk');
  // A rewritten English page may report its internal route path.
  assert.deepEqual(splitLocalePath('/en-gb/auth/signin'), { locale: 'en-GB', path: '/auth/signin', prefixed: false });
  assert.deepEqual(splitLocalePath('/en-gb'), { locale: 'en-GB', path: '/', prefixed: false });
  assert.equal(stripLocale('/en-gbx/admin'), '/en-gbx/admin');
  assert.equal(stripLocale(null), '/');
});

test('localizeHref prefixes only internal page paths', () => {
  assert.equal(localizeHref('zh-HK', '/services'), '/zh-hk/services');
  assert.equal(localizeHref('zh-HK', '/'), '/zh-hk');
  assert.equal(localizeHref('zh-HK', '/#team'), '/zh-hk#team');
  assert.equal(localizeHref('zh-HK', '/appointments?page=2#past'), '/zh-hk/appointments?page=2#past');
  assert.equal(localizeHref('en-GB', '/services'), '/services');
  for (const untouched of ['https://www.treatwell.co.uk/x', 'mailto:a@b.c', 'tel:+44', '#team', '//evil.example', '/api/ical/1', '/images/a.webp', '/sitemap.xml', 'relative']) {
    assert.equal(localizeHref('zh-HK', untouched), untouched, untouched);
  }
  // Re-homing an already localized href (switcher, stored redirects).
  assert.equal(localizeHref('en-GB', '/zh-hk/book'), '/book');
  assert.equal(localizeHref('zh-HK', '/zh-hk/book'), '/zh-hk/book');
});

test('switchLocaleHref keeps the page, query and anchor', () => {
  assert.equal(switchLocaleHref('zh-HK', '/admin', '?view=week&date=2026-09-28', '#top'), '/zh-hk/admin?view=week&date=2026-09-28#top');
  assert.equal(switchLocaleHref('en-GB', '/zh-hk/admin', '?view=week', ''), '/admin?view=week');
  assert.equal(switchLocaleHref('en-GB', '/zh-hk', '', ''), '/');
  assert.equal(switchLocaleHref('zh-HK', '/', '', ''), '/zh-hk');
  assert.equal(switchLocaleHref('zh-HK', '/en-gb/book', '?a=1', ''), '/zh-hk/book?a=1');
  assert.equal(switchLocaleHref('en-GB', '/en-gb/book', '', ''), '/book');
  assert.equal(localizeHref('zh-HK', '/en-gb/services'), '/zh-hk/services');
  assert.equal(localizeHref('en-GB', '/en-gb/services'), '/services');
});

test('machine paths keep their language-free address', () => {
  for (const path of ['/api/auth/google/callback', '/api/cron/reminders', '/api/ical/abc', '/_next/static/x.js', '/robots.txt', '/sitemap.xml', '/images/logo.png', '/site.webmanifest']) {
    assert.equal(isMachinePath(path), true, path);
  }
  for (const path of ['/', '/services', '/blog/some-post', '/zh-hk/admin']) assert.equal(isMachinePath(path), false, path);
});
