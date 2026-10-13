import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { appointmentEmailContent, renderPlainText } from './email-content';

// REQUEST_LAPSED: a booking request (PENDING) nobody confirmed before its time
// came, closed by the notifications cron (pending-request-lapse.ts).

const request = {
  id: 'appointment-abcdefgh', date: new Date('2099-09-14T12:00:00Z'), notes: null, // 13:00 London (BST)
  user: { name: 'Amy', email: 'amy@example.test', phone: '07000 000000' },
  stylist: { name: 'Ivan' },
  service: { name: 'Cut & Blow-dry', duration: 60 },
  price: { known: false } as const,
};

test('the lapsed-request email says the request could not be confirmed and how to book again (en-GB)', () => {
  const content = appointmentEmailContent('REQUEST_LAPSED', request, 'en-GB', { salonPhone: '07831 830898' });
  assert.equal(content.subject, 'We couldn’t confirm your booking request — Harbour Hair Salon');
  assert.equal(content.greeting, 'Hi Amy,');
  assert.match(content.intro, /couldn’t confirm your booking request for .*14.* at 13:00/);
  assert.match(content.intro, /Please call us or book another time\./);
  assert.deepEqual(content.details.map((detail) => detail.label), ['Service', 'Stylist', 'Requested date', 'Requested time']);
  assert.deepEqual(content.callout, { title: 'Want a different time?', body: 'Call the salon on 07831 830898 and we’ll find one with you.' });
  assert.equal(content.cta?.label, 'Book another time');
  assert.match(content.cta?.href ?? '', /\/book$/);
  assert.doesNotMatch(content.cta?.href ?? '', /zh-hk/);
  assert.equal(content.reference, 'Reference: ABCDEFGH', 'a request is not a booking, so no booking reference');
  assert.match(renderPlainText(content), /07831 830898/);
});

test('the lapsed-request email in Hong Kong Chinese links to the Chinese booking page', () => {
  const content = appointmentEmailContent('REQUEST_LAPSED', request, 'zh-HK', { salonPhone: '07831 830898' });
  assert.equal(content.subject, '未能確認你的預約申請 — Harbour Hair Salon');
  assert.equal(content.greeting, 'Amy你好：');
  assert.match(content.intro, /13:00/);
  assert.match(content.cta?.href ?? '', /\/zh-hk\/book$/);
  assert.deepEqual(content.callout, { title: '想另約時間？', body: '請致電本店 07831 830898，我們會與你另約時間。' });
});

test('without a salon phone the lapsed-request email has no callout', () => {
  assert.equal(appointmentEmailContent('REQUEST_LAPSED', request, 'en-GB').callout, undefined);
});

let previousNotificationsEnabled: string | undefined;
beforeEach(() => {
  previousNotificationsEnabled = process.env.NOTIFICATIONS_ENABLED;
  process.env.NOTIFICATIONS_ENABLED = 'true';
});
afterEach(() => {
  if (previousNotificationsEnabled === undefined) delete process.env.NOTIFICATIONS_ENABLED;
  else process.env.NOTIFICATIONS_ENABLED = previousNotificationsEnabled;
});

/** One queued REQUEST_LAPSED event against a booking in `state`, dispatched at `now`. */
function delivery(state: { status: string; notificationVersion?: number; date?: string }, now = new Date('2099-09-14T13:00:00Z')) {
  const queuedDate = '2099-09-14T12:00:00.000Z';
  const row = {
    id: 'job-l', eventKey: 'appointment/a/1/REQUEST_LAPSED', kind: 'REQUEST_LAPSED', appointmentId: 'a', status: 'PENDING', attempts: 0,
    firstAttemptAt: null as Date | null, nextAttemptAt: now, createdAt: now, lockedAt: null as Date | null, lockToken: null as string | null,
    payloadJson: JSON.stringify({
      version: 1, date: queuedDate, locale: 'en-GB',
      appointment: { schema: 2, id: 'a', date: queuedDate, notes: null, user: { name: 'Amy', email: 'amy@example.test' }, stylist: { name: 'Ivan' }, service: { name: 'Cut', duration: 60 }, price: { known: false } },
      options: { salonPhone: '07831 830898' },
    }),
  };
  let sends = 0;
  const db = {
    notificationDelivery: {
      findMany: async () => [row],
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.lockToken && where.lockToken !== row.lockToken) return { count: 0 };
        const increment = data.attempts as { increment?: number } | undefined;
        Object.assign(row, data, { attempts: row.attempts + (increment?.increment ?? 0) });
        return { count: 1 };
      },
    },
    appointment: {
      findUnique: async () => ({ id: 'a', status: state.status, date: new Date(state.date ?? queuedDate), notificationVersion: state.notificationVersion ?? 1, review: null, rescheduleRequestedAt: null }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  const service = loadServerModule<typeof import('./notification-outbox-service')>('src/app/services/notification-outbox-service.ts', {
    '@/app/lib/prisma': db,
    './email-service': {
      prepareAppointmentEmail: async () => ({ from: 'Salon <b@example.com>', to: 'amy@example.test', subject: 'S', html: '<p>S</p>' }),
      sendPreparedEmail: async () => { sends++; },
    },
  });
  return { run: () => service.dispatchPendingNotifications({ db: db as never, now }), row, sends: () => sends };
}

for (const [label, state, expected] of [
  ['the lapse still stands', { status: 'CANCELLED' }, 'SENT'],
  ['the booking is no longer cancelled', { status: 'CONFIRMED' }, 'SKIPPED'],
  ['the booking changed again after the lapse', { status: 'CANCELLED', notificationVersion: 2 }, 'SKIPPED'],
  ['the booking moved', { status: 'CANCELLED', date: '2099-09-15T12:00:00.000Z' }, 'SKIPPED'],
] as const) {
  test(`a queued lapsed-request email is ${expected} when ${label}`, async () => {
    const f = delivery(state);
    await f.run();
    assert.equal(f.row.status, expected);
    assert.equal(f.sends(), expected === 'SENT' ? 1 : 0);
  });
}

// Held while sending was switched off, then released weeks later: by then
// "we couldn't confirm your request" is noise, so it is dropped like a stale reminder.
test('a lapsed-request email is only sent within 72 hours of the requested time', async () => {
  const requested = new Date('2099-09-14T12:00:00Z').getTime();
  const onTime = delivery({ status: 'CANCELLED' }, new Date(requested + 72 * 3_600_000));
  await onTime.run();
  assert.equal(onTime.row.status, 'SENT');
  const late = delivery({ status: 'CANCELLED' }, new Date(requested + 72 * 3_600_000 + 60_000));
  await late.run();
  assert.equal(late.row.status, 'SKIPPED');
  assert.equal(late.sends(), 0);
});
