import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectOpsFindings, opsAlertContent, sendDailyOpsAlert, type OpsFinding } from './ops-alert-service';
import { renderPlainText } from './email-content';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

type Rows = {
  failed?: number;
  jobs?: { name: string; lastFailedAt: Date | null; lastSucceededAt: Date | null }[];
  connections?: { provider: string; lastSuccessAt: Date | null; lastError: string | null; stylist: { name: string } }[];
  pending?: { createdAt: Date }[];
  salonLocale?: string;
};

function fakeDb(rows: Rows) {
  const calls: string[] = [];
  const db = {
    notificationDelivery: { count: async (args: unknown) => { calls.push(`deliveries ${JSON.stringify(args)}`); return rows.failed ?? 0; } },
    backgroundJobState: { findMany: async () => rows.jobs ?? [] },
    calendarConnection: { findMany: async () => { calls.push('connections'); return rows.connections ?? []; } },
    appointment: { findMany: async () => rows.pending ?? [] },
    siteSettings: { findUnique: async () => ({ salonNotificationLocale: rows.salonLocale ?? 'zh-HK' }) },
  };
  return { db: db as never, calls };
}

test('a quiet day finds nothing and sends nothing', async () => {
  const { db } = fakeDb({
    jobs: [{ name: 'calendar-sync', lastFailedAt: hoursAgo(30), lastSucceededAt: hoursAgo(2) }],
    connections: [{ provider: 'FRESHA', lastSuccessAt: hoursAgo(12), lastError: null, stylist: { name: 'Ivan' } }],
  });
  let sent = 0;
  const result = await sendDailyOpsAlert({ db, now: NOW, calendarSyncEnabled: true, housekeepingEnabled: true, send: async () => { sent += 1; } });
  assert.deepEqual(result, { sent: false, findings: 0 });
  assert.equal(sent, 0);
});

test('failures, a failing job, broken or stale feeds and waiting requests are all reported', async () => {
  const { db } = fakeDb({
    failed: 2,
    jobs: [
      { name: 'housekeeping', lastFailedAt: hoursAgo(5), lastSucceededAt: hoursAgo(29) },
      { name: 'operations-readiness', lastFailedAt: hoursAgo(1), lastSucceededAt: null },
      { name: 'reminders', lastFailedAt: hoursAgo(80), lastSucceededAt: null },
    ],
    connections: [
      { provider: 'FRESHA', lastSuccessAt: hoursAgo(3), lastError: 'HTTP 404', stylist: { name: 'Lox' } },
      { provider: 'FRESHA', lastSuccessAt: hoursAgo(30), lastError: null, stylist: { name: 'Shania' } },
    ],
    pending: [{ createdAt: hoursAgo(20) }, { createdAt: hoursAgo(3) }],
  });
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: true });
  assert.deepEqual(findings.map((f) => f.kind), ['DELIVERIES_FAILED', 'JOB_FAILING', 'CALENDAR_ERROR', 'CALENDAR_STALE', 'REQUESTS_WAITING']);
  const job = findings.find((f) => f.kind === 'JOB_FAILING') as Extract<OpsFinding, { kind: 'JOB_FAILING' }>;
  assert.equal(job.job, 'housekeeping', 'the readiness diagnostic and failures older than two days are left out');
  const waiting = findings.find((f) => f.kind === 'REQUESTS_WAITING') as Extract<OpsFinding, { kind: 'REQUESTS_WAITING' }>;
  assert.equal(waiting.count, 2);
});

test('feeds are not judged while calendar sync is switched off', async () => {
  const { db, calls } = fakeDb({ connections: [{ provider: 'FRESHA', lastSuccessAt: null, lastError: null, stylist: { name: 'Ivan' } }] });
  assert.deepEqual(await collectOpsFindings(db, NOW, { calendarSyncEnabled: false, housekeepingEnabled: true }), []);
  assert.ok(!calls.includes('connections'));
});

test('the alert goes once per London day, in the salon language, linking to Operations', async () => {
  const { db } = fakeDb({ failed: 1 });
  const sent: { subject: string; key: string; text: string }[] = [];
  const result = await sendDailyOpsAlert({ db, now: NOW, calendarSyncEnabled: true, housekeepingEnabled: true, send: async (content, key) => { sent.push({ subject: content.subject, key, text: renderPlainText(content) }); } });
  assert.deepEqual(result, { sent: true, findings: 1 });
  assert.equal(sent[0].key, 'ops-alert/2026-11-03');
  assert.match(sent[0].subject, /需要處理/);
  assert.match(sent[0].text, /\/zh-hk\/admin\/operations/);
});

test('English copy renders every finding without leaking raw keys', () => {
  const content = opsAlertContent([
    { kind: 'DELIVERIES_FAILED', count: 1 },
    { kind: 'JOB_FAILING', job: 'housekeeping', since: hoursAgo(5) },
    { kind: 'CALENDAR_ERROR', stylist: 'Lox', provider: 'FRESHA' },
    { kind: 'CALENDAR_STALE', stylist: 'Shania', provider: 'FRESHA', lastSuccessAt: null },
    { kind: 'REQUESTS_WAITING', count: 3, oldestCreatedAt: hoursAgo(20) },
  ], 'en-GB');
  const text = renderPlainText(content);
  assert.equal(content.subject, 'Harbour Hair: 5 things need attention');
  assert.match(text, /1 email could not be sent/);
  assert.match(text, /Lox’s Fresha calendar/);
  assert.match(text, /3 booking requests are waiting/);
  assert.doesNotMatch(text, /opsAlert\.|findings\./);
});

test('mail going out without housekeeping is itself something to fix', async () => {
  const { db } = fakeDb({});
  const findings = await collectOpsFindings(db, NOW, { calendarSyncEnabled: true, housekeepingEnabled: false });
  assert.deepEqual(findings, [{ kind: 'HOUSEKEEPING_OFF' }]);
  assert.match(renderPlainText(opsAlertContent(findings, 'en-GB')), /HOUSEKEEPING_ENABLED/);
});
