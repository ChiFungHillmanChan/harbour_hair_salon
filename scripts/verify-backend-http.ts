/** Production-server checks; only synthetic fixtures in a disposable localhost database. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { Secret, TOTP } from 'otpauth';

async function main() {
  const connection = process.env.SALON_TEST_DATABASE_URL;
  if (!connection) throw new Error('Set SALON_TEST_DATABASE_URL to a migrated disposable localhost salon_test database.');
  const dbUrl = new URL(connection);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(dbUrl.hostname) || dbUrl.pathname !== '/salon_test' || dbUrl.searchParams.has('host')) throw new Error('Only disposable localhost salon_test is allowed.');
  const db = new PrismaClient({ datasources: { db: { url: connection } } });
  const secret = 'disposable-http-test-secret-not-for-production-20260916';
  const key = new TextEncoder().encode(secret);
  const sign = (claims: Record<string, unknown>) => new SignJWT({ ...claims, expiresAt: new Date(Date.now() + 3600_000).toISOString() }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(key);
  let fixturesStarted = false;
  // Bind to `localhost`, not 127.0.0.1. The middleware serves English by
  // rewriting to the internal /en-gb segment; Next's NextURL normalises the
  // host 127.0.0.1 to `localhost`, while `next start -H 127.0.0.1` names its
  // own origin 127.0.0.1, so every rewrite looked external, was proxied back
  // through the middleware and hit its /en-gb → / 308. Vercel (and a default
  // `next start`) keep a same-host rewrite internal.
  const origin = 'http://localhost:3108';
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', 'localhost', '-p', '3108'], {
    env: { ...process.env, POSTGRES_URL: connection, POSTGRES_URL_NON_POOLING: connection, SESSION_SECRET: secret,
      NOTIFICATIONS_ENABLED: 'false', CALENDAR_SYNC_ENABLED: 'false', HOUSEKEEPING_ENABLED: 'false',
      RESEND_API_KEY: 'disabled', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(tmpdir(), 'harbour-backend-http-server.log'));
  server.stdout.pipe(log); server.stderr.pipe(log);
  const fetchPage = (path: string, session?: string, extraCookie?: string) => fetch(`${origin}${path}`, {
    headers: { cookie: [session ? `session=${session}` : '', extraCookie ?? ''].filter(Boolean).join('; ') }, redirect: 'manual',
  });
  const decodeHtml = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const formFields = (html: string, inputName?: string) => {
    const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(match => match[0]);
    const form = forms.find(markup => inputName ? markup.includes(`name="${inputName}"`) : markup.includes('$ACTION_'));
    assert.ok(form, 'Server-rendered action form must exist');
    const data = new FormData();
    for (const match of form.matchAll(/<input\b[^>]*>/g)) {
      const attrs = new Map([...match[0].matchAll(/([^\s=]+)="([^"]*)"/g)].map(attr => [attr[1], decodeHtml(attr[2])]));
      if (attrs.get('type') === 'hidden' && attrs.has('name')) data.append(attrs.get('name')!, attrs.get('value') ?? '');
    }
    assert.ok([...data.keys()].some(name => name.startsWith('$ACTION_')), 'Use action references emitted by the current build');
    return data;
  };
  // The visible error, not the whole document: pages also ship their translated
  // messages to the browser, so every error string is somewhere in the HTML.
  const alertOf = (html: string) => [...html.matchAll(/<[a-z]+ role="alert"[^>]*>([\s\S]*?)<\/[a-z]+>/g)].map(match => decodeHtml(match[1].replace(/<!-- -->/g, ''))).join(' ');
  const cookieJar = new Map<string, string>();
  const mfaRequest = async (path: string, data?: FormData, ip?: string) => {
    const response = await fetch(`${origin}${path}`, { method: data ? 'POST' : 'GET', body: data,
      headers: { cookie: [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; '), origin, ...(ip ? { 'x-forwarded-for': ip } : {}) }, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const equal = pair.indexOf('=');
      if (!pair.slice(equal + 1)) cookieJar.delete(pair.slice(0, equal)); else cookieJar.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    return { response, body: await response.text() };
  };
  const adminPages = ['/admin', '/admin/users', '/admin/employees', '/admin/payroll', '/admin/integrations', '/admin/operations', '/admin/reviews', '/admin/shifts', '/admin/timesheets', '/admin/blog'];
  const assertDenied = async (path: string, session?: string) => {
    const response = await fetchPage(path, session);
    const body = await response.text();
    assert.ok((response.status >= 300 && response.status < 400) || body.includes('NEXT_REDIRECT'), `Expected redirect for ${path}, got ${response.status}`);
    assert.ok(!body.includes('PRIVATE_FIXTURE_CUSTOMER') && !body.includes('PRIVATE_FIXTURE_STAFF'), `Private read leaked on ${path}`);
  };
  try {
    assert.equal(await db.user.count(), 0, 'Start with an empty disposable database.');
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`Server exited; see ${join(tmpdir(), 'harbour-backend-http-server.log')}`);
      try { if ((await fetchPage('/api/health')).status === 200) break; } catch { /* wait for listener */ }
      if (i === 99) throw new Error('Production server did not start');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fixturesStarted = true;
    await db.user.createMany({ data: [
      { id: 'http-admin', email: 'http-admin@example.invalid', name: 'PRIVATE_FIXTURE_ADMIN', role: 'ADMIN', mfaEnabledAt: new Date() },
      { id: 'http-enroll-admin', email: 'http-enroll@example.invalid', name: 'Synthetic MFA administrator', role: 'ADMIN' },
      { id: 'http-user', email: 'http-user@example.invalid', name: 'PRIVATE_FIXTURE_CUSTOMER' },
    ] });
    await db.stylist.create({ data: { id: 'http-stylist', name: 'PRIVATE_FIXTURE_STAFF', role: 'Stylist', icalToken: 'PRIVATE_FIXTURE_ICAL_SECRET' } });
    await db.service.create({ data: { id: 'http-service', name: 'Synthetic Cut', category: 'Cut', price: 120, duration: 30 } });
    await db.appointment.createMany({ data: Array.from({ length: 30 }, (_, i) => ({
      id: `http-appt-${String(i).padStart(2, '0')}`, date: new Date(Date.UTC(2020, 0, i + 1, 10)), status: 'COMPLETED',
      userId: 'http-user', stylistId: 'http-stylist', serviceId: 'http-service', priceAtBooking: 80, durationAtBooking: 60,
    })) });
    await db.blogPost.createMany({ data: Array.from({ length: 13 }, (_, i) => ({
      id: `http-blog-${i}`, slug: `synthetic-post-${i}`, title: `Synthetic Post ${i}`, description: 'Synthetic only', excerpt: 'Synthetic only', author: 'Salon', authorRole: 'Stylist',
      publishedAt: new Date(Date.UTC(2026, 0, i + 1)), readingTime: 1, tags: '', coverImage: '/images/services-hero.webp', coverAlt: 'Salon', lede: 'Synthetic', sectionsJson: '[]', relatedSlugs: '', status: 'PUBLISHED',
    })) });
    const admin = await sign({ userId: 'http-admin', role: 'ADMIN', sessionVersion: 0, adminMfaVerified: true });
    // No second factor is required, so a token carrying only the password claim
    // is an ordinary admin session and must be served, not bounced.
    const passwordOnlyAdmin = await sign({ userId: 'http-admin', role: 'ADMIN', sessionVersion: 0 });
    const customer = await sign({ userId: 'http-user', role: 'USER', sessionVersion: 0 });
    for (const path of adminPages) {
      await assertDenied(path);
      await assertDenied(path, customer);
      const allowed = await fetchPage(path, passwordOnlyAdmin);
      assert.equal(allowed.status, 200, `Password-only admin must reach ${path}`);
    }
    for (const view of ['day', 'month', 'year']) {
      const response = await fetchPage(`/admin?date=2020-01-15&view=${view}`, admin);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes('PRIVATE_FIXTURE_ICAL_SECRET'));
      if (view === 'year') assert.ok(!body.includes('PRIVATE_FIXTURE_CUSTOMER'), 'Year aggregate cannot serialize historical customer details');
      if (view === 'month') assert.ok(!body.includes('http-user@example.invalid'), 'Month summary cannot serialize contact email');
      assert.match(response.headers.get('cache-control') ?? '', /private|no-store/);
    }
    const history = await fetchPage('/appointments?page=2', customer);
    assert.equal(history.status, 200);
    const historyBody = await history.text();
    assert.ok(/Page (?:<!-- -->)?2(?!\d)/.test(historyBody) && historyBody.includes('Synthetic Cut'), 'Page 2 of the history is rendered');
    assert.ok(!historyBody.includes('PRIVATE_FIXTURE_ICAL_SECRET'));
    const blog = await fetchPage('/blog?page=2');
    const blogBody = await blog.text();
    assert.equal(blog.status, 200);
    assert.match(blogBody, /canonical[^>]+blog\?page=2/);
    assert.ok(blogBody.includes('Synthetic Post 0') && !blogBody.includes('Synthetic Post 12'));
    await db.user.update({ where: { id: 'http-admin' }, data: { role: 'USER' } });
    for (const path of adminPages) await assertDenied(path, admin);
    await db.user.update({ where: { id: 'http-admin' }, data: { role: 'ADMIN', sessionVersion: 1 } });
    for (const path of adminPages) await assertDenied(path, admin);
    for (const path of ['/auth/mfa', '/auth/mfa/setup']) await assertDenied(path);
    // Submit the actual server-rendered actions, including the cookie-triggered
    // page rerender that used to discard the one-time recovery code display.
    const challenge = (version: number) => sign({ purpose: 'admin-mfa', userId: 'http-enroll-admin', sessionVersion: version, nonce: 'synthetic-http-first-factor-proof' });
    cookieJar.set('admin_mfa_pending', await challenge(0));
    const setup = await mfaRequest('/auth/mfa/setup');
    assert.equal(setup.response.status, 200);
    const startSetup = await mfaRequest('/auth/mfa/setup', formFields(setup.body));
    assert.equal(startSetup.response.status, 200);
    const secretMatch = startSetup.body.match(/<code[^>]*>([A-Z2-7]+)<\/code>/);
    assert.ok(secretMatch, 'Authenticator setup must render its generated key');
    const otp = new TOTP({ secret: Secret.fromBase32(secretMatch[1]), algorithm: 'SHA1', digits: 6, period: 30 });
    const confirmData = formFields(startSetup.body, 'code');
    const usedCode = otp.generate();
    confirmData.set('code', usedCode);
    const enrolled = await mfaRequest('/auth/mfa/setup', confirmData);
    assert.equal(enrolled.response.status, 200);
    const recoveryCodes = [...new Set(enrolled.body.match(/[A-F0-9]{5}(?:-[A-F0-9]{5}){3}/g) ?? [])];
    assert.equal(recoveryCodes.length, 10, 'All ten one-time recovery codes survive cookie-driven page rerender');
    assert.ok(cookieJar.has('session'));
    assert.ok(!cookieJar.has('admin_mfa_pending'));
    const enabledPage = await mfaRequest('/auth/mfa/setup');
    assert.equal(enabledPage.response.status, 200);
    assert.ok(!enabledPage.body.includes(recoveryCodes[0]), 'Recovery codes are not exposed again on a fresh GET');
    cookieJar.delete('session');
    cookieJar.set('admin_mfa_pending', await challenge(1));
    const verifyPage = await mfaRequest('/auth/mfa');
    const replayData = formFields(verifyPage.body, 'code'); replayData.set('code', usedCode);
    const rejectedReplay = await mfaRequest('/auth/mfa', replayData);
    assert.ok(alertOf(rejectedReplay.body).includes('already used'));
    assert.ok(!cookieJar.has('session'));
    const recoverData = formFields(rejectedReplay.body, 'code'); recoverData.set('code', recoveryCodes[0]);
    const recovered = await mfaRequest('/auth/mfa', recoverData);
    assert.equal(recovered.response.status, 303);
    assert.ok(cookieJar.has('session'));
    cookieJar.delete('session'); cookieJar.set('admin_mfa_pending', await challenge(1));
    const againPage = await mfaRequest('/auth/mfa');
    const againData = formFields(againPage.body, 'code'); againData.set('code', recoveryCodes[0]);
    const reused = await mfaRequest('/auth/mfa', againData);
    assert.ok(alertOf(reused.body).includes('already used'));
    assert.ok(!cookieJar.has('session'));
    await db.auditEvent.deleteMany({ where: { actorUserId: 'http-enroll-admin', action: 'AUTH.MFA_ATTEMPT' } });
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const invalid = formFields(againPage.body, 'code'); invalid.set('code', 'invalid-synthetic-factor');
      return mfaRequest('/auth/mfa', invalid, `192.0.2.${i + 1}`);
    }));
    assert.equal(await db.auditEvent.count({ where: { actorUserId: 'http-enroll-admin', action: 'AUTH.MFA_ATTEMPT' } }), 8, 'Database-backed account budget serializes concurrent requests independently of IP/process limiter');
    assert.equal(attempts.filter(result => alertOf(result.body).includes('Too many attempts')).length, 4);
    assert.ok(!cookieJar.has('session'));
    console.log('PASS: actual PostgreSQL12parallelMFAattempts record8anddeny4 across12syntheticIPs.');
    console.log('PASS: actual HTTP MFA enrollment retains10recoverycodes, fresh GET hides them, usedTOTP/recoverycode cannot issue another session.');
    const oldKiosk = await sign({ kiosk: true });
    assert.equal((await fetchPage('/kiosk', undefined, `kiosk=${oldKiosk}`)).status, 307);
    console.log('PASS: production HTTP rejects anonymous/customer/legacy-admin/demoted/revoked sessions on10admin pages; year/month minimize PII; customer+blog pagination and canonical URL; kiosk legacy rejection; password-only admin sessions served; MFA first-factor gates.');
  } finally {
    server.kill('SIGTERM');
    await new Promise<void>(resolve => { if (server.exitCode !== null) resolve(); else { server.once('exit', () => resolve()); setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000).unref(); } });
    log.end();
    if (fixturesStarted) {
    await db.appointment.deleteMany({ where: { userId: 'http-user' } });
    await db.stylist.deleteMany({ where: { id: 'http-stylist' } });
    await db.service.deleteMany({ where: { id: 'http-service' } });
    await db.blogPost.deleteMany({ where: { id: { startsWith: 'http-blog-' } } });
    await db.auditEvent.deleteMany({ where: { actorUserId: { in: ['http-admin', 'http-user', 'http-enroll-admin'] } } });
    await db.user.deleteMany({ where: { id: { in: ['http-admin', 'http-user', 'http-enroll-admin'] } } });
    }
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
