import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { sendPreparedEmail } from './email-service';

test('email transport preserves the frozen request and idempotency key, with an abort signal', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-only-key';
  const payload = { from: 'Salon <booking@example.com>', to: 'customer@example.com', subject: 'Confirmed', html: '<p>Confirmed</p>' };
  const bodies: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'appointment/a/2/CONFIRMATION');
    assert.ok(init?.signal instanceof AbortSignal);
    bodies.push(String(init?.body));
    return Response.json({ id: 'email-1' });
  };
  try {
    await sendPreparedEmail(payload, 'appointment/a/2/CONFIRMATION');
    await sendPreparedEmail(payload, 'appointment/a/2/CONFIRMATION');
    assert.deepEqual(bodies, [JSON.stringify(payload), JSON.stringify(payload)]);
    globalThis.fetch = async () => Response.json({ message: 'customer@example.com is not allowed' }, { status: 403 });
    await assert.rejects(sendPreparedEmail(payload), { message: 'Email provider HTTP 403' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
  }
});

test('appointment templates render with the ordinary Node renderer used by the server', () => {
  // The suite's react-server condition deliberately forbids react-dom/server.
  // Exercise the external email renderer in a clean ordinary Node process.
  execFileSync(process.execPath, ['--import', 'tsx', '--eval', `
    const assert = require('node:assert/strict');
    const { loadServerModule } = require('./src/test/load-server-module.ts');
    const { prepareAppointmentEmail } = loadServerModule('src/app/services/email-service.ts', { 'server-only': {} });
    process.env.EMAIL_FROM = 'Salon <booking@example.com>';
    prepareAppointmentEmail('CONFIRMATION', { id: 'appointment-123', date: new Date('2099-09-12T12:00:00Z'), user: { email: 'customer@example.com', name: 'Customer' }, stylist: { name: 'Stylist' }, service: { name: 'Cut', price: 80, duration: 60 } }).then(email => {
      assert.ok(email.html.includes('80.00'));
      assert.ok(email.html.includes('60'));
      assert.equal(email.to, 'customer@example.com');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: process.cwd(), stdio: 'pipe' });
});
