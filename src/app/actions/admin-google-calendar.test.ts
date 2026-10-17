import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadServerModule } from '../../test/load-server-module';

// Admin → Integrations → "Sync now" (task G9, spec §7): administrators only,
// audited, and a no-op redirect while the sync is off. The work is the
// calendar-sync job's own daily run (the whole window pushed, one single-flight
// pull), so the buttons and the cron cannot drift, except that it also replaces
// the watch channel at once: a rotated webhook secret takes effect on Sync now.

const CONFIG = { calendarId: 'c', clientEmail: 'e', privateKey: 'k', webhookSecret: 's' };
const STEPS = { ok: true, channel: 'current', push: { written: 1, deleted: 0, unchanged: 4, failed: 0 }, pull: { reverted: 0, blocks: 0, changed: false } };

function load(options: { role?: string; enabled?: boolean; job?: unknown; auditFails?: boolean } = {}) {
  const log: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const revalidated: string[] = [];
  const deadlines: (number | undefined)[] = [];
  const renews: (boolean | undefined)[] = [];
  let redirected = '';
  const action = loadServerModule<typeof import('./admin-google-calendar')>('src/app/actions/admin-google-calendar.ts', {
    'server-only': {},
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => { log.push('config'); return options.enabled === false ? null : CONFIG; } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { log.push('invalidate'); } },
    '@/app/services/google-calendar-job': {
      runGoogleCalendarJob: async (run: string, input?: { deadline?: number; renew?: boolean }) => {
        log.push(`job:${run}`);
        deadlines.push(input?.deadline);
        renews.push(input?.renew);
        return options.job ?? STEPS;
      },
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
  return { action, run, log, audits, revalidated, deadlines, renews };
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

test('Sync now replaces the watch channel at once (renew), so a rotated webhook secret takes effect', async () => {
  const f = load();
  await f.run();
  assert.deepEqual(f.renews, [true]);
});

test('the job is told when the page\'s function is cut off, so it skips a pull it could not finish', async () => {
  const f = load();
  const before = Date.now();
  await f.run();
  const [deadline] = f.deadlines;
  assert.ok(deadline !== undefined && deadline >= before + 300_000 && deadline <= Date.now() + 300_000);
  // The action runs under the Integrations page's own limit.
  const page = readFileSync(join(process.cwd(), 'src/app/[locale]/admin/integrations/page.tsx'), 'utf8');
  assert.match(page, /export const maxDuration = 300;/);
});

test('a step that failed, bookings Google refused, or a job that threw all redirect error (still audited)', async () => {
  for (const job of [
    { ...STEPS, ok: false, push: { written: 0, deleted: 0, unchanged: 0, failed: 2 } },
    { ...STEPS, ok: false, pull: 'failed' },
    { ...STEPS, ok: false, pull: { reverted: 0, blocks: 0, changed: false, failed: true } },
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

// Admin → Integrations → "Clear Google busy time" (final review I2): makes
// turning the sync off reversible. Administrators only, audited, on or off.

type Block = { id: string; source: string; stylistId: string };

function loadClear(options: { role?: string; enabled?: boolean; failDelete?: boolean } = {}) {
  const log: string[] = [];
  const store = {
    blocks: [
      { id: 'b1', source: 'GOOGLE', stylistId: 's1' }, { id: 'b2', source: 'GOOGLE', stylistId: 's2' },
      { id: 'b3', source: 'FRESHA', stylistId: 's1' }, { id: 'b4', source: 'TREATWELL', stylistId: 's2' },
    ] as Block[],
    state: { id: 'singleton', busyHash: 'hash-of-the-last-blocks' as string | null },
    audits: [] as Record<string, unknown>[],
    auditClient: [] as unknown[],
    deleteWhere: [] as unknown[],
  };
  let inTransaction = false;
  const tx = {
    externalBusyBlock: {
      deleteMany: async ({ where }: { where: { source: string } }) => {
        log.push(`delete:${inTransaction ? 'tx' : 'outside'}`);
        store.deleteWhere.push(where);
        if (options.failDelete) throw new Error('connect ECONNREFUSED db.internal:5432');
        const before = store.blocks.length;
        store.blocks = store.blocks.filter((block) => block.source !== where.source);
        return { count: before - store.blocks.length };
      },
    },
    googleDiaryEntry: { deleteMany: async () => { log.push('diary'); return { count: 4 }; } },
    googleCalendarSyncState: {
      updateMany: async ({ where, data }: { where: { id: string }; data: { busyHash: null } }) => {
        log.push(`state:${inTransaction ? 'tx' : 'outside'}`);
        if (where.id === store.state.id) Object.assign(store.state, data);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => {
      // All or nothing, like the real one.
      const saved = { blocks: [...store.blocks], state: { ...store.state }, audits: [...store.audits] };
      inTransaction = true;
      try {
        return await fn(tx);
      } catch (error) {
        Object.assign(store, saved);
        throw error;
      } finally {
        inTransaction = false;
        log.push('commit');
      }
    },
  };
  let redirected = '';
  const revalidated: string[] = [];
  const action = loadServerModule<typeof import('./admin-google-calendar')>('src/app/actions/admin-google-calendar.ts', {
    'server-only': {},
    '@/app/lib/prisma': { __esModule: true, default: prisma },
    '@/app/lib/session': { verifySession: async () => ({ userId: 'admin-1', role: options.role ?? 'ADMIN' }) },
    '@/app/lib/google-calendar-config': { googleCalendarConfig: () => (options.enabled === false ? null : CONFIG) },
    '@/app/services/google-calendar-job': { runGoogleCalendarJob: async () => { throw new Error('not part of clearing'); } },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => { log.push(`invalidate:${inTransaction ? 'tx' : 'after-commit'}`); } },
    '@/app/lib/audit': {
      appendAuditEvent: async (input: Record<string, unknown>, client?: unknown) => {
        log.push(`audit:${inTransaction ? 'tx' : 'outside'}`);
        store.audits.push(input);
        store.auditClient.push(client);
      },
    },
    '@/i18n/request': { localizedPath: async (path: string) => `/zh-hk${path}` },
    '@/i18n/revalidate': { revalidateAllLocales: (_fn: unknown, path: string) => { revalidated.push(path); } },
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: (to: string) => { redirected = to; throw new Error('NEXT_REDIRECT'); } },
  });
  const run = async () => { await assert.rejects(action.clearGoogleBusyTime(), /NEXT_REDIRECT/); return redirected; };
  return { action, run, log, store, revalidated, tx };
}

test('clear Google busy time: a non-administrator is refused before anything is read or deleted', async () => {
  const f = loadClear({ role: 'USER' });
  await assert.rejects(f.action.clearGoogleBusyTime(), /Unauthorized/);
  assert.deepEqual(f.log, []);
  assert.equal(f.store.blocks.length, 4);
});

test('clear Google busy time deletes only GOOGLE blocks and the diary copy, forgets the busy hash and is audited, in one transaction; then drops the busy feeds', async () => {
  const f = loadClear();
  assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=cleared');
  assert.deepEqual(f.store.deleteWhere, [{ source: 'GOOGLE' }]);
  assert.deepEqual(f.store.blocks.map((block) => block.source).sort(), ['FRESHA', 'TREATWELL'], 'Fresha and Treatwell busy time stays');
  assert.equal(f.store.state.busyHash, null, 'the next pull compares against nothing and stores afresh');
  assert.deepEqual(f.store.audits, [{ actorUserId: 'admin-1', action: 'INTEGRATION.GOOGLE_BUSY_CLEARED', targetType: 'Integration', targetId: 'google-calendar', metadata: { removed: 2, diaryRemoved: 4 } }]);
  assert.equal(f.store.auditClient[0], f.tx, 'the audit is written in the same transaction');
  assert.deepEqual(f.log, ['delete:tx', 'diary', 'state:tx', 'audit:tx', 'commit', 'invalidate:after-commit']);
  for (const path of ['/admin/integrations', '/admin', '/book']) assert.ok(f.revalidated.includes(path), path);
});

test('clear Google busy time works with the sync off too (that is what it is for)', async () => {
  const f = loadClear({ enabled: false });
  assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=cleared');
  assert.deepEqual(f.store.blocks.map((block) => block.source).sort(), ['FRESHA', 'TREATWELL']);
  assert.ok(f.log.indexOf('diary') >= 0 && f.log.indexOf('diary') < f.log.indexOf('audit:tx'), 'the diary copy goes too, before the audit');
  assert.ok(f.log.includes('invalidate:after-commit'));
});

test('clear Google busy time that cannot be saved changes nothing and says so', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const f = loadClear({ failDelete: true });
  assert.equal(await f.run(), '/zh-hk/admin/integrations?gcal=clearError');
  assert.equal(f.store.blocks.length, 4);
  assert.equal(f.store.state.busyHash, 'hash-of-the-last-blocks');
  assert.deepEqual(f.store.audits, []);
  assert.ok(!f.log.some((step) => step.startsWith('invalidate')), 'nothing changed: the busy feeds stay cached');
  assert.doesNotMatch(JSON.stringify(logged), /db\.internal/);
});
