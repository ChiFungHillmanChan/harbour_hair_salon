import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Free Vercel WAF deny rules in vercel.json (`routes` + `mitigate`). They stop
 * vulnerability scanners before a function runs: blocked requests cost no CDN
 * requests, no function time and never reach Neon. Rules here must only ever
 * match paths this site does not serve — a wrong pattern would 403 real pages
 * — so this test pins both sides.
 *
 * `blocked` are real probes from the production 404 log (2026-09-26…29).
 */
type Route = { src: string; mitigate?: { action: string }; dest?: string };

const routes: Route[] = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')).routes ?? [];
const deniedBy = (path: string) => routes.filter((route) => new RegExp(route.src).test(path));

test('every firewall route only denies, and never rewrites or redirects real traffic', () => {
  assert.ok(routes.length > 0);
  for (const route of routes) {
    assert.deepEqual(Object.keys(route).sort(), ['mitigate', 'src'], route.src);
    assert.equal(route.mitigate?.action, 'deny', route.src);
  }
});

test('the scanner probes seen in production are denied', () => {
  const blocked = [
    '/wp-admin/install.php', '/wp-login.php', '/xmlrpc.php', '/zh-hk/wp-admin/', '/wp-content/plugins/x/readme.txt',
    '/.env', '/api/.env', '/dev/.env', '/application/.env', '/.env.prod', '/.env.save', '/.git/config', '/.aws/credentials',
    '/phpinfo', '/phpinfo.php', '/php_info.php', '/_profiler/phpinfo', '/archivarix.cms.php', '/index.php', '/cgi-bin/test.cgi',
  ];
  for (const path of blocked) assert.ok(deniedBy(path).length > 0, `${path} should be denied`);
});

test('no page, API, asset or standard well-known file the site serves is ever denied', () => {
  const allowed = [
    '/', '/zh-hk', '/book', '/zh-hk/book', '/blog', '/zh-hk/blog', '/blog/balayage-aftercare', '/services', '/services/colouring',
    '/stylists', '/stylists/funky-k', '/offers', '/reviews', '/contact', '/privacy', '/try-color', '/3d', '/unsubscribe',
    '/auth/signin', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/auth/mfa/setup',
    '/appointments', '/admin', '/admin/settings', '/admin/blog/abc123/edit', '/kiosk',
    '/api/ical/cmu3zmalf0001h7400z5ijxh3', '/api/auth/google', '/api/auth/google/callback', '/api/auth/verify-email',
    '/api/cron/calendar-sync', '/api/cron/housekeeping', '/api/health', '/api/session',
    '/robots.txt', '/sitemap.xml', '/favicon.ico', '/llms.txt', '/humans.txt', '/ads.txt', '/security.txt',
    '/.well-known/security.txt', '/.well-known/traffic-advice', '/.well-known/acme-challenge/token',
    '/.well-known/vercel/microfrontend-routing', '/_next/static/chunks/app/page.js', '/_next/image',
    '/images/hero-salon.webp', '/harbour-hair-3d.html',
    // A future blog post may well mention these words; only real file paths are blocked.
    '/blog/wp-admin-alternatives', '/blog/why-we-left-php', '/blog/environment-friendly-colour',
  ];
  for (const path of allowed) assert.deepEqual(deniedBy(path).map((route) => route.src), [], `${path} must stay reachable`);
});
