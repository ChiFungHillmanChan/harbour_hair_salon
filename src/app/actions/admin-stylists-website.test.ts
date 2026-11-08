import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerModule } from '../../test/load-server-module';
import { translator, type Namespace } from '../../i18n/messages';

// Review 2026-11-08: one stylist on the website without a valid week closes
// online booking for the whole salon, so that state can no longer be reached
// by accident from Admin → Stylists.

const FULL_WEEK = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isOff: dayOfWeek === 0, startTime: '10:00', endTime: '19:00' }));
const HOURS_NEEDED = /opening hours for the whole week/;

function load(options: { showOnWebsite?: boolean; week?: typeof FULL_WEEK } = {}) {
  const updates: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  let weekReads = 0;
  const actions = loadServerModule<typeof import('./admin-stylists')>('src/app/actions/admin-stylists.ts', {
    '@/app/lib/prisma': {
      stylist: {
        findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => (where.id ? { id: 'lox', slug: 'lox', name: 'Lox', showOnWebsite: options.showOnWebsite ?? false } : null),
        findFirst: async () => null,
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { id: 'lox' }; },
      },
      availability: { findMany: async () => { weekReads++; return options.week ?? []; } },
      siteSettings: { findUnique: async () => null },
      $transaction: (run: (tx: unknown) => unknown) => run({ stylist: { create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'new' }; } } }),
    },
    '@/app/lib/session': { verifySession: async () => ({ role: 'ADMIN', userId: 'admin-1' }) },
    '@/app/stylists/slug': { slugify: () => 'new' },
    '@/app/services/content/drafts': {
      ContentError: class extends Error {},
      createPublished: async (_tx: unknown, _kind: unknown, _input: unknown, build: (english: Record<string, unknown>) => unknown) => build({ role: 'Stylist' }),
      deleteContent: async () => undefined,
    },
    '@/app/services/fresha-watch-connections': { invalidateFreshaWatchConnections: () => undefined },
    '@/app/services/stylist-ical-cache': { invalidateStylistIcalFeed: () => undefined, invalidateStylistIcalToken: () => undefined },
    '@/i18n/request': { getActionT: async (namespace: Namespace) => translator('en-GB', namespace), localizedPath: async (path: string) => path },
    'next/cache': { revalidatePath: () => undefined, updateTag: () => undefined },
    'next/navigation': { redirect: (to: string) => { throw new Error(`redirected to ${to}`); } },
  });
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    data.set('id', 'lox'); data.set('name', 'Lox');
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  return { actions, form, updates, created, weekReads: () => weekReads };
}

test('a new stylist is always created hidden, whatever the form says', async () => {
  const f = load();
  await assert.rejects(f.actions.createStylist({ status: 'idle' }, f.form({ showOnWebsite: 'on', contentJson: '{}' })), /redirected to/);
  assert.equal(f.created[0].showOnWebsite, false);
});

test('ticking "Show on website" without a full week is refused and writes nothing', async () => {
  const f = load({ showOnWebsite: false, week: FULL_WEEK.slice(0, 3) });
  const result = await f.actions.updateStylist({ status: 'idle' }, f.form({ showOnWebsite: 'on' }));
  assert.equal(result.status, 'error');
  assert.match((result as { message: string }).message, HOURS_NEEDED);
  assert.equal(f.updates.length, 0);
});

test('with a full valid week the stylist can be shown', async () => {
  const f = load({ showOnWebsite: false, week: FULL_WEEK });
  assert.deepEqual(await f.actions.updateStylist({ status: 'idle' }, f.form({ showOnWebsite: 'on' })), { status: 'success' });
  assert.equal(f.updates[0].showOnWebsite, true);
});

test('saving a stylist who is already shown, or staying hidden, never checks the week', async () => {
  const shown = load({ showOnWebsite: true });
  assert.deepEqual(await shown.actions.updateStylist({ status: 'idle' }, shown.form({ showOnWebsite: 'on' })), { status: 'success' });
  assert.equal(shown.weekReads(), 0);
  const hidden = load({ showOnWebsite: false });
  assert.deepEqual(await hidden.actions.updateStylist({ status: 'idle' }, hidden.form({})), { status: 'success' });
  assert.equal(hidden.weekReads(), 0);
});

test('the one-click switch on the list follows the same rule; hiding is always allowed', async () => {
  const noHours = load({ showOnWebsite: false });
  const refused = await noHours.actions.setStylistSwitch('lox', 'showOnWebsite', true);
  assert.match(String(refused.error), HOURS_NEEDED);
  assert.equal(noHours.updates.length, 0);
  const ready = load({ showOnWebsite: false, week: FULL_WEEK });
  assert.equal((await ready.actions.setStylistSwitch('lox', 'showOnWebsite', true)).error, undefined);
  assert.deepEqual(ready.updates, [{ showOnWebsite: true }]);
  const shown = load({ showOnWebsite: true });
  assert.equal((await shown.actions.setStylistSwitch('lox', 'showOnWebsite', false)).error, undefined);
  assert.equal(shown.weekReads(), 0);
});
