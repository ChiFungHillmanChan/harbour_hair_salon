import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../test/load-server-module';

const { default: robots } = loadServerModule<typeof import('./robots')>('src/app/robots.ts', {
  '@/app/lib/site-url': { SITE_URL: 'https://salon.example' },
});

const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** RFC 9309: rules are path prefixes, the longest match wins, and allow wins a tie. */
function crawlable(path: string): boolean {
  const { rules } = robots();
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const longest = (patterns: string[]) => Math.max(-1, ...patterns.filter((pattern) => path.startsWith(pattern)).map((pattern) => pattern.length));
  return longest(list(rule.allow)) >= longest(list(rule.disallow));
}

test('the booking terms are crawlable in both languages, though `/book` is a prefix of them', () => {
  for (const path of ['/booking-terms', '/zh-hk/booking-terms']) assert.ok(crawlable(path), path);
});

test('stylist busy feeds are fetchable by calendar importers (Google Calendar honours robots)', () => {
  assert.ok(crawlable('/api/ical/stylist-1?token=abc'));
  for (const path of ['/api/health', '/api/session', '/api/webhooks/square', '/api/cron/reminders']) assert.ok(!crawlable(path), path);
});

test('the booking wizard and private pages stay disallowed', () => {
  for (const path of ['/book', '/book?service=abc', '/zh-hk/book', '/appointments', '/admin/settings', '/auth/signin', '/api/health']) {
    assert.ok(!crawlable(path), path);
  }
  for (const path of ['/', '/privacy', '/services', '/zh-hk/contact']) assert.ok(crawlable(path), path);
});
