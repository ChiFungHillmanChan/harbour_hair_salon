import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import type { EmailContent } from './email-content';

const NOW = new Date('2026-11-10T12:00:00Z');
const ENV = { NOTIFICATIONS_ENABLED: 'true' };

function load(options: { calendarReady?: boolean; operationsReady?: boolean; bookingEnabled?: boolean; locked?: boolean; locale?: string } = {}) {
  const row: { lastResultJson: string | null } = { lastResultJson: null };
  const sent: { content: EmailContent; key: string }[] = [];
  let reads = 0;
  const db = {
    siteSettings: { findUnique: async () => { reads++; return { bookingEnabled: options.bookingEnabled ?? true, salonNotificationLocale: options.locale ?? 'en-GB' }; } },
    backgroundJobState: {
      findUnique: async () => ({ ...row }),
      upsert: async ({ update }: { update: { lastResultJson: string } }) => { row.lastResultJson = update.lastResultJson; return {}; },
    },
  };
  const alert = loadServerModule<typeof import('./booking-closed-alert')>('src/app/services/booking-closed-alert.ts', {
    '@/app/lib/online-booking-lock': { isOnlineBookingLockedForPayments: () => options.locked ?? false },
    '@/app/lib/site-url': { SITE_URL: 'https://example.test' },
    './integration-readiness': { checkCalendarBookingReadiness: async () => ({ ready: options.calendarReady ?? true, blockers: [] }) },
    './operations-readiness': { BOOKING_CLOSED_ALERT_JOB: 'booking-closed-alert', checkOperationsRuntimeReadiness: async () => ({ ready: options.operationsReady ?? true }) },
  });
  const send = async (content: EmailContent, key: string) => { sent.push({ content, key }); };
  const run = (now = NOW, env: Record<string, string | undefined> = ENV) => alert.sendBookingClosedAlert({ db: db as never, now, env, send });
  return { alert, run, sent, row, reads: () => reads, db, send };
}

test('booking switched on but refused by a calendar check: the salon is told why, once', async () => {
  const f = load({ calendarReady: false });
  assert.deepEqual(await f.run(), { sent: true });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].key, 'booking-closed/2026-11-10');
  assert.equal(f.sent[0].content.subject, 'Harbour Hair: online booking has closed itself');
  assert.deepEqual(f.sent[0].content.details.map((detail) => detail.value), [
    'A calendar check is failing. Open Admin → Integrations: a feed may be down, or a stylist shown on the website may have no hours.',
  ]);
  assert.deepEqual(await f.run(new Date('2026-11-10T18:00:00Z')), { sent: false }, 'one email a London day');
  assert.equal(f.sent.length, 1);
});

test('a new London day may send again', async () => {
  const f = load({ operationsReady: false });
  await f.run();
  assert.deepEqual(await f.run(new Date('2026-11-11T09:00:00Z')), { sent: true });
  assert.deepEqual(f.sent.map((entry) => entry.key), ['booking-closed/2026-11-10', 'booking-closed/2026-11-11']);
});

test('a failed diagnostics run is named as the reason, and both reasons can show together', async () => {
  const both = load({ calendarReady: false, operationsReady: false });
  await both.run();
  assert.equal(both.sent[0].content.details.length, 2);
  assert.match(both.sent[0].content.details[1].value, /diagnostics did not pass/);
});

test('the notice follows the salon alert language', async () => {
  const f = load({ calendarReady: false, locale: 'zh-HK' });
  await f.run();
  assert.equal(f.sent[0].content.locale, 'zh-HK');
  assert.equal(f.sent[0].content.subject, 'Harbour Hair：網上預約已自動關閉');
});

test('nothing is said when booking is meant to be closed or is working', async () => {
  for (const options of [{ bookingEnabled: false, calendarReady: false }, { calendarReady: true, operationsReady: true }]) {
    const f = load(options);
    assert.deepEqual(await f.run(), { sent: false });
    assert.equal(f.sent.length, 0);
  }
});

test('with notifications off or the payments lock on, no query runs at all', async () => {
  for (const [options, env] of [[{ calendarReady: false }, { NOTIFICATIONS_ENABLED: 'false' }], [{ calendarReady: false, locked: true }, ENV]] as const) {
    const f = load(options);
    assert.deepEqual(await f.run(NOW, env), { sent: false });
    assert.equal(f.reads(), 0);
  }
});

test('a failed send records nothing, so the next tick tries again', async () => {
  const f = load({ calendarReady: false });
  await assert.rejects(f.alert.sendBookingClosedAlert({ db: f.db as never, now: NOW, env: ENV, send: async () => { throw new Error('resend down'); } }));
  assert.equal(f.row.lastResultJson, null);
  assert.deepEqual(await f.run(), { sent: true });
});
