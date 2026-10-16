import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';

// Admin → Integrations → "Sync now" (task G9, spec §7): administrators only,
// audited, and a no-op redirect while the sync is off. The work is the
// calendar-sync job's own daily run (watch channel without renewal, the whole
// window pushed, one single-flight pull), so the buttons and the cron cannot drift.

const CONFIG = { calendarId: 'c', clientEmail: 'e', privateKey: 'k', webhookSecret: 's' };
const STEPS = { ok: true, channel: 'current', push: { written: 1, deleted: 0, unchanged: 4, failed: 0 }, pull: { reverted: 0, blocks: 0, changed: false } };

function load(options: { role?: string; enabled?: boolean; job?: unknown; auditFails?: boolean } = {}) {
  const log: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const revalidated: string[] = [];
  let redirected = '';
  const action = loadServerModule<typeof import('./admin-google-calendar')>('src/app/actions/admin-google-calendar.ts', {
    'server-only': {},
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => { log.push('config'); return options.enabled === false ? null : CONFIG; } },
    '@/app/services/google-calendar-job': {
      runGoogleCalendarJob: async (run: string) => { log.push(`job:${run}`); return options.job ?? STEPS; },
    },
    '@/app/lib/audit': {
      appendAuditEvent: async (input: Record<string, unknown>) => {
        log.push('audit');
        if (options.auditFails) throw new Error('database unavailable');
        audits.push(input);
      },
    },
    '@/i18n/request': { localizedPath: async (path: string) => `/zh-hk${path}` },
    '@/i18n/revalidate': { revalidateAllLocales: (_fn: unknown, path: string) => { revalidated.push(path); } },
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: (to: string) => { redirected = to; throw new Error('NEXT_REDIRECT'); } },
  });
  const run = async () => { await assert.rejects(action.syncGoogleCalendarNow(), /NEXT_REDIRECT/); return redirected; };
  return { action, run, log, audits, revalidated };
}

test('a non-administrator is refused before anything else happens', async () => {
  const f = load({ role: 'USER' });
  await assert.rejects(f.action.syncGoogleCalendarNow(), /Unauthorized/);
  assert.deepEqual([f.log, f.audits], [[], []]);
});

test('with the sync off the button does nothing but redirect: no job, no audit, no database', async () => {
  const f = load({ enabled: false });
  assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=disabled');
  assert.deepEqual(f.log, ['config']);
  assert.deepEqual(f.audits, []);
});

test('with the sync on it runs the daily job, audits it and redirects done', async () => {
  const f = load();
  assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=done');
  assert.deepEqual(f.log, ['config', 'job:daily', 'audit']);
  assert.deepEqual(f.audits, [{ actorUserId: 'admin-1', action: 'INTEGRATION.GOOGLE_CALENDAR_SYNC', targetType: 'Integration', targetId: 'google-calendar', metadata: { outcome: 'done' } }]);
  assert.ok(f.revalidated.includes('/admin/integrations'));
});

test('a step that failed, bookings Google refused, or a job that threw all redirect error (still audited)', async () => {
  for (const job of [
    { ...STEPS, ok: false, push: { written: 0, deleted: 0, unchanged: 0, failed: 2 } },
    { ...STEPS, ok: false, pull: 'failed' },
    { ok: false, error: true },
    { skipped: 'disabled' },
  ]) {
    const f = load({ job });
    assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=error', JSON.stringify(job));
    assert.deepEqual(f.audits.map((a) => a.metadata), [{ outcome: 'error' }]);
  }
});

test('an audit that cannot be saved does not hide the result of the sync', async () => {
  const f = load({ auditFails: true });
  assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=done');
});
